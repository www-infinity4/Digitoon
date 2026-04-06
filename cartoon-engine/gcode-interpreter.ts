/**
 * GCodeInterpreter — G-code State-Machine Parser & Safety Validator
 *
 * Parses G-code programs line-by-line, tracking machine state through a
 * finite-state machine.  Every move is validated against an AABB work
 * envelope; out-of-bounds targets are "self-healed" by clamping them to the
 * nearest surface point so the machine never leaves the safe zone.
 *
 * Supported commands
 * ─────────────────────────────────────────────────────────────────────────────
 *   G0   Rapid move
 *   G1   Linear feed move
 *   G2   Clockwise arc
 *   G3   Counter-clockwise arc
 *   G20  Set units to inches
 *   G21  Set units to millimetres (default)
 *   G90  Absolute positioning (default)
 *   G91  Incremental positioning
 *   M3   Spindle on CW
 *   M5   Spindle stop
 *   M30  Program end
 *
 * Comment stripping:  `; rest of line` and `(inline comment)` are removed
 * before parsing.
 */

import { Vector3 } from './vector3';
import { AABB } from './aabb';

// ─── Public Interfaces ────────────────────────────────────────────────────────

/** Live machine state captured after processing each line. */
export interface MachineState {
  pos: Vector3;
  feedRate: number;
  spindleRPM: number;
  /** true = absolute mode (G90), false = incremental (G91). */
  absolute: boolean;
  units: 'mm' | 'in';
}

/** Parsed and validated result for a single motion command. */
export interface InterpretedMove {
  cmd: string;
  from: Vector3;
  to: Vector3;
  feedRate: number;
  /** false when the target was clamped. */
  safe: boolean;
  /** Populated only when safe = false: the clamped destination. */
  healedTo?: Vector3;
}

/** Aggregated safety statistics for an entire G-code program. */
export interface SafetyReport {
  totalMoves: number;
  safeMoves: number;
  violations: number;
  healedMoves: number;
}

// ─── GCodeInterpreter ────────────────────────────────────────────────────────

const INCHES_TO_MM = 25.4;

export class GCodeInterpreter {
  private readonly bounds: AABB;
  private readonly precision: number;

  private state: MachineState = {
    pos: new Vector3(0, 0, 0),
    feedRate: 1000,
    spindleRPM: 0,
    absolute: true,
    units: 'mm',
  };

  private totalMoves = 0;
  private safeMoves = 0;
  private violations = 0;
  private healedMoves = 0;

  constructor(bounds: AABB, opts: { precision?: number } = {}) {
    this.bounds = bounds;
    this.precision = opts.precision ?? 4;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Parse a single line of G-code.
   *
   * Returns `null` for non-motion lines (comments, M-codes that don't move,
   * mode-change-only lines such as G20/G21/G90/G91).
   */
  public parseLine(line: string): InterpretedMove | null {
    const clean = this.stripComments(line).trim().toUpperCase();
    if (!clean) return null;

    const parts = clean.split(/\s+/);

    // ── Mode / unit changes ────────────────────────────────────────────────
    if (parts.includes('G20')) { this.state = { ...this.state, units: 'in' }; }
    if (parts.includes('G21')) { this.state = { ...this.state, units: 'mm' }; }
    if (parts.includes('G90')) { this.state = { ...this.state, absolute: true }; }
    if (parts.includes('G91')) { this.state = { ...this.state, absolute: false }; }

    // ── Spindle ───────────────────────────────────────────────────────────
    if (parts.includes('M3')) {
      const rpm = this.parseCoord(parts, 'S', this.state.spindleRPM);
      this.state = { ...this.state, spindleRPM: rpm };
    }
    if (parts.includes('M5')) { this.state = { ...this.state, spindleRPM: 0 }; }

    // ── Motion commands ───────────────────────────────────────────────────
    const isG0 = parts.includes('G0') || parts.includes('G00');
    const isG1 = parts.includes('G1') || parts.includes('G01');
    const isG2 = parts.includes('G2') || parts.includes('G02');
    const isG3 = parts.includes('G3') || parts.includes('G03');

    if (!isG0 && !isG1 && !isG2 && !isG3) return null;

    // Parse feed rate if present
    const f = this.parseCoord(parts, 'F', this.state.feedRate);
    this.state = { ...this.state, feedRate: f };

    // Parse target coordinates
    const from = this.state.pos;
    const rawX = this.parseCoord(parts, 'X', this.state.absolute ? from.x : 0);
    const rawY = this.parseCoord(parts, 'Y', this.state.absolute ? from.y : 0);
    const rawZ = this.parseCoord(parts, 'Z', this.state.absolute ? from.z : 0);

    // Convert to mm if in inch mode
    const scale = this.state.units === 'in' ? INCHES_TO_MM : 1;
    let tx: number, ty: number, tz: number;

    if (this.state.absolute) {
      tx = rawX * scale;
      ty = rawY * scale;
      tz = rawZ * scale;
    } else {
      tx = from.x + rawX * scale;
      ty = from.y + rawY * scale;
      tz = from.z + rawZ * scale;
    }

    const target = new Vector3(
      this.round(tx),
      this.round(ty),
      this.round(tz)
    );

    // Determine command label
    const cmd = isG0 ? 'G0' : isG1 ? 'G1' : isG2 ? 'G2' : 'G3';

    // ── Arc safety check ─────────────────────────────────────────────────
    let arcMidpoint: Vector3 | undefined;
    if (isG2 || isG3) {
      const I = this.parseCoord(parts, 'I', 0) * scale;
      const J = this.parseCoord(parts, 'J', 0) * scale;
      const K = this.parseCoord(parts, 'K', 0) * scale;
      // Centre of arc (absolute)
      const cx = from.x + I;
      const cy = from.y + J;
      const cz = from.z + K;
      // Approximate midpoint as average of start + end + centre
      arcMidpoint = new Vector3(
        (from.x + target.x + cx) / 3,
        (from.y + target.y + cy) / 3,
        (from.z + target.z + cz) / 3
      );
    }

    // ── AABB validation & self-healing ────────────────────────────────────
    this.totalMoves++;
    let safe = this.bounds.contains(target);
    if (arcMidpoint) safe = safe && this.bounds.contains(arcMidpoint);

    let healedTo: Vector3 | undefined;
    const effectiveTo = safe ? target : (() => {
      healedTo = this.bounds.clampPoint(target);
      return healedTo;
    })();

    if (!safe) {
      this.violations++;
      this.healedMoves++;
    } else {
      this.safeMoves++;
    }

    this.state = { ...this.state, pos: effectiveTo };

    const move: InterpretedMove = {
      cmd,
      from,
      to: effectiveTo,
      feedRate: this.state.feedRate,
      safe,
    };
    if (healedTo) move.healedTo = healedTo;
    return move;
  }

  /**
   * Parse an entire G-code program (newline-separated lines).
   */
  public parseProgram(gcode: string): InterpretedMove[] {
    const lines = gcode.split('\n');
    const moves: InterpretedMove[] = [];
    for (const line of lines) {
      const move = this.parseLine(line);
      if (move) moves.push(move);
    }
    return moves;
  }

  /** Returns a read-only copy of the current machine state. */
  public getState(): MachineState {
    return { ...this.state };
  }

  /** Resets machine state to origin. */
  public reset(): void {
    this.state = {
      pos: new Vector3(0, 0, 0),
      feedRate: 1000,
      spindleRPM: 0,
      absolute: true,
      units: 'mm',
    };
    this.totalMoves = 0;
    this.safeMoves = 0;
    this.violations = 0;
    this.healedMoves = 0;
  }

  /** Returns aggregated safety statistics. */
  public getSafetyReport(): SafetyReport {
    return {
      totalMoves: this.totalMoves,
      safeMoves: this.safeMoves,
      violations: this.violations,
      healedMoves: this.healedMoves,
    };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Strip G-code comments:
   *  - `; rest of line` style
   *  - `(parenthesised inline comment)` style
   */
  private stripComments(line: string): string {
    // Remove parenthesised comments first, then semicolon comments
    return line.replace(/\([^)]*\)/g, '').replace(/;.*$/, '');
  }

  /**
   * Parse a coordinate word like "X12.5" from a split token array.
   *
   * @param parts     Tokens from the upper-cased line.
   * @param key       The letter to search for (e.g. "X", "Y", "F").
   * @param fallback  Value to use if the key is absent.
   */
  private parseCoord(parts: string[], key: string, fallback: number): number {
    for (const part of parts) {
      if (part.startsWith(key)) {
        const n = parseFloat(part.slice(key.length));
        if (!isNaN(n)) return n;
      }
    }
    return fallback;
  }

  private round(n: number): number {
    const factor = Math.pow(10, this.precision);
    return Math.round(n * factor) / factor;
  }
}
