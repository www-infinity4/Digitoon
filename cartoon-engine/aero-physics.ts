/**
 * Cartoon Prompt Engine — Aero-Physics & NACA Airfoil Engine
 *
 * Implements NACA 4-digit airfoil geometry, thin-airfoil aerodynamics,
 * drag polars, and a Universal V-Shape Manifestor — all from first
 * principles with no external libraries.
 *
 * ── NACA 4-Digit Series ──────────────────────────────────────────────────────
 * The NACA 4-digit designation encodes the airfoil's key shape parameters:
 *
 *   Digit 1 (m): maximum camber as a percentage of chord          e.g. 2 → m = 0.02
 *   Digit 2 (p): position of max camber in tenths of chord        e.g. 4 → p = 0.4
 *   Digits 3–4 (t): maximum thickness as a percentage of chord    e.g. 12 → t = 0.12
 *
 *   Example: NACA 2412 → m=0.02, p=0.4, t=0.12
 *            NACA 0012 → symmetric airfoil (m=0, p=0), t=0.12
 *
 * ── Thickness Distribution ───────────────────────────────────────────────────
 *   y_t(x) = 5t · (A₀√x + A₁x + A₂x² + A₃x³ + A₄x⁴)
 *
 *   where x ∈ [0,1] is normalised position along the chord (0 = LE, 1 = TE)
 *   A₀= 0.2969  A₁=−0.1260  A₂=−0.3516  A₃= 0.2843  A₄=−0.1015 (closed TE)
 *
 * ── Camber Line ──────────────────────────────────────────────────────────────
 *   For x ≤ p:   y_c = (m/p²)·(2px − x²)
 *   For x >  p:  y_c = (m/(1−p)²)·((1−2p) + 2px − x²)
 *
 * ── Thin-Airfoil Theory (CL, CM) ─────────────────────────────────────────────
 *   CL  = 2π·(α − α_L0)                    [lift-curve slope 2π per radian]
 *   α_L0 ≈ −2m·(1−p) + p·(2m/p²)          [zero-lift angle approximation]
 *   CM_ac = −π·m·(p − 0.5)/2               [pitching moment about aero centre]
 *
 * ── Drag Polar ───────────────────────────────────────────────────────────────
 *   CD = CD₀ + CL²/(π·e·AR)               [parabolic drag polar, 3-D wing]
 *   CD₀ ≈ 0.006 (laminar) to 0.012 (turbulent) for typical sections
 *   e   ≈ 0.85  (Oswald efficiency factor)
 *
 * ── Universal V-Shape ────────────────────────────────────────────────────────
 *   The "V" is a parametric taper that maps identically to:
 *     Aero    — wing leading edge / cape sweep
 *     Medical — surgical needle taper / stent flow path
 *     Cartoon — hero torso silhouette (wide shoulders → narrow waist)
 *
 * Usage:
 *   import { NacaAirfoil, AeroOptimizer, VShapeManifestor } from './aero-physics';
 *
 *   const foil   = new NacaAirfoil('2412');
 *   const coords = foil.coordinates(100);           // 100 points per surface
 *   const lift   = foil.liftCoefficient_rad(0.05);  // α = 0.05 rad → CL
 *
 *   const vShape = VShapeManifestor.forCape({ sweepAngle_deg: 35, span_m: 1.2, t: 0.10 });
 */

// ---------------------------------------------------------------------------
// Math helpers (no external deps)
// ---------------------------------------------------------------------------

/** Clamp x to [lo, hi]. */
function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

/** Linear interpolation. */
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 2-D point for airfoil coordinates. */
export interface AeroPoint { x: number; y: number; }

// ---------------------------------------------------------------------------
// NACA 4-digit thickness & camber (the core "V-shape" mathematics)
// ---------------------------------------------------------------------------

/**
 * NACA 4-digit thickness distribution constants.
 * These coefficients are the NACA standard (Abbott & Von Doenhoff, 1959).
 */
const NACA_A0 =  0.2969;
const NACA_A1 = -0.1260;
const NACA_A2 = -0.3516;
const NACA_A3 =  0.2843;
const NACA_A4 = -0.1015;  // closed trailing edge (y_t = 0 at x = 1)

/**
 * nacaThickness
 *
 * Half-thickness y_t at normalised chord position x for a NACA 4-digit airfoil.
 *
 *   y_t(x) = 5t · (A₀√x + A₁x + A₂x² + A₃x³ + A₄x⁴)
 *
 * @param x  Normalised chord position [0, 1].  x=0 = leading edge, x=1 = trailing edge.
 * @param t  Maximum thickness as a fraction of chord (e.g. 0.12 for a 12 % thick section).
 */
export function nacaThickness(x: number, t: number): number {
  const xc = clamp(x, 0, 1);
  return 5 * t * (
    NACA_A0 * Math.sqrt(xc) +
    NACA_A1 * xc +
    NACA_A2 * xc ** 2 +
    NACA_A3 * xc ** 3 +
    NACA_A4 * xc ** 4
  );
}

/**
 * nacaCamber
 *
 * Camber line y_c and its gradient dy_c/dx at position x.
 *
 *   For x ≤ p:  y_c = (m/p²)·(2px − x²)
 *   For x > p:  y_c = (m/(1−p)²)·((1−2p) + 2px − x²)
 *
 * @param x  Normalised chord position [0, 1].
 * @param m  Maximum camber fraction (e.g. 0.02 for NACA 2xxx).
 * @param p  Position of maximum camber (0–1).
 */
export function nacaCamber(x: number, m: number, p: number): { y_c: number; dy_c: number } {
  const xc = clamp(x, 0, 1);
  if (m === 0 || p === 0) return { y_c: 0, dy_c: 0 };

  if (xc <= p) {
    return {
      y_c:  (m / p ** 2) * (2 * p * xc - xc ** 2),
      dy_c: (2 * m / p ** 2) * (p - xc),
    };
  } else {
    return {
      y_c:  (m / (1 - p) ** 2) * ((1 - 2 * p) + 2 * p * xc - xc ** 2),
      dy_c: (2 * m / (1 - p) ** 2) * (p - xc),
    };
  }
}

// ---------------------------------------------------------------------------
// NacaAirfoil — complete 4-digit geometry generator
// ---------------------------------------------------------------------------

/** Upper and lower surface coordinate arrays. */
export interface AirfoilCoordinates {
  upper: AeroPoint[];
  lower: AeroPoint[];
  /** Coordinates in "wrap-around" order: upper LE→TE then lower TE→LE.
   *  Ready for polygon rendering / mesh generation. */
  polygon: AeroPoint[];
}

/** Aerodynamic coefficients for a given angle of attack. */
export interface AeroCoefficients {
  /** Angle of attack (radians). */
  alpha_rad: number;
  /** Angle of attack (degrees). */
  alpha_deg: number;
  /** Lift coefficient (thin-airfoil theory). */
  CL: number;
  /** Zero-lift angle of attack (radians). */
  alpha_L0_rad: number;
  /** Pitching moment coefficient about the aerodynamic centre (x/c = 0.25). */
  CM_ac: number;
  /** Whether the airfoil is likely stalled (α > α_stall). */
  stalled: boolean;
}

/**
 * NacaAirfoil
 *
 * A NACA 4-digit series airfoil.  Generates the complete upper and lower
 * surface coordinate geometry and computes thin-airfoil aerodynamics.
 *
 * @example
 * const foil = new NacaAirfoil('2412');        // or NacaAirfoil.fromParams(0.02, 0.4, 0.12)
 * const pts  = foil.coordinates(64);           // 64 points per surface
 * const cl   = foil.liftCoefficient_rad(0.05); // α = 0.05 rad → CL ≈ 0.775
 */
export class NacaAirfoil {
  /** Maximum camber (fraction of chord). */
  readonly m: number;
  /** Position of max camber (fraction of chord, 0–1). */
  readonly p: number;
  /** Maximum thickness (fraction of chord). */
  readonly t: number;
  /** NACA designation string (e.g. "2412"). */
  readonly designation: string;

  constructor(designation: string) {
    if (!/^\d{4}$/.test(designation)) {
      throw new Error(
        `NacaAirfoil: designation must be a 4-digit string (e.g. "2412"), got "${designation}"`
      );
    }
    this.designation = designation;
    this.m = parseInt(designation[0], 10) / 100;
    this.p = parseInt(designation[1], 10) / 10;
    this.t = parseInt(designation.slice(2), 10) / 100;

    if (this.t <= 0) {
      throw new RangeError(`NacaAirfoil: thickness must be > 0 (got "${designation}")`);
    }
  }

  /** Construct from explicit parameters. */
  static fromParams(m: number, p: number, t: number): NacaAirfoil {
    const m_ = Math.round(m * 100);
    const p_ = Math.round(p * 10);
    const t_ = Math.round(t * 100);
    const des = `${m_}${p_}${String(t_).padStart(2, '0')}`;
    return new NacaAirfoil(des);
  }

  // ── Geometry ──────────────────────────────────────────────────────────────

  /**
   * coordinates
   *
   * Generates the upper and lower surface coordinates for this airfoil.
   * The chord runs from x=0 (leading edge) to x=1 (trailing edge).
   *
   * @param n  Number of points per surface (including LE and TE).  Default 64.
   *           Higher n = smoother mesh, more computation.
   */
  coordinates(n = 64): AirfoilCoordinates {
    // Cosine spacing — clusters points near LE and TE for accuracy
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      xs.push(0.5 * (1 - Math.cos((i / (n - 1)) * Math.PI)));
    }

    const upper: AeroPoint[] = [];
    const lower: AeroPoint[] = [];

    for (const x of xs) {
      const y_t = nacaThickness(x, this.t);
      const { y_c, dy_c } = nacaCamber(x, this.m, this.p);
      const θ = Math.atan(dy_c);

      upper.push({
        x: x - y_t * Math.sin(θ),
        y: y_c + y_t * Math.cos(θ),
      });
      lower.push({
        x: x + y_t * Math.sin(θ),
        y: y_c - y_t * Math.cos(θ),
      });
    }

    // Polygon: upper LE→TE, lower TE→LE (closed loop)
    const polygon: AeroPoint[] = [
      ...upper,
      ...[...lower].reverse(),
    ];

    return { upper, lower, polygon };
  }

  /**
   * leadingEdgeRadius
   *
   * Radius of curvature at the leading edge (as a fraction of chord).
   *
   *   r_LE = 1.1019 · t²
   *
   * This is the "machinist's point" — where airflow splits and where
   * the curvature is most critical for low-speed performance.
   *
   * @param chord_m  Physical chord length in metres (optional — scales the result).
   */
  leadingEdgeRadius(chord_m = 1): number {
    return 1.1019 * (this.t ** 2) * chord_m;
  }

  /**
   * trailingEdgeAngle_deg
   *
   * The half-angle of the trailing edge wedge (degrees).
   * A blunter TE is stronger but creates more pressure drag.
   * Sharp TE (≈0°) is ideal aerodynamically but fragile.
   *
   * Approximation based on NACA geometry:
   *   τ ≈ 2 · arctan(1.16925 · t)   (degrees)
   */
  trailingEdgeAngle_deg(): number {
    return 2 * (Math.atan(1.16925 * this.t) * 180) / Math.PI;
  }

  // ── Thin-airfoil aerodynamics ─────────────────────────────────────────────

  /**
   * zeroLiftAngle_rad
   *
   * Angle of attack at which lift = 0 (radians).
   * For a symmetric airfoil (m=0): α_L0 = 0.
   * For a cambered airfoil:  α_L0 ≈ −2m·(1−p) + correction for position.
   *
   * Thin-airfoil theory result:
   *   α_L0 = −(2m/π) · [(π − arccos(1 − 2p)) + sin(arccos(1 − 2p))]  [simplified]
   */
  zeroLiftAngle_rad(): number {
    if (this.m === 0) return 0;
    const φ = Math.acos(1 - 2 * this.p);   // mapped angle for position p
    return -(2 * this.m / Math.PI) * (Math.PI - φ + Math.sin(φ));
  }

  /**
   * liftCoefficient_rad
   *
   * Lift coefficient at a given angle of attack (radians) — thin-airfoil theory.
   *
   *   CL = 2π · (α − α_L0)
   *
   * Valid for attached flow, typically |α| < ~15° for typical sections.
   * Returns 0 below α_L0; does NOT model stall.
   *
   * @param alpha_rad  Geometric angle of attack (radians, positive = nose up).
   */
  liftCoefficient_rad(alpha_rad: number): number {
    return 2 * Math.PI * (alpha_rad - this.zeroLiftAngle_rad());
  }

  /**
   * liftCoefficient_deg
   *
   * Lift coefficient at a given angle of attack (degrees).
   *
   * @param alpha_deg  Geometric angle of attack (degrees).
   */
  liftCoefficient_deg(alpha_deg: number): number {
    return this.liftCoefficient_rad((alpha_deg * Math.PI) / 180);
  }

  /**
   * pitchingMoment_ac
   *
   * Pitching moment coefficient about the aerodynamic centre (x/c = 0.25).
   *
   *   CM_ac = −π·m·(p − 0.5)/2     [thin-airfoil theory]
   *
   * Negative = nose-down pitching (destabilising for aft-cambered airfoils).
   */
  pitchingMoment_ac(): number {
    if (this.m === 0) return 0;
    return -(Math.PI * this.m * (this.p - 0.5)) / 2;
  }

  /**
   * coefficients
   *
   * Returns the complete set of aerodynamic coefficients at the given angle
   * of attack.  Includes a basic stall flag (α > 15° or < −8°).
   *
   * @param alpha_deg  Geometric angle of attack (degrees).
   */
  coefficients(alpha_deg: number): AeroCoefficients {
    const alpha_rad = (alpha_deg * Math.PI) / 180;
    const alpha_L0  = this.zeroLiftAngle_rad();
    const CL        = 2 * Math.PI * (alpha_rad - alpha_L0);

    return {
      alpha_rad,
      alpha_deg,
      CL,
      alpha_L0_rad: alpha_L0,
      CM_ac:        this.pitchingMoment_ac(),
      stalled:      alpha_deg > 15 || alpha_deg < -8,
    };
  }

  /** Human-readable summary. */
  toString(): string {
    return (
      `NACA ${this.designation}  m=${(this.m * 100).toFixed(0)}%  ` +
      `p=${(this.p * 10).toFixed(0)}0%  t=${(this.t * 100).toFixed(0)}%  ` +
      `r_LE=${(this.leadingEdgeRadius() * 1000).toFixed(2)}mm/m  ` +
      `α_L0=${((this.zeroLiftAngle_rad() * 180) / Math.PI).toFixed(2)}°`
    );
  }
}

// ---------------------------------------------------------------------------
// AeroOptimizer — the class from the requirement, expanded
// ---------------------------------------------------------------------------

/**
 * AeroOptimizer
 *
 * Computes NACA-standard thickness and curvature values used for
 * both aerodynamic and visual-design optimisation.
 *
 * The same mathematics that shapes a wing leading edge also shapes:
 *   • A cartoon hero's torso silhouette (wide-to-narrow "hero V")
 *   • A surgical needle's taper (medical stent flow path)
 *   • A CNC milling tool path (machinist chamfer profile)
 */
export class AeroOptimizer {
  // NACA 4-digit thickness distribution constants (Abbott & Von Doenhoff, 1959)
  private static readonly A0 =  0.2969;
  private static readonly A1 = -0.1260;
  private static readonly A2 = -0.3516;
  private static readonly A3 =  0.2843;
  private static readonly A4 = -0.1015;  // closed trailing edge

  /**
   * calculateThickness
   *
   * Half-thickness y_t at normalised chord position x.
   *   y_t = 5t · (A₀√x + A₁x + A₂x² + A₃x³ + A₄x⁴)
   *
   * @param x  Normalised position [0,1] along the V-axis (0=apex, 1=base).
   * @param t  Maximum thickness as a fraction of chord/span (e.g. 0.12 = 12 %).
   */
  public calculateThickness(x: number, t: number): number {
    const xc = clamp(x, 0, 1);
    return 5 * t * (
      AeroOptimizer.A0 * Math.sqrt(xc) +
      AeroOptimizer.A1 * xc +
      AeroOptimizer.A2 * xc ** 2 +
      AeroOptimizer.A3 * xc ** 3 +
      AeroOptimizer.A4 * xc ** 4
    );
  }

  /**
   * getLeadingEdgeRadius
   *
   * Radius of the leading-edge "machinist's point" (fraction of chord):
   *   r_LE = 1.1019 · (t·c)²
   *
   * @param t  Thickness fraction.
   * @param c  Chord length (metres).  Result is in metres.
   */
  public getLeadingEdgeRadius(t: number, c: number): number {
    return 1.1019 * (t * c) ** 2;
  }

  /**
   * vShapeProfile
   *
   * Generates n points describing one side of a V-shape profile using
   * the NACA thickness distribution.  Mirror across the centreline for
   * the full V.
   *
   * @param n  Number of points (default 64).
   * @param t  V-width parameter (thickness fraction, 0–1).
   */
  public vShapeProfile(n = 64, t = 0.12): AeroPoint[] {
    const pts: AeroPoint[] = [];
    for (let i = 0; i < n; i++) {
      const x = i / (n - 1);
      pts.push({ x, y: this.calculateThickness(x, t) });
    }
    return pts;
  }

  /**
   * optimiseForLift
   *
   * Given a target CL, find the required angle of attack for a given
   * NACA 4-digit designation.
   *
   *   α = α_L0 + CL / (2π)
   *
   * @param designation  NACA 4-digit string.
   * @param targetCL     Desired lift coefficient.
   * @returns            Required angle of attack in degrees.
   */
  public optimiseForLift(designation: string, targetCL: number): number {
    const foil    = new NacaAirfoil(designation);
    const α_L0    = foil.zeroLiftAngle_rad();
    const α_rad   = α_L0 + targetCL / (2 * Math.PI);
    return (α_rad * 180) / Math.PI;
  }

  /**
   * cncToolpaths
   *
   * Converts a NACA profile into a series of CNC G-code style toolpath
   * waypoints (X, Z pairs in mm) for machining an airfoil section.
   *
   * The chord is scaled to `chordLength_mm`.  Tool moves from TE to LE
   * on the upper surface, then LE to TE on the lower surface.
   *
   * @param designation   NACA 4-digit string.
   * @param chordLength_mm  Physical chord length in millimetres.
   * @param n               Number of toolpath points (default 128).
   */
  public cncToolpaths(
    designation: string,
    chordLength_mm: number,
    n = 128
  ): { upper: AeroPoint[]; lower: AeroPoint[] } {
    const foil   = new NacaAirfoil(designation);
    const coords = foil.coordinates(n);

    const scale = (pts: AeroPoint[]): AeroPoint[] =>
      pts.map((p) => ({ x: p.x * chordLength_mm, y: p.y * chordLength_mm }));

    return {
      upper: scale(coords.upper),
      lower: scale(coords.lower),
    };
  }
}

// ---------------------------------------------------------------------------
// DragPolar — 3-D wing drag model
// ---------------------------------------------------------------------------

/** Configuration for a finite 3-D wing drag polar calculation. */
export interface WingConfig {
  /** Aspect ratio AR = b²/S  (e.g. 6 for a typical aircraft, 20 for a glider). */
  aspectRatio: number;
  /**
   * Oswald span efficiency factor e (0–1).
   * Elliptical wing = 1.0 (theoretical max).  Typical: 0.75–0.92.
   */
  oswaldEfficiency?: number;
  /**
   * Zero-lift drag coefficient CD₀.
   * Laminar flat plate: ≈ 0.004.
   * Typical clean aerofoil: 0.006–0.008.
   * Turbulent: 0.010–0.015.
   */
  CD0?: number;
  /**
   * NACA airfoil designation used for this wing section.
   * Determines the zero-lift angle and camber.
   */
  nacaDesignation?: string;
}

/** Point on a drag polar (CL vs CD). */
export interface DragPolarPoint {
  alpha_deg: number;
  CL: number;
  CD: number;
  /** Lift-to-drag ratio. */
  LD_ratio: number;
  /** Whether this point is beyond estimated stall. */
  stalled: boolean;
}

/**
 * DragPolar
 *
 * Parabolic drag polar for a finite wing:
 *   CD = CD₀ + CL² / (π · e · AR)
 *
 * Used to find the optimum lift coefficient for best L/D ratio and to
 * size wings for cartoon capes, aero vehicles, and medical implant flow paths.
 */
export class DragPolar {
  readonly config: Required<WingConfig>;
  readonly airfoil: NacaAirfoil | null;

  constructor(config: WingConfig) {
    this.config = {
      aspectRatio:      config.aspectRatio,
      oswaldEfficiency: config.oswaldEfficiency ?? 0.85,
      CD0:              config.CD0              ?? 0.007,
      nacaDesignation:  config.nacaDesignation  ?? '2412',
    };
    this.airfoil = config.nacaDesignation
      ? new NacaAirfoil(config.nacaDesignation)
      : null;
  }

  /**
   * inducedDrag
   *
   * Induced drag coefficient for a given CL.
   *   CD_i = CL² / (π · e · AR)
   */
  inducedDrag(CL: number): number {
    return CL ** 2 / (Math.PI * this.config.oswaldEfficiency * this.config.aspectRatio);
  }

  /**
   * totalDrag
   *
   * Total drag coefficient at a given CL.
   *   CD = CD₀ + CD_i
   */
  totalDrag(CL: number): number {
    return this.config.CD0 + this.inducedDrag(CL);
  }

  /**
   * bestLiftToDrag
   *
   * Optimal CL for maximum L/D (minimum drag at given lift):
   *   CL_opt = sqrt(CD₀ · π · e · AR)
   *   CD_opt = 2 · CD₀
   *   (L/D)_max = CL_opt / CD_opt
   */
  bestLiftToDrag(): { CL_opt: number; CD_opt: number; LD_max: number } {
    const CL_opt = Math.sqrt(this.config.CD0 * Math.PI * this.config.oswaldEfficiency * this.config.aspectRatio);
    const CD_opt = 2 * this.config.CD0;
    return { CL_opt, CD_opt, LD_max: CL_opt / CD_opt };
  }

  /**
   * polar
   *
   * Generates the full drag polar table over a range of angles of attack.
   *
   * @param alphaRange_deg  [min, max] angle of attack in degrees.
   * @param steps           Number of points in the table.
   */
  polar(alphaRange_deg: [number, number] = [-5, 20], steps = 50): DragPolarPoint[] {
    const [αMin, αMax] = alphaRange_deg;
    const results: DragPolarPoint[] = [];

    for (let i = 0; i <= steps; i++) {
      const alpha_deg = lerp(αMin, αMax, i / steps);
      const CL = this.airfoil
        ? this.airfoil.liftCoefficient_deg(alpha_deg)
        : 2 * Math.PI * (alpha_deg * Math.PI) / 180;
      const CD = this.totalDrag(CL);
      const stalled = this.airfoil
        ? this.airfoil.coefficients(alpha_deg).stalled
        : false;

      results.push({
        alpha_deg,
        CL,
        CD,
        LD_ratio: CD === 0 ? 0 : CL / CD,
        stalled,
      });
    }
    return results;
  }
}

// ---------------------------------------------------------------------------
// Reynolds number & flow regime
// ---------------------------------------------------------------------------

/** Standard atmospheric properties at sea level (ISA). */
export const ISA_SEA_LEVEL = {
  density_kgm3:          1.225,
  dynamicViscosity_Pa_s: 1.789e-5,
  temperature_K:         288.15,
  pressure_Pa:           101325,
  speedOfSound_ms:       340.3,
};

/**
 * reynoldsNumber
 *
 * Re = ρ · V · L / μ
 *
 * Determines whether the boundary layer is laminar (Re < ~500,000) or
 * turbulent (Re > ~1,000,000), which governs drag and stall behaviour.
 *
 * @param velocity_ms        Airspeed (m/s).
 * @param chordLength_m      Reference length — chord for an airfoil (m).
 * @param density_kgm3       Air density (kg/m³).  Default: ISA sea level.
 * @param viscosity_Pa_s     Dynamic viscosity (Pa·s).  Default: ISA sea level.
 */
export function reynoldsNumber(
  velocity_ms: number,
  chordLength_m: number,
  density_kgm3   = ISA_SEA_LEVEL.density_kgm3,
  viscosity_Pa_s = ISA_SEA_LEVEL.dynamicViscosity_Pa_s
): number {
  return (density_kgm3 * velocity_ms * chordLength_m) / viscosity_Pa_s;
}

/** Flow regime determined from Reynolds number. */
export function flowRegime(Re: number): 'laminar' | 'transitional' | 'turbulent' {
  if (Re < 5e5)  return 'laminar';
  if (Re < 1e6)  return 'transitional';
  return 'turbulent';
}

// ---------------------------------------------------------------------------
// Universal V-Shape Manifestor
// ---------------------------------------------------------------------------

/** The three domain contexts in which a V-shape is manifested. */
export type VShapeDomain = 'aero' | 'medical' | 'cartoon';

/** Parameters that define a V-shape across all domains. */
export interface VShapeParams {
  /**
   * Opening angle of the V (degrees from centreline to one side).
   * Machinist V-block: 30° or 45°.  Aero sweep: 15°–65°.
   * Medical taper: 5°–15°.  Cartoon hero torso: 25°–40°.
   */
  openingAngle_deg: number;
  /**
   * Depth of the V (normalised 0–1 or physical metres).
   * In machining: depth of cut.  In aero: half-span.
   * In cartoon: distance from shoulders to waist.
   */
  depth: number;
  /**
   * Vertex (tip) blend radius as a fraction of depth.
   * 0 = sharp point (machinist's point).  1 = fully rounded.
   * Aero: ≈ 0.02 (sharp LE).  Cartoon: ≈ 0.15 (soft).  Medical: ≈ 0.05.
   */
  vertexRadius_fraction?: number;
  /** NACA thickness fraction to use for edge profile. Default 0.12. */
  thicknessProfile?: number;
}

/** A fully manifested V-shape with coordinates and domain-specific annotations. */
export interface VShapeManifest {
  domain:     VShapeDomain;
  params:     VShapeParams;
  /** Left and right edge coordinates (n points each). */
  left_edge:  AeroPoint[];
  right_edge: AeroPoint[];
  /** Centre line from vertex to base. */
  centreline: AeroPoint[];
  /** Domain-specific prompt descriptor for the animation engine. */
  promptDescriptor: string;
  /** Domain-specific engineering notes. */
  engineeringNotes: string;
  /** Bounding box of the manifested shape. */
  bounds: { width: number; height: number; aspectRatio: number };
}

/**
 * VShapeManifestor
 *
 * Generates a "V-shape" using NACA thickness mathematics, then annotates
 * it for the appropriate domain.  The same mathematical object serves as:
 *
 *   aero    — cape sweep, wing leading edge, turbine blade taper
 *   medical — surgical needle taper, stent lumen, incision guide
 *   cartoon — hero torso silhouette, heroic shoulder-to-waist sweep
 *
 * The vertex is placed at (0, 0) and the base at (0, depth).
 * Left and right edges flare out at ±openingAngle_deg.
 */
export class VShapeManifestor {

  /**
   * manifest
   *
   * Generate the complete V-shape for a given domain.
   *
   * @param domain  'aero' | 'medical' | 'cartoon'
   * @param params  V-shape geometry parameters.
   * @param n       Number of points per edge (default 64).
   */
  static manifest(
    domain: VShapeDomain,
    params: VShapeParams,
    n = 64
  ): VShapeManifest {
    const {
      openingAngle_deg,
      depth,
      vertexRadius_fraction = 0.05,
      thicknessProfile      = 0.12,
    } = params;

    const halfAngle_rad = (openingAngle_deg * Math.PI) / 180;
    const optimizer     = new AeroOptimizer();

    const left_edge:  AeroPoint[] = [];
    const right_edge: AeroPoint[] = [];
    const centreline: AeroPoint[] = [];

    for (let i = 0; i < n; i++) {
      const t_norm = i / (n - 1);              // 0 at vertex, 1 at base
      const y      = t_norm * depth;            // depth position

      // Edge flare: half-width at position y
      // Use NACA thickness to blend from sharp tip to full width
      const nacaT  = optimizer.calculateThickness(t_norm, thicknessProfile);
      const linearX = y * Math.tan(halfAngle_rad);

      // Blend between NACA-rounded vertex and linear flare
      const blendFactor = clamp(t_norm / (vertexRadius_fraction + 0.001), 0, 1);
      const halfWidth   = lerp(nacaT * depth, linearX, blendFactor);

      left_edge.push(  { x: -halfWidth, y });
      right_edge.push( { x:  halfWidth, y });
      centreline.push( { x: 0,          y });
    }

    const maxWidth = 2 * (depth * Math.tan(halfAngle_rad));
    const bounds   = {
      width:       maxWidth,
      height:      depth,
      aspectRatio: depth / Math.max(maxWidth, 1e-9),
    };

    const { promptDescriptor, engineeringNotes } =
      VShapeManifestor._domainAnnotations(domain, params, bounds);

    return { domain, params, left_edge, right_edge, centreline, promptDescriptor, engineeringNotes, bounds };
  }

  // ── Convenience factories ─────────────────────────────────────────────────

  /** Manifests a cartoon hero torso silhouette (wide shoulders → narrow waist). */
  static forHeroTorso(sweepAngle_deg = 30, height_m = 0.6): VShapeManifest {
    return VShapeManifestor.manifest('cartoon', {
      openingAngle_deg:       sweepAngle_deg,
      depth:                  height_m,
      vertexRadius_fraction:  0.15,
      thicknessProfile:       0.20,
    });
  }

  /** Manifests an aero cape sweep shape (wing/cape leading edge). */
  static forCape(options: { sweepAngle_deg: number; span_m: number; t?: number }): VShapeManifest {
    return VShapeManifestor.manifest('aero', {
      openingAngle_deg:       options.sweepAngle_deg,
      depth:                  options.span_m,
      vertexRadius_fraction:  0.02,
      thicknessProfile:       options.t ?? 0.10,
    });
  }

  /** Manifests a medical needle or stent taper. */
  static forNeedle(taperAngle_deg = 8, length_mm = 40): VShapeManifest {
    return VShapeManifestor.manifest('medical', {
      openingAngle_deg:       taperAngle_deg,
      depth:                  length_mm / 1000,  // mm → m
      vertexRadius_fraction:  0.01,
      thicknessProfile:       0.06,
    });
  }

  // ── Domain annotations ────────────────────────────────────────────────────

  private static _domainAnnotations(
    domain: VShapeDomain,
    params: VShapeParams,
    bounds: VShapeManifest['bounds']
  ): { promptDescriptor: string; engineeringNotes: string } {
    const α  = params.openingAngle_deg.toFixed(1);
    const d  = params.depth.toFixed(3);
    const ar = bounds.aspectRatio.toFixed(2);

    switch (domain) {
      case 'aero':
        return {
          promptDescriptor:
            `aerodynamic V-shape, ${α}° leading-edge sweep, ` +
            `streamlined taper from apex to ${d}m span, ` +
            `NACA thickness profile, sharp leading edge, ` +
            `smooth laminar surface, aerospace precision finish`,
          engineeringNotes:
            `Sweep angle ${α}°, half-span ${d}m. ` +
            `AR context ${ar}. ` +
            `Leading-edge radius = ${(1.1019 * (params.thicknessProfile ?? 0.12) ** 2 * parseFloat(d) * 1000).toFixed(2)}mm. ` +
            `Use NACA ${Math.round((params.thicknessProfile ?? 0.12) * 100).toString().padStart(4, '00')} section for LE detail.`,
        };

      case 'medical':
        return {
          promptDescriptor:
            `precision medical taper, ${α}° incision-guide V-angle, ` +
            `surgical-grade smooth surface, sterile matte finish, ` +
            `micro-machined tip, ISO 13485 manufacturing standard`,
          engineeringNotes:
            `Taper angle ${α}° (half-angle), length ${(parseFloat(d) * 1000).toFixed(1)}mm. ` +
            `Tip radius ≈ ${(1.1019 * (params.thicknessProfile ?? 0.06) ** 2 * parseFloat(d) * 1000 * 1000).toFixed(3)}μm. ` +
            `Surface finish Ra < 0.2μm required. Electropolish after machining.`,
        };

      case 'cartoon':
        return {
          promptDescriptor:
            `hero silhouette V-shape, ${α}° shoulder-to-waist sweep, ` +
            `strong heroic proportions, clean cel-shaded outline, ` +
            `dominant upper-body mass, tapering to narrow waist, ` +
            `Disney hero design principle — readable at thumbnail scale`,
          engineeringNotes:
            `Shoulder sweep ${α}°, torso height ${(parseFloat(d) * 100).toFixed(1)}cm. ` +
            `Shoulder-to-waist ratio = ${(1 + Math.tan((params.openingAngle_deg * Math.PI) / 180)).toFixed(2)}. ` +
            `V-ratio (width/height) = ${(1 / parseFloat(ar)).toFixed(2)}. ` +
            `For cel animation: add 2px black outline to the V silhouette edge.`,
        };
    }
  }
}

// ---------------------------------------------------------------------------
// Lift & weight estimation (for sized cartoon capes / aero vehicles)
// ---------------------------------------------------------------------------

/**
 * liftForce_N
 *
 * L = ½ · ρ · V² · S · CL
 *
 * @param velocity_ms   True airspeed (m/s).
 * @param wingArea_m2   Wing / cape planform area (m²).
 * @param CL            Lift coefficient.
 * @param density_kgm3  Air density (default ISA SL).
 */
export function liftForce_N(
  velocity_ms: number,
  wingArea_m2: number,
  CL:  number,
  density_kgm3 = ISA_SEA_LEVEL.density_kgm3
): number {
  return 0.5 * density_kgm3 * velocity_ms ** 2 * wingArea_m2 * CL;
}

/**
 * dragForce_N
 *
 * D = ½ · ρ · V² · S · CD
 */
export function dragForce_N(
  velocity_ms: number,
  wingArea_m2: number,
  CD:  number,
  density_kgm3 = ISA_SEA_LEVEL.density_kgm3
): number {
  return 0.5 * density_kgm3 * velocity_ms ** 2 * wingArea_m2 * CD;
}

/**
 * stallSpeed_ms
 *
 * V_stall = sqrt(2W / (ρ · S · CL_max))
 *
 * Minimum speed at which the wing can support the given weight.
 *
 * @param weight_N    Aircraft / character weight in Newtons.
 * @param wingArea_m2 Wing planform area (m²).
 * @param CL_max      Maximum lift coefficient (typically 1.2–2.5).
 */
export function stallSpeed_ms(
  weight_N:    number,
  wingArea_m2: number,
  CL_max:      number,
  density_kgm3 = ISA_SEA_LEVEL.density_kgm3
): number {
  return Math.sqrt((2 * weight_N) / (density_kgm3 * wingArea_m2 * CL_max));
}

// ---------------------------------------------------------------------------
// Pre-built airfoil library
// ---------------------------------------------------------------------------

export const AIRFOIL_LIBRARY: Record<string, { foil: NacaAirfoil; use_case: string }> = {
  symmetric_thin:    { foil: new NacaAirfoil('0009'), use_case: 'High-speed tail surfaces, cartoon blade shapes' },
  symmetric_medium:  { foil: new NacaAirfoil('0012'), use_case: 'General purpose, aerobatic, machinist demo section' },
  low_speed_lift:    { foil: new NacaAirfoil('2412'), use_case: 'Light aircraft, cartoon cape, medical stent curve' },
  high_camber:       { foil: new NacaAirfoil('4412'), use_case: 'High-lift slow flight, superhero cape at glide' },
  racing_thin:       { foil: new NacaAirfoil('6412'), use_case: 'High-performance race surface, character speed-lines' },
  thick_structural:  { foil: new NacaAirfoil('0021'), use_case: 'Structural wing root, cartoon arm/leg cross-section' },
};
