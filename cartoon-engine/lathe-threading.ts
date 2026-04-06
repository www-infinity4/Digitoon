/**
 * LatheThreading — CNC Lathe Thread-Cutting & Toolpath Generator
 *
 * Covers three thread standards used in guitar manufacturing and general
 * machining:
 *
 *   Metric  — ISO 68-1; 60° symmetric flanks; used for machine screws & inserts.
 *   UNC     — Unified National Coarse; 60° flanks; North-American fastener standard.
 *   NPT     — National Pipe Taper; 60° flanks + 1°47′ taper per ASME B1.20.1.
 *
 * G76 threading cycle reference
 * ─────────────────────────────────────────────────────────────────────────────
 *  G76 P(springPasses)(infeedAngle)(minDepth) Q(minDepth) R(finishAllowance)
 *  G76 X(minorDiam) Z(endZ) P(threadDepth) Q(firstInfeed) F(lead)
 *
 * All linear dimensions are in mm.
 *
 * References
 * ─────────────────────────────────────────────────────────────────────────────
 *  • ISO 68-1:1998 — ISO general purpose screw threads, basic profile.
 *  • ASME B1.13M-2005 — Metric screw threads.
 *  • ASME B1.1-2003 — UNC/UNF.
 *  • ASME B1.20.1-2013 — NPT pipe threads.
 */

import { Vector3 } from './vector3';

// ─── Types ───────────────────────────────────────────────────────────────────

export type ThreadStandard = 'metric' | 'unc' | 'npt';

/** Full specification of a threaded feature. */
export interface ThreadSpec {
  standard: ThreadStandard;
  /** Nominal (outer) diameter in mm. */
  nominalDiameter_mm: number;
  /** Axial distance between adjacent crests (mm). */
  pitch_mm: number;
  /** Radial thread depth H (mm). */
  depth_mm: number;
  /** Number of complete crests over a 25.4 mm gauge length (≈ TPI for UNC/NPT). */
  crests: number;
  /** Number of flanks per crest (always 2 for triangular profiles). */
  flanks: number;
}

/** A single point on the 2D thread cross-section profile. */
export interface ThreadProfilePoint {
  /** Radial position (diameter axis — lathe X). */
  x: number;
  /** Axial position along the workpiece. */
  z: number;
}

// ─── Metric pitch lookup table (coarse series) ────────────────────────────────

const METRIC_PITCH_TABLE: Record<number, number> = {
  3:  0.5,
  4:  0.7,
  5:  0.8,
  6:  1.0,
  8:  1.25,
  10: 1.5,
  12: 1.75,
};

// NPT taper: 1°47' = 0.031 mm per mm axial travel (ASME B1.20.1 §2)
const NPT_TAPER = Math.tan((1 + 47 / 60) * (Math.PI / 180)); // ≈ 0.03125

// Thread depth coefficient H = k × pitch
const H_COEFF_METRIC = 0.6495; // ISO: H = (√3/2) × pitch
const H_COEFF_UNC    = 0.6495;
const H_COEFF_NPT    = 0.8;    // NPT uses shallower truncation

// ─── threadSpec ──────────────────────────────────────────────────────────────

/**
 * Build a `ThreadSpec` from standard, nominal diameter and (optional) TPI.
 *
 * @param standard           Thread form.
 * @param nominalDiameter_mm Nominal diameter in mm.
 * @param tpi                Threads per inch — required for UNC/NPT; optional for metric.
 */
export function threadSpec(
  standard: ThreadStandard,
  nominalDiameter_mm: number,
  tpi?: number
): ThreadSpec {
  let pitch_mm: number;
  let depth_mm: number;

  switch (standard) {
    case 'metric': {
      if (tpi !== undefined) {
        pitch_mm = 25.4 / tpi;
      } else {
        // Look up coarse metric pitch
        const nearest = Object.keys(METRIC_PITCH_TABLE)
          .map(Number)
          .sort((a, b) => Math.abs(a - nominalDiameter_mm) - Math.abs(b - nominalDiameter_mm))[0];
        pitch_mm = METRIC_PITCH_TABLE[nearest] ?? 1.0;
      }
      depth_mm = H_COEFF_METRIC * pitch_mm;
      break;
    }
    case 'unc': {
      if (!tpi) throw new Error('UNC thread requires TPI');
      pitch_mm = 25.4 / tpi;
      depth_mm = H_COEFF_UNC * pitch_mm;
      break;
    }
    case 'npt': {
      if (!tpi) throw new Error('NPT thread requires TPI');
      pitch_mm = 25.4 / tpi;
      depth_mm = H_COEFF_NPT * pitch_mm;
      break;
    }
  }

  const crests  = Math.round(25.4 / pitch_mm);
  return {
    standard,
    nominalDiameter_mm,
    pitch_mm,
    depth_mm,
    crests,
    flanks: 2,
  };
}

// ─── generateThreadProfile ───────────────────────────────────────────────────

/**
 * Generate one full pitch of the thread profile as a 2-D cross-section.
 *
 * For metric and UNC: 60° symmetric V-thread (truncated crests per ISO 68-1).
 * For NPT: same 60° form but X (diameter) values expand with the taper.
 *
 * @param spec    Thread specification.
 * @param points  Number of sample points along one pitch (default 32).
 */
export function generateThreadProfile(
  spec: ThreadSpec,
  points: number = 32
): ThreadProfilePoint[] {
  const profile: ThreadProfilePoint[] = [];
  const p = spec.pitch_mm;
  const H = spec.depth_mm;
  const r = spec.nominalDiameter_mm / 2;

  // Truncation: ISO/UNC removes H/8 at crest and root (flat tops/bottoms)
  const truncation = (spec.standard === 'npt') ? 0 : p / 8;

  for (let i = 0; i <= points; i++) {
    const t = i / points;        // 0 → 1 over one pitch
    const z = t * p;

    // Triangular sawtooth radial depth — 60° flanks, symmetric about pitch/2
    const phase = t - Math.floor(t); // 0..1
    let depth: number;
    if (phase < 0.5) {
      depth = (phase * 2) * H; // rising flank
    } else {
      depth = ((1 - phase) * 2) * H; // falling flank
    }
    // Clamp truncation (flat crest and root)
    depth = Math.max(truncation, Math.min(H - truncation, depth));

    // NPT taper: radius increases with axial position
    const taperOffset = spec.standard === 'npt' ? z * NPT_TAPER : 0;

    profile.push({ x: r - H + depth + taperOffset, z });
  }

  return profile;
}

// ─── LatheController ─────────────────────────────────────────────────────────

/** Material cutting recommendations. */
const FEED_RATE_TABLE: Record<string, number> = {
  aluminium: 0.15, // mm/rev
  steel:     0.08,
  wood:      0.25,
  plastic:   0.20,
};

/**
 * CNC lathe controller — generates G-code for threading cycles, neck
 * profiles, and facing/grooving operations.
 */
export class LatheController {
  private readonly spindleRPM: number;
  private readonly material: string;

  constructor(opts: { spindleRPM?: number; material?: 'aluminium' | 'steel' | 'wood' | 'plastic' } = {}) {
    this.spindleRPM = opts.spindleRPM ?? 800;
    this.material   = opts.material   ?? 'aluminium';
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Generate a G76 multi-pass threading cycle.
   *
   * @param spec      Thread specification.
   * @param length_mm Threaded length (axial).
   * @param passes    Number of roughing passes (default = auto from depth).
   */
  public threadingCycle(spec: ThreadSpec, length_mm: number, passes?: number): string {
    const numPasses = passes ?? Math.max(2, Math.ceil(spec.depth_mm / 0.2));
    const infeedPerPass = spec.depth_mm / numPasses;
    const minorDiam = fmt(spec.nominalDiameter_mm - 2 * spec.depth_mm);
    const threadDepthInt = Math.round(spec.depth_mm * 1000); // μm for G76 P word
    const firstInfeed    = Math.round(infeedPerPass * 1000);
    const lead = fmt(spec.pitch_mm);

    const lines: string[] = [];
    lines.push('; ── G76 Threading Cycle ──────────────────────────────');
    lines.push(`; Standard: ${spec.standard.toUpperCase()}  Ø${fmt(spec.nominalDiameter_mm)} pitch=${lead}mm depth=${fmt(spec.depth_mm)}mm`);
    lines.push(`G21 G18 G90`);
    lines.push(`M3 S${this.spindleRPM}`);
    lines.push(`G0 X${fmt(spec.nominalDiameter_mm + 2)} Z${fmt(length_mm + 2)}`);
    lines.push(
      `G76 P${String(numPasses).padStart(2, '0')}${String(29).padStart(2, '0')}${String(100).padStart(3, '0')} ` +
      `Q${firstInfeed} R0.05`
    );
    lines.push(
      `G76 X${minorDiam} Z${fmt(-length_mm)} P${threadDepthInt} Q${firstInfeed} F${lead}`
    );
    lines.push(`G0 X${fmt(spec.nominalDiameter_mm + 5)} Z5`);
    lines.push(`M5`);
    return lines.join('\n');
  }

  /**
   * Generate a lathe toolpath for a guitar neck taper (linear interpolation).
   *
   * @param diameterAtNut_mm     Diameter at the nut end.
   * @param diameterAt12thFret_mm Diameter at the 12th fret.
   * @param length_mm            Neck length.
   * @param steps                Number of interpolation steps (default 20).
   */
  public neckProfile(
    diameterAtNut_mm: number,
    diameterAt12thFret_mm: number,
    length_mm: number,
    steps: number = 20
  ): string {
    const lines: string[] = [];
    lines.push('; ── Guitar Neck Taper Profile ────────────────────────');
    lines.push(`G21 G90`);
    lines.push(`M3 S${this.spindleRPM}`);
    lines.push(`G0 X${fmt(diameterAtNut_mm + 2)} Z2`);

    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const z = -length_mm * t;
      const d = diameterAtNut_mm + (diameterAt12thFret_mm - diameterAtNut_mm) * t;
      const feed = this.getRecommendedFeedRate(this.material, 0);
      lines.push(`G1 X${fmt(d)} Z${fmt(z)} F${fmt(feed * this.spindleRPM)}`);
    }

    lines.push(`G0 X${fmt(diameterAt12thFret_mm + 5)} Z5`);
    lines.push(`M5`);
    return lines.join('\n');
  }

  /**
   * Generate G-code for a facing + grooving operation.
   *
   * @param outerDiam_mm  Outer diameter of groove.
   * @param innerDiam_mm  Inner diameter (groove bottom).
   * @param depth_mm      Axial depth.
   */
  public faceGroove(outerDiam_mm: number, innerDiam_mm: number, depth_mm: number): string {
    const feed = fmt(this.getRecommendedFeedRate(this.material, 0) * this.spindleRPM);
    const lines: string[] = [];
    lines.push('; ── Face Groove ──────────────────────────────────────');
    lines.push(`G21 G90`);
    lines.push(`M3 S${this.spindleRPM}`);
    lines.push(`G0 X${fmt(outerDiam_mm + 1)} Z2`);
    lines.push(`G1 Z0 F${feed}`);
    lines.push(`G1 X${fmt(outerDiam_mm)} Z0 F${feed}`);
    lines.push(`G1 X${fmt(outerDiam_mm)} Z${fmt(-depth_mm)} F${fmt(Number(feed) * 0.5)}`);
    lines.push(`G1 X${fmt(innerDiam_mm)} Z${fmt(-depth_mm)} F${feed}`);
    lines.push(`G1 X${fmt(innerDiam_mm)} Z0 F${fmt(Number(feed) * 0.5)}`);
    lines.push(`G0 X${fmt(outerDiam_mm + 5)} Z5`);
    lines.push(`M5`);
    return lines.join('\n');
  }

  /**
   * Recommended feed rate in mm/rev for the given material and thread pitch.
   *
   * For threading, feed rate equals the thread pitch (1 rev = 1 pitch advance).
   * For turning/facing, use material table defaults.
   */
  public getRecommendedFeedRate(material: string, pitch_mm: number): number {
    if (pitch_mm > 0) return pitch_mm; // threading: feed = lead
    return FEED_RATE_TABLE[material] ?? 0.1;
  }
}

// ─── Constants ────────────────────────────────────────────────────────────────

/** Standard guitar tuning peg shaft dimensions (Grover/Schaller 18:1 ratio). */
export const TuningPegDimensions = {
  shaftDiam_mm:    6,
  threadPitch_mm:  0.75,
  shaftLength_mm:  38,
  buttonDiam_mm:   16,
} as const;

// ─── Internal helpers ─────────────────────────────────────────────────────────

function fmt(n: number, dp = 3): string {
  return n.toFixed(dp);
}
