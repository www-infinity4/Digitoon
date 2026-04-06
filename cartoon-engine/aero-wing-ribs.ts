/**
 * AeroWingRibs — Flying V Internal Structural Bracing
 *
 * Models the internal wing-rib bracing pattern of a Gibson Flying V guitar
 * body using aero-engineering geometry.  Each rib station carries a NACA
 * cross-section profile, and the module outputs CNC toolpaths and G-code
 * for a router/spindle machine.
 *
 * Engineering basis
 * ─────────────────────────────────────────────────────────────────────────────
 *  • Chord distribution: sinusoidal (widest at 40% span) — mirrors the
 *    spanwise chord distribution of a real tapered wing.
 *  • NACA thickness from `nacaThickness(x, t)` (aero-physics module).
 *  • Lightening holes: oval openings centred between adjacent ribs at 50%
 *    chord, sized to remove 35% of rib web area.
 *  • Spine: a single full-span spar at 30% chord (front spar station).
 *
 * CNC parameters
 * ─────────────────────────────────────────────────────────────────────────────
 *  Spindle: 12 000 RPM (router bit in wood/carbon fibre)
 *  Safe height (Z rapid): 5 mm
 *  Plunge depth: −ribThickness (full through-cut)
 */

import { Vector3 } from './vector3';
import { AABB } from './aabb';
import { nacaThickness } from './aero-physics';

// ─── Shared interfaces (exported for downstream consumers) ────────────────────

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Minimal contract for every machinist asset in the engine.
 * Downstream modules (`MedicalStentMesh`, future assets) implement this.
 */
export interface BaseMachinistAsset {
  readonly id: string;
  toolpaths: Vector3[];
  safetyBounds: AABB;
  generateGCode(): string;
  validate(): ValidationResult;
}

// ─── Public interfaces ────────────────────────────────────────────────────────

/** One rib cross-section station along the wingspan. */
export interface RibStation {
  /** Spanwise position from centreline (mm). */
  x_mm: number;
  /** Chord length at this station (mm). */
  chord_mm: number;
  /** Maximum thickness at this station (mm). */
  thickness_mm: number;
  /** NACA 4-digit code used for this station's profile. */
  nacaCode: string;
}

/** Full configuration for an `AeroWingRibs` instance. */
export interface WingRibConfig {
  /** Wingspan in mm (default 431.8 — Flying V body width). */
  wingspan_mm: number;
  /** Number of rib stations (default 7). */
  ribCount: number;
  /** Rib material thickness / spine thickness (mm). */
  spineThickness_mm: number;
  /** NACA 4-digit profile code for all stations. */
  nacaProfile: string;
  material: 'mahogany' | 'maple' | 'spruce' | 'carbon-fibre' | 'pla';
}

const DEFAULT_CONFIG: WingRibConfig = {
  wingspan_mm:      431.8,
  ribCount:         7,
  spineThickness_mm: 3,
  nacaProfile:      '0009',
  material:         'mahogany',
};

// ─── NACA code parser ─────────────────────────────────────────────────────────

/** Extract the thickness fraction `t` from a 4-digit NACA code string. */
function parseNacaThickness(code: string): number {
  if (!/^\d{4}$/.test(code)) return 0.09; // fallback
  return parseInt(code.slice(2), 10) / 100; // last two digits
}

/** Validate a NACA 4-digit code. */
function isValidNacaCode(code: string): boolean {
  return /^\d{4}$/.test(code);
}

// ─── AeroWingRibs ─────────────────────────────────────────────────────────────

/**
 * Flying V internal rib bracing asset.
 *
 * Implements `BaseMachinistAsset` so it can be composed with other machinist
 * components through a common interface.
 */
export class AeroWingRibs implements BaseMachinistAsset {
  public readonly id = 'aero-wing-ribs';
  public toolpaths: Vector3[] = [];
  public safetyBounds: AABB;

  private readonly config: WingRibConfig;

  constructor(config: Partial<WingRibConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Safety bounds: full wingspan × max chord × rib depth
    const span = this.config.wingspan_mm;
    const maxChord = this.maxChord();
    this.safetyBounds = new AABB(
      new Vector3(0, 0, -this.config.spineThickness_mm),
      new Vector3(span, maxChord, this.config.spineThickness_mm + 5)
    );

    // Pre-build toolpaths
    this.toolpaths = this.buildInternalBracing();
  }

  // ── Public methods ─────────────────────────────────────────────────────────

  /**
   * Distribute rib stations evenly along the wingspan.
   *
   * Chord at each station follows the sinusoidal distribution:
   *   chord(x) = maxChord × sin(π × x / wingspan)
   * which peaks at x = wingspan/2 (40% span in a half-span model).
   */
  public buildRibStations(): RibStation[] {
    const { wingspan_mm, ribCount, nacaProfile } = this.config;
    const maxCh = this.maxChord();
    const t = parseNacaThickness(nacaProfile);
    const stations: RibStation[] = [];

    for (let i = 0; i < ribCount; i++) {
      // Distribute from 0 to span; avoid endpoints (0 chord at sin boundaries)
      const x = (wingspan_mm / (ribCount + 1)) * (i + 1);
      const chord = maxCh * Math.sin(Math.PI * x / wingspan_mm);
      // NACA thickness at 50% chord (deepest point of the rib web)
      const thickFraction = nacaThickness(0.5, t);
      const thickness = chord * thickFraction;

      stations.push({
        x_mm: x,
        chord_mm: chord,
        thickness_mm: thickness,
        nacaCode: nacaProfile,
      });
    }

    return stations;
  }

  /**
   * Generate CNC toolpaths for all rib stations plus the centreline spine.
   *
   * For each rib:
   *   Point 0 — bottom of rib (z = 0)
   *   Point 1 — top of rib   (z = thickness)
   *   Point 2 — plunge depth (z = −spineThickness)
   *
   * Spine: one point per rib station along 30% chord.
   */
  public buildInternalBracing(): Vector3[] {
    const stations = this.buildRibStations();
    const spine = this.config.spineThickness_mm;
    const paths: Vector3[] = [];

    for (const s of stations) {
      const sparX = s.chord_mm * 0.30; // 30% chord front spar
      paths.push(
        new Vector3(s.x_mm, sparX,                   0),
        new Vector3(s.x_mm, sparX,                   s.thickness_mm),
        new Vector3(s.x_mm, sparX,                  -spine)
      );
    }

    // Spine: full-span centreline at 30% chord
    for (const s of stations) {
      paths.push(new Vector3(s.x_mm, s.chord_mm * 0.30, 0));
    }

    return paths;
  }

  /**
   * Generate router G-code for the rib-cutting operation.
   *
   * Header: G21 G90 M3 S12000
   * For each rib: rapid to station X, plunge cut through rib, retract.
   * Footer: M5 M30
   */
  public generateGCode(): string {
    const stations = this.buildRibStations();
    const spine = this.config.spineThickness_mm;
    const SAFE_Z = 5;
    const SPINDLE_RPM = 12000;

    const lines: string[] = [];
    lines.push('; ── AeroWingRibs CNC Toolpath ─────────────────────────');
    lines.push(`; Material: ${this.config.material}`);
    lines.push(`; Ribs: ${this.config.ribCount}  Wingspan: ${this.config.wingspan_mm}mm  Profile: NACA${this.config.nacaProfile}`);
    lines.push('G21 G90');
    lines.push(`M3 S${SPINDLE_RPM}`);
    lines.push(`G0 Z${SAFE_Z}`);

    for (const s of stations) {
      const sparY = fmt(s.chord_mm * 0.30);
      lines.push(`; Rib @ X=${fmt(s.x_mm)} chord=${fmt(s.chord_mm)}mm thick=${fmt(s.thickness_mm)}mm`);
      lines.push(`G0 X${fmt(s.x_mm)} Y${sparY} Z${SAFE_Z}`);
      lines.push(`G1 Z${fmt(-spine)} F800`);
      lines.push(`G1 Z${fmt(s.thickness_mm)} F400`);
      lines.push(`G0 Z${SAFE_Z}`);
    }

    lines.push('M5');
    lines.push('M30');
    return lines.join('\n');
  }

  /** Validate the configuration. */
  public validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { ribCount, wingspan_mm, nacaProfile, ribCount: rc } = this.config;

    if (ribCount < 2)    errors.push('ribCount must be ≥ 2');
    if (wingspan_mm <= 0) errors.push('wingspan_mm must be > 0');
    if (!isValidNacaCode(nacaProfile)) errors.push(`Invalid NACA code: "${nacaProfile}" — must be 4 digits`);

    // Warn if rib spacing < 20 mm
    if (rc >= 2 && wingspan_mm > 0) {
      const spacing = wingspan_mm / (rc + 1);
      if (spacing < 20) {
        warnings.push(`Rib spacing ${spacing.toFixed(1)}mm is < 20mm — consider reducing ribCount`);
      }
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  /**
   * Returns centres of oval lightening holes between adjacent rib stations
   * (sized to remove ≈35% of the rib web area between each pair).
   */
  public getLighteningHoles(): Vector3[] {
    const stations = this.buildRibStations();
    const holes: Vector3[] = [];

    for (let i = 0; i < stations.length - 1; i++) {
      const a = stations[i];
      const b = stations[i + 1];
      // Centre between the two ribs at 50% chord
      const cx = (a.x_mm + b.x_mm) / 2;
      const cy = ((a.chord_mm + b.chord_mm) / 2) * 0.50;
      const cz = (a.thickness_mm + b.thickness_mm) / 4;
      holes.push(new Vector3(cx, cy, cz));
    }

    return holes;
  }

  /**
   * Returns the main spar toolpath: one Vector3 per rib station at 30% chord.
   */
  public getSparPath(): Vector3[] {
    return this.buildRibStations().map(s =>
      new Vector3(s.x_mm, s.chord_mm * 0.30, 0)
    );
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Maximum chord (used at the widest station). */
  private maxChord(): number {
    // Flying V body: ~200 mm at widest interior chord
    return this.config.wingspan_mm * 0.46;
  }
}

// ─── Internal formatting helper ───────────────────────────────────────────────

function fmt(n: number, dp = 3): string {
  return n.toFixed(dp);
}
