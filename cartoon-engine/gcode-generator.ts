/**
 * Machinist Mario Engine — Composable G-Code Generator
 *
 * A clean, fluent API for building G-code programs from Vector3 coordinates.
 * Every move passes through an optional AABB safety cage before being emitted —
 * the "Self-Healing Repo" (Cart 06) pattern.
 *
 * ── G-code commands generated ─────────────────────────────────────────────────
 *   G0   Rapid positioning      (jump — no material removal)
 *   G1   Linear feed            (cut / print / bore)
 *   G2   Clockwise arc          (swirl CW — smooth V-shape curves)
 *   G3   Counter-clockwise arc  (swirl CCW)
 *   G20  Inch units
 *   G21  Metric units (mm) — default
 *   G28  Home all axes
 *   G90  Absolute mode — default
 *   G91  Incremental mode
 *   M3   Spindle on CW
 *   M5   Spindle off
 *   M30  Program end
 *
 * ── RotationMatrix aliases ────────────────────────────────────────────────────
 * Re-exported from matrix4.ts with the "Machinist Mario" naming convention:
 *   RotationMatrix.rotateX(θ)  — Pitch (guitar neck taper)
 *   RotationMatrix.rotateY(θ)  — Yaw   (Flying V wing angle)
 *   RotationMatrix.rotateZ(θ)  — Roll  (lathe spindle rotation)
 *
 * Usage:
 *   import { GCodeGenerator, RotationMatrix } from './gcode-generator';
 *
 *   const gen = new GCodeGenerator({ spindleSpeed: 18000, units: 'mm' });
 *   gen.comment('Flying V — left wing');
 *   gen.jump(new Vector3(0, 0, 5));
 *   gen.cut(new Vector3(0, 0, -3), 1500);
 *
 *   // Rotate a wing tip 30° around Y axis
 *   const wingTip  = new Vector3(0, 20, 0);
 *   const rotation = RotationMatrix.rotateY(Math.PI / 6);
 *   const rotated  = rotation.transformPoint(wingTip);
 *   gen.cut(rotated, 1500);
 *
 *   console.log(gen.getOutput());
 */

import { Vector3 } from './vector3';
import { Matrix4 } from './matrix4';
import { AABB }    from './aabb';

// ---------------------------------------------------------------------------
// RotationMatrix — named aliases for Machinist Mario conventions
// ---------------------------------------------------------------------------

/**
 * RotationMatrix
 *
 * Named rotation matrix factories using the Machinist Mario convention:
 *   X = Pitch (nodding — guitar neck taper, aero angle of attack)
 *   Y = Yaw   (turning — Flying V wing angle, lathe facing)
 *   Z = Roll  (spinning — lathe workpiece, gear rotation)
 *
 * These are direct aliases to the Matrix4 static methods.  The class can
 * be extended (as shown in the requirement) without changing the base Matrix4.
 */
export class RotationMatrix extends Matrix4 {

  /**
   * rotateX — Pitch
   *
   * Rotates around the X-axis by `angleRad` radians.
   * Machine-shop use: tapering a guitar neck's thickness from nut to heel.
   * Aero use: setting the angle of attack of a wing section.
   *
   *   [1    0       0   ]
   *   [0   cosθ  −sinθ  ]
   *   [0   sinθ   cosθ  ]
   */
  static override rotationX(angleRad: number): Matrix4 {
    return Matrix4.rotationX(angleRad);
  }

  /** Alias: rotateX (Machinist Mario naming convention). */
  static rotateX(angleRad: number): Matrix4 {
    return Matrix4.rotationX(angleRad);
  }

  /**
   * rotateY — Yaw
   *
   * Rotates around the Y-axis by `angleRad` radians.
   * Machine-shop use: setting the 30° wing angle on the Flying V body.
   * Aero use: sweep angle of a delta wing or cartoon cape.
   *
   *   [ cosθ  0  sinθ ]
   *   [  0    1   0   ]
   *   [−sinθ  0  cosθ ]
   */
  static override rotationY(angleRad: number): Matrix4 {
    return Matrix4.rotationY(angleRad);
  }

  /** Alias: rotateY (Machinist Mario naming convention). */
  static rotateY(angleRad: number): Matrix4 {
    return Matrix4.rotationY(angleRad);
  }

  /**
   * rotateZ — Roll
   *
   * Rotates around the Z-axis by `angleRad` radians.
   * Machine-shop use: lathe workpiece rotation; gear tooth angular position.
   * Animation use: character roll (cape spin, cartwheel).
   *
   *   [ cosθ  −sinθ  0 ]
   *   [ sinθ   cosθ  0 ]
   *   [  0      0    1 ]
   */
  static override rotationZ(angleRad: number): Matrix4 {
    return Matrix4.rotationZ(angleRad);
  }

  /** Alias: rotateZ (Machinist Mario naming convention). */
  static rotateZ(angleRad: number): Matrix4 {
    return Matrix4.rotationZ(angleRad);
  }

  /**
   * rotateAxis — Rodrigues' formula
   *
   * Rotate around an arbitrary axis by `angleRad`.
   * Used for the Flying V's diagonal wing edge or aero leading-edge sweep.
   */
  static rotateAxis(axis: Vector3, angleRad: number): Matrix4 {
    return Matrix4.rotationAxis(axis, angleRad);
  }

  /**
   * swirl
   *
   * Compose a small Z-rotation with a Z-translation to produce one step
   * of a helix — the path of a 3D-printer nozzle or a radiation particle
   * in a magnetic field.
   *
   * Chaining this N times produces a perfect mathematical helix:
   *   pos_{n+1} = swirl(dAngle, dZ).transformPoint(pos_n)
   *
   * @param dAngle_rad  Angular increment per step (radians).
   * @param dZ_mm       Axial advance per step (mm).
   */
  static swirl(dAngle_rad: number, dZ_mm: number): Matrix4 {
    return Matrix4.translation(new Vector3(0, 0, dZ_mm))
      .multiply(Matrix4.rotationZ(dAngle_rad));
  }
}

// ---------------------------------------------------------------------------
// G-code generator options
// ---------------------------------------------------------------------------

export interface GCodeOptions {
  /** Measurement units. Default: 'mm'. */
  units:          'mm' | 'inch';
  /** Default feed rate (mm/min or in/min). Default: 1000. */
  defaultFeed:    number;
  /** Spindle speed in RPM. Default: 0 (spindle not started). */
  spindleSpeed:   number;
  /** Number of decimal places for coordinates. Default: 3. */
  precision:      number;
  /** Optional AABB safety cage — moves outside it are clamped or rejected. */
  safetyBounds:   AABB | null;
  /**
   * Self-healing mode:
   *   'clamp'  — silently clamp out-of-bounds moves to the boundary (Cart 06)
   *   'warn'   — emit a '; SAFETY: ...' comment and skip the move
   *   'throw'  — throw an Error (strict mode for production G-code)
   */
  healingMode:    'clamp' | 'warn' | 'throw';
  /** Current positioning mode. Default: 'absolute'. */
  positioning:    'absolute' | 'incremental';
}

const DEFAULT_OPTIONS: GCodeOptions = {
  units:          'mm',
  defaultFeed:    1000,
  spindleSpeed:   0,
  precision:      3,
  safetyBounds:   null,
  healingMode:    'warn',
  positioning:    'absolute',
};

// ---------------------------------------------------------------------------
// GCodeGenerator
// ---------------------------------------------------------------------------

/**
 * GCodeGenerator
 *
 * Composable, fluent G-code builder.  Every move is validated against the
 * optional AABB safety cage before being appended to the program buffer.
 *
 * The generator tracks the current tool position, so callers never need to
 * pass the "from" position for arc commands — only the "to" and the centre.
 *
 * @example
 * const gen = new GCodeGenerator({ spindleSpeed: 18000 });
 * gen.begin();
 * gen.jump(new Vector3(0, 0, 5));
 * gen.spindle(true);
 * gen.cut(new Vector3(100, 0, -3), 1500);
 * gen.arc(false, new Vector3(100, 100, -3), new Vector3(0, 100, 0));
 * gen.end();
 * console.log(gen.getOutput());
 */
export class GCodeGenerator {
  private readonly opts:   GCodeOptions;
  private readonly lines:  string[] = [];
  private _pos:            Vector3  = Vector3.ZERO;
  private _feedRate:       number;
  private _lineCount:      number   = 0;
  private _safetyViolations: number = 0;

  constructor(opts: Partial<GCodeOptions> = {}) {
    this.opts      = { ...DEFAULT_OPTIONS, ...opts };
    this._feedRate = this.opts.defaultFeed;
  }

  // ── State accessors ───────────────────────────────────────────────────────

  /** Current tool position. */
  get position(): Vector3 { return this._pos; }

  /** Number of lines in the program so far. */
  get lineCount(): number { return this._lineCount; }

  /** Number of moves clamped or skipped by the safety cage. */
  get safetyViolations(): number { return this._safetyViolations; }

  // ── Program structure ─────────────────────────────────────────────────────

  /**
   * begin
   *
   * Emits the standard program header:
   *   unit selection, absolute mode, home command.
   */
  begin(): this {
    this._emit(`; === G-Code Program — Machinist Mario Engine ===`);
    this._emit(`; Generated: ${new Date().toISOString()}`);
    this._emit(this.opts.units === 'mm' ? 'G21 ; metric units (mm)' : 'G20 ; inch units');
    this._emit('G90 ; absolute positioning');
    this._emit('G28 ; home all axes');
    if (this.opts.spindleSpeed > 0) {
      this._emit(`M3 S${this.opts.spindleSpeed} ; spindle on CW`);
    }
    this._emit('');
    return this;
  }

  /**
   * end
   *
   * Emits the standard program footer: spindle off, home, program end.
   */
  end(): this {
    this._emit('');
    this._emit('M5  ; spindle off');
    this._emit('G28 ; home');
    this._emit('M30 ; program end');
    return this;
  }

  /**
   * comment
   *
   * Emits a G-code comment line (prefixed with ';').
   */
  comment(text: string): this {
    this._emit(`; ${text}`);
    return this;
  }

  /** Emit a blank separator line. */
  newline(): this {
    this._emit('');
    return this;
  }

  /**
   * spindle
   *
   * @param on    true = M3 (CW on), false = M5 (off).
   * @param rpm   Optional RPM override (S word).
   */
  spindle(on: boolean, rpm?: number): this {
    if (on) {
      const s = rpm ?? this.opts.spindleSpeed;
      this._emit(`M3 S${s} ; spindle on CW`);
    } else {
      this._emit('M5 ; spindle off');
    }
    return this;
  }

  /**
   * setFeedRate
   *
   * Updates the active feed rate for subsequent G1 / G2 / G3 moves.
   */
  setFeedRate(f: number): this {
    this._feedRate = f;
    return this;
  }

  /**
   * positioning
   *
   * Switch between absolute (G90) and incremental (G91) modes.
   */
  setPositioning(mode: 'absolute' | 'incremental'): this {
    this._emit(mode === 'absolute' ? 'G90 ; absolute' : 'G91 ; incremental');
    (this.opts as GCodeOptions).positioning = mode;
    return this;
  }

  // ── Motion commands ───────────────────────────────────────────────────────

  /**
   * jump
   *
   * G0 Rapid move — no material removal, maximum machine speed.
   * "Don't cut, just jump to the next position."
   *
   * @param target   Destination position.
   */
  jump(target: Vector3): this {
    const safe = this._safetyCheck(target);
    if (safe === null) return this;

    const p = this.opts.precision;
    this._emit(
      `G0 X${safe.x.toFixed(p)} Y${safe.y.toFixed(p)} Z${safe.z.toFixed(p)}`
    );
    this._pos = safe;
    return this;
  }

  /**
   * cut
   *
   * G1 Linear interpolation — the machining cut, print move, or boring pass.
   *
   * @param target     Destination position.
   * @param feedRate   Feed rate (mm/min).  Omit to use the current feed rate.
   */
  cut(target: Vector3, feedRate?: number): this {
    const safe = this._safetyCheck(target);
    if (safe === null) return this;

    const f = feedRate ?? this._feedRate;
    const p = this.opts.precision;
    this._emit(
      `G1 X${safe.x.toFixed(p)} Y${safe.y.toFixed(p)} Z${safe.z.toFixed(p)} F${Math.round(f)}`
    );
    this._pos = safe;
    return this;
  }

  /**
   * arc
   *
   * G2/G3 Circular arc interpolation — "The Swirl."
   * Produces smooth curves for the Flying V wing tips, guitar waist,
   * and medical stent lumen profiles.
   *
   * The arc is defined by:
   *   • `target`  — end point of the arc
   *   • `centre`  — centre of the arc circle (I/J/K offsets from current position)
   *   • `cw`      — true = G2 (clockwise), false = G3 (counter-clockwise)
   *
   * @param cw         Clockwise (G2) or counter-clockwise (G3).
   * @param target     Arc end point.
   * @param centre     Arc centre (absolute position — converted to I/J/K offset).
   * @param feedRate   Feed rate.  Omit to use current.
   */
  arc(cw: boolean, target: Vector3, centre: Vector3, feedRate?: number): this {
    const safe = this._safetyCheck(target);
    if (safe === null) return this;

    const f  = feedRate ?? this._feedRate;
    const p  = this.opts.precision;
    const I  = centre.x - this._pos.x;
    const J  = centre.y - this._pos.y;
    const K  = centre.z - this._pos.z;
    const cmd = cw ? 'G2' : 'G3';

    this._emit(
      `${cmd} X${safe.x.toFixed(p)} Y${safe.y.toFixed(p)} Z${safe.z.toFixed(p)} ` +
      `I${I.toFixed(p)} J${J.toFixed(p)} K${K.toFixed(p)} F${Math.round(f)}`
    );
    this._pos = safe;
    return this;
  }

  /**
   * dwell
   *
   * G4 Dwell (pause) for `ms` milliseconds.
   * Used for spindle spin-up or coolant settling.
   */
  dwell(ms: number): this {
    this._emit(`G4 P${ms} ; dwell ${ms}ms`);
    return this;
  }

  // ── Higher-level paths ────────────────────────────────────────────────────

  /**
   * helix
   *
   * Machines or prints a helical path (3D-printer nozzle path, thread cutting,
   * radiation-particle spiral visualisation).
   *
   * Generates n G1 moves along a helix:
   *   x(t) = cx + r·cos(2π·t·turns)
   *   y(t) = cy + r·sin(2π·t·turns)
   *   z(t) = z0 + pitch·t·turns
   *
   * @param centre    XY centre of the helix.
   * @param radius    Helix radius (mm).
   * @param pitch     Axial advance per revolution (mm).
   * @param turns     Number of complete revolutions.
   * @param n         Number of G1 segments per revolution.
   * @param feedRate  Feed rate (mm/min).
   */
  helix(
    centre:    Vector3,
    radius:    number,
    pitch:     number,
    turns:     number = 1,
    n:         number = 36,
    feedRate?: number
  ): this {
    this.comment(`Helix r=${radius} pitch=${pitch} turns=${turns}`);
    const totalSteps = Math.round(n * turns);

    for (let i = 1; i <= totalSteps; i++) {
      const t     = i / (n);
      const angle = 2 * Math.PI * t;
      const target = new Vector3(
        centre.x + radius * Math.cos(angle),
        centre.y + radius * Math.sin(angle),
        this._pos.z + pitch * (i / totalSteps)
      );
      this.cut(target, feedRate);
    }
    return this;
  }

  /**
   * polygon
   *
   * Machines or prints a closed polygon outline.
   * Automatically closes back to the start point.
   *
   * @param vertices   Array of 2-D {x, y} vertices (z uses current tool Z).
   * @param feedRate   Feed rate.
   */
  polygon(vertices: Array<{ x: number; y: number }>, feedRate?: number): this {
    if (vertices.length < 2) return this;

    this.jump(new Vector3(vertices[0].x, vertices[0].y, this._pos.z));
    for (let i = 1; i < vertices.length; i++) {
      this.cut(new Vector3(vertices[i].x, vertices[i].y, this._pos.z), feedRate);
    }
    this.cut(new Vector3(vertices[0].x, vertices[0].y, this._pos.z), feedRate);
    return this;
  }

  /**
   * vShapeCut
   *
   * Machines the Flying V perimeter using the GuitarMachinist polygon,
   * with G2 arcs at the wing tips.
   *
   * @param halfW      Half body width (mm).
   * @param wingY      Y position of wing tips (mm).
   * @param bodyL      Body length (mm).
   * @param tipRadius  Wing-tip rounding radius (mm).
   * @param depth      Cut depth (negative Z, mm).
   * @param feedRate   Feed rate.
   */
  vShapeCut(
    halfW: number, wingY: number, bodyL: number,
    tipRadius: number, depth: number, feedRate?: number
  ): this {
    const f  = feedRate ?? this._feedRate;
    const z  = Math.abs(depth);

    this.comment(`V-Shape cut: halfW=${halfW} wingY=${wingY} depth=${z}`);

    // Approach
    this.jump(new Vector3(0, 0, 5));
    this.cut(new Vector3(0, 0, -z), Math.round(f / 3));

    // Left wing — apex to tip
    this.cut(new Vector3(-halfW + tipRadius, wingY, -z), f);
    // Left wing tip arc (G3 — CCW)
    this.arc(false,
      new Vector3(-halfW, wingY + tipRadius, -z),
      new Vector3(-halfW, wingY, -z),
      Math.round(f / 2)
    );
    // Left base
    this.cut(new Vector3(-halfW, bodyL, -z), f);
    this.cut(new Vector3(0, bodyL, -z), f);
    // Right base
    this.cut(new Vector3(halfW, bodyL, -z), f);
    // Right wing tip arc (G2 — CW)
    this.arc(true,
      new Vector3(halfW - tipRadius, wingY, -z),
      new Vector3(halfW, wingY, -z),
      Math.round(f / 2)
    );
    // Right wing — tip to apex
    this.cut(new Vector3(0, 0, -z), f);
    this.jump(new Vector3(0, 0, 5));
    return this;
  }

  // ── Output ─────────────────────────────────────────────────────────────────

  /**
   * getOutput
   *
   * Returns the complete G-code program as a single newline-separated string.
   */
  getOutput(): string {
    return this.lines.join('\n');
  }

  /**
   * getLines
   *
   * Returns the G-code program as an array of individual lines.
   */
  getLines(): string[] {
    return [...this.lines];
  }

  /**
   * reset
   *
   * Clears the program buffer and resets the tool position to the origin.
   */
  reset(): this {
    this.lines.length = 0;
    this._pos         = Vector3.ZERO;
    this._lineCount   = 0;
    this._safetyViolations = 0;
    return this;
  }

  // ── Safety cage (Cart 06 — Self-Healing Repo) ─────────────────────────────

  /**
   * _safetyCheck
   *
   * Validates a target position against the AABB safety cage.
   * Applies the configured healing mode if the target is out of bounds.
   *
   * Returns the (possibly clamped) safe position, or null if the move
   * should be skipped entirely.
   */
  private _safetyCheck(target: Vector3): Vector3 | null {
    const { safetyBounds, healingMode } = this.opts;
    if (!safetyBounds || safetyBounds.contains(target)) return target;

    this._safetyViolations++;

    switch (healingMode) {
      case 'clamp': {
        const clamped = safetyBounds.clampPoint(target);
        this._emit(
          `; [CART06] Self-healed: ${target.toString()} → ${clamped.toString()}`
        );
        return clamped;
      }
      case 'warn':
        this._emit(
          `; [SAFETY] Out-of-bounds move skipped: ${target.toString()}`
        );
        return null;
      case 'throw':
        throw new RangeError(
          `[GCodeGenerator] SAFETY STOP: target ${target.toString()} ` +
          `exceeds safety cage ${safetyBounds.toString()}`
        );
    }
  }

  private _emit(line: string): void {
    this.lines.push(line);
    this._lineCount++;
  }
}
