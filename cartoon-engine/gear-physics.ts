/**
 * Cartoon Prompt Engine — Involute Gear Physics Engine
 *
 * Implements the complete mathematical framework for involute spur gears,
 * helical gears, gear trains, and torque transfer — built entirely from
 * first principles with no external libraries.
 *
 * ── Involute Geometry ────────────────────────────────────────────────────────
 * An involute curve is the path traced by the end of a taut string as it
 * unwinds from a circle (the "base circle").  This geometry is the universal
 * tooth-profile standard for precision gears because:
 *   1. The pressure angle between meshing teeth remains constant throughout
 *      the contact arc — enabling smooth, low-vibration power transfer.
 *   2. Centre-distance errors do not affect the gear ratio — only the
 *      operating pressure angle changes slightly.
 *
 * Parametric involute equations (base circle radius r):
 *   x(θ) = r · (cos θ + θ · sin θ)
 *   y(θ) = r · (sin θ − θ · cos θ)
 *
 * ── Core Gear Dimensions ─────────────────────────────────────────────────────
 *   Module m:          fundamental size parameter (pitch / π)
 *   Pitch diameter:    d_p = N · m
 *   Base diameter:     d_b = d_p · cos α        (α = pressure angle, typ. 20°)
 *   Addendum:          a   = m                  (tooth above pitch circle)
 *   Dedendum:          b   = 1.25 · m           (tooth below pitch circle)
 *   Outside diameter:  d_o = d_p + 2m
 *   Root diameter:     d_r = d_p − 2.5m
 *   Circular pitch:    p_c = π · m
 *   Base pitch:        p_b = p_c · cos α
 *
 * ── Gear Train Mechanics ─────────────────────────────────────────────────────
 *   Gear ratio:        i   = N_driven / N_driver = ω_driver / ω_driven
 *   Speed output:      ω₂ = ω₁ / i
 *   Torque output:     τ₂ = τ₁ · i · η          (η = mesh efficiency ≈ 0.98)
 *   Power:             P  = τ · ω                (conserved minus losses)
 *
 * Usage:
 *   import { InvoluteGear, GearTrain, involutePoint } from './gear-physics';
 *
 *   const driver = new InvoluteGear({ teeth: 24, module: 1, pressureAngle_deg: 20 });
 *   const driven = new InvoluteGear({ teeth: 48, module: 1, pressureAngle_deg: 20 });
 *   const train  = new GearTrain([driver, driven]);
 *
 *   console.log(train.outputSpeed_rpm(100));   // → 50 rpm
 *   console.log(train.outputTorque_Nm(10));    // → 19.6 N·m  (×2 ratio × 0.98 eff.)
 *   console.log(driver.toothProfile(20));      // → array of {x, y} involute points
 */

// ---------------------------------------------------------------------------
// Vector helpers (2-D, no external deps)
// ---------------------------------------------------------------------------

/** A 2-D point in Cartesian space (normalised units or mm — caller's choice). */
export interface Vec2 { x: number; y: number; }

/** Rotate a 2-D vector by `angle` radians around the origin. */
function rotateVec2(v: Vec2, angle: number): Vec2 {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
}

/** Euclidean distance between two 2-D points. */
export function dist2(a: Vec2, b: Vec2): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  return Math.sqrt(dx * dx + dy * dy);
}

// ---------------------------------------------------------------------------
// Involute curve — the mathematical heart of every precision gear
// ---------------------------------------------------------------------------

/**
 * involutePoint
 *
 * Returns the (x, y) position on the involute of a circle of radius `r`
 * at involute parameter `t` (radians).
 *
 *   x = r · (cos t + t · sin t)
 *   y = r · (sin t − t · cos t)
 *
 * At t = 0 the point is on the base circle at angle 0.
 * As t increases the curve spirals outward away from the base circle.
 *
 * @param r  Base circle radius (any consistent unit — mm or normalised).
 * @param t  Involute parameter in radians (≥ 0).
 */
export function involutePoint(r: number, t: number): Vec2 {
  return {
    x: r * (Math.cos(t) + t * Math.sin(t)),
    y: r * (Math.sin(t) - t * Math.cos(t)),
  };
}

/**
 * involuteAngle
 *
 * Returns the involute parameter t for the involute of base circle `r_b`
 * at a given radial distance `r` from the centre.
 *
 *   t = sqrt((r/r_b)² − 1)   (derived from the involute arc-length relation)
 *
 * Used to find where the involute crosses a specific circle (e.g., pitch
 * circle or outside circle).
 *
 * @param r_b  Base circle radius.
 * @param r    Radial distance at which to evaluate the involute parameter.
 * @throws     If r < r_b (point is below the base circle — no real solution).
 */
export function involuteAngle(r_b: number, r: number): number {
  if (r < r_b) {
    throw new RangeError(
      `involuteAngle: r (${r}) must be ≥ r_b (${r_b}) — ` +
      'no real involute below the base circle.'
    );
  }
  return Math.sqrt((r / r_b) ** 2 - 1);
}

// ---------------------------------------------------------------------------
// Gear specification & derived geometry
// ---------------------------------------------------------------------------

/** Input parameters needed to define an involute spur gear. */
export interface GearSpec {
  /** Number of teeth (integer ≥ 5 for practical gears). */
  teeth: number;
  /**
   * Module (mm) — the fundamental size parameter.
   * module = pitch_diameter / teeth = circular_pitch / π
   * Standard values: 0.5, 0.8, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10
   */
  module: number;
  /**
   * Pressure angle α in degrees.
   * Standard values: 14.5° (legacy), 20° (modern standard), 25° (heavy load).
   * Default: 20°
   */
  pressureAngle_deg?: number;
  /**
   * Helix angle β in degrees (0° = spur gear, >0° = helical gear).
   * Helical gears run quieter and carry higher loads but generate axial thrust.
   * Default: 0° (spur gear).
   */
  helixAngle_deg?: number;
  /**
   * Face width (tooth width perpendicular to gear axis), in mm.
   * Used for bending stress and contact stress calculations.
   * Default: 10 × module.
   */
  faceWidth_mm?: number;
  /**
   * Material yield strength in MPa.
   * Used for Lewis bending stress safety-factor calculation.
   * Default: 207 MPa (mild steel).
   */
  yield_strength_MPa?: number;
}

/** All derived dimensional and kinematic properties of an involute gear. */
export interface GearGeometry {
  teeth: number;
  module_mm: number;
  pressureAngle_rad: number;
  helixAngle_rad: number;
  /** Pitch diameter d_p = N · m  (mm) */
  pitch_diameter_mm: number;
  /** Base diameter d_b = d_p · cos α  (mm) */
  base_diameter_mm: number;
  /** Addendum a = m  (mm) */
  addendum_mm: number;
  /** Dedendum b = 1.25 m  (mm) */
  dedendum_mm: number;
  /** Outside diameter d_o = d_p + 2m  (mm) */
  outside_diameter_mm: number;
  /** Root diameter d_r = d_p − 2.5m  (mm) */
  root_diameter_mm: number;
  /** Circular pitch p_c = π · m  (mm) */
  circular_pitch_mm: number;
  /** Base pitch p_b = p_c · cos α  (mm) */
  base_pitch_mm: number;
  /** Tooth thickness at pitch circle t = π · m / 2  (mm) */
  tooth_thickness_mm: number;
  /** Whole depth (addendum + dedendum) = 2.25 m  (mm) */
  whole_depth_mm: number;
  /** Normal module m_n = m · cos β  (helical gears only) */
  normal_module_mm: number;
  /** Face width (mm) */
  face_width_mm: number;
}

// ---------------------------------------------------------------------------
// InvoluteGear class
// ---------------------------------------------------------------------------

/**
 * InvoluteGear
 *
 * Represents a single involute spur or helical gear.  All geometry is
 * computed from first principles in the constructor — no tables, no lookups.
 *
 * @example
 * const gear = new InvoluteGear({ teeth: 24, module: 2, pressureAngle_deg: 20 });
 * console.log(gear.geometry.pitch_diameter_mm);  // 48 mm
 * const profile = gear.toothProfile(32);          // 32 points per tooth flank
 */
export class InvoluteGear {
  readonly spec: Required<GearSpec>;
  readonly geometry: GearGeometry;

  constructor(spec: GearSpec) {
    if (!Number.isInteger(spec.teeth) || spec.teeth < 5) {
      throw new RangeError(`InvoluteGear: teeth must be an integer ≥ 5 (got ${spec.teeth})`);
    }
    if (spec.module <= 0) {
      throw new RangeError(`InvoluteGear: module must be > 0 (got ${spec.module})`);
    }

    this.spec = {
      teeth:              spec.teeth,
      module:             spec.module,
      pressureAngle_deg:  spec.pressureAngle_deg  ?? 20,
      helixAngle_deg:     spec.helixAngle_deg      ?? 0,
      faceWidth_mm:       spec.faceWidth_mm        ?? spec.module * 10,
      yield_strength_MPa: spec.yield_strength_MPa  ?? 207,
    };

    const N  = this.spec.teeth;
    const m  = this.spec.module;
    const α  = (this.spec.pressureAngle_deg  * Math.PI) / 180;
    const β  = (this.spec.helixAngle_deg     * Math.PI) / 180;

    const d_p = N * m;
    const d_b = d_p * Math.cos(α);
    const a   = m;
    const b   = 1.25 * m;
    const p_c = Math.PI * m;
    const p_b = p_c * Math.cos(α);

    this.geometry = {
      teeth:               N,
      module_mm:           m,
      pressureAngle_rad:   α,
      helixAngle_rad:      β,
      pitch_diameter_mm:   d_p,
      base_diameter_mm:    d_b,
      addendum_mm:         a,
      dedendum_mm:         b,
      outside_diameter_mm: d_p + 2 * a,
      root_diameter_mm:    d_p - 2 * b,
      circular_pitch_mm:   p_c,
      base_pitch_mm:       p_b,
      tooth_thickness_mm:  p_c / 2,
      whole_depth_mm:      a + b,
      normal_module_mm:    m * Math.cos(β),
      face_width_mm:       this.spec.faceWidth_mm,
    };
  }

  // ── Tooth profile ──────────────────────────────────────────────────────────

  /**
   * toothProfile
   *
   * Generates the (x, y) point cloud for one complete tooth — both flanks
   * (left involute + right involute) and the tip arc — suitable for:
   *   • CNC toolpath generation
   *   • Polygon mesh construction
   *   • Collision detection in physics simulation
   *
   * The profile is centred at the gear origin, with the tooth straddling
   * the positive X-axis.  To place the k-th tooth, rotate by (2π/N) × k.
   *
   * @param pointsPerFlank  Number of sample points on each involute flank.
   *                        16 = fast preview, 64 = manufacturing quality.
   */
  toothProfile(pointsPerFlank = 32): { left: Vec2[]; right: Vec2[]; tip: Vec2[] } {
    const { base_diameter_mm, outside_diameter_mm, root_diameter_mm,
            pitch_diameter_mm, pressureAngle_rad, teeth } = this.geometry;

    const r_b = base_diameter_mm   / 2;
    const r_o = outside_diameter_mm / 2;
    const r_r = Math.max(root_diameter_mm / 2, r_b * 0.98); // floor at ~base circle
    const r_p = pitch_diameter_mm  / 2;

    // Involute parameter at pitch circle (half-tooth-thickness angle):
    //   t_p = involuteAngle(r_b, r_p)
    //   angle at pitch circle (measured from t=0 start of involute) = t_p - α
    const t_p = involuteAngle(r_b, r_p);
    // Half tooth angle at pitch circle (tooth spans ±θ_half from tooth centreline)
    const θ_half = Math.PI / teeth;
    // Angle shift to centre tooth on X-axis:
    //   the involute starts at angle 0 on the base circle;
    //   we need to rotate so the pitch-circle crossing aligns with θ_half
    const φ = θ_half + (t_p - pressureAngle_rad);

    // Build RIGHT flank (involute rotated to +φ)
    const t_start = 0;                      // at base circle
    const t_end   = involuteAngle(r_b, r_o); // at outside circle
    const step     = (t_end - t_start) / (pointsPerFlank - 1);

    const rightFlank: Vec2[] = [];
    for (let i = 0; i < pointsPerFlank; i++) {
      const t = t_start + i * step;
      const pt = involutePoint(r_b, t);
      rightFlank.push(rotateVec2(pt, φ));
    }

    // LEFT flank is the mirror image (reflected across X axis, same rotation)
    const leftFlank: Vec2[] = rightFlank.map((p) => ({ x: p.x, y: -p.y })).reverse();

    // Tip arc between left and right flanks
    const tipPts = 8;
    const angRight = Math.atan2(rightFlank[rightFlank.length - 1].y,
                                rightFlank[rightFlank.length - 1].x);
    const angLeft  = Math.atan2(leftFlank[0].y, leftFlank[0].x);
    const tipArc: Vec2[] = [];
    for (let i = 0; i <= tipPts; i++) {
      const a = angRight + (angLeft - angRight) * (i / tipPts);
      tipArc.push({ x: r_o * Math.cos(a), y: r_o * Math.sin(a) });
    }

    return { left: leftFlank, right: rightFlank, tip: tipArc };
  }

  /**
   * fullGearProfile
   *
   * Returns the complete polygon outline of the gear (all N teeth + root circles)
   * as a single ordered array of Vec2 points.
   *
   * Suitable for SVG rendering, OBJ mesh generation, or 2-D collision geometry.
   *
   * @param pointsPerFlank  Points per tooth flank (default 24).
   */
  fullGearProfile(pointsPerFlank = 24): Vec2[] {
    const profile: Vec2[] = [];
    const angleStep = (2 * Math.PI) / this.geometry.teeth;

    for (let k = 0; k < this.geometry.teeth; k++) {
      const tooth = this.toothProfile(pointsPerFlank);
      const angle = k * angleStep;

      const rotate = (pts: Vec2[]) =>
        pts.map((p) => rotateVec2(p, angle));

      profile.push(...rotate(tooth.left));
      profile.push(...rotate(tooth.tip));
      profile.push(...rotate(tooth.right));

      // Root fillet between teeth (simplified as two root-circle points)
      const r_r = this.geometry.root_diameter_mm / 2;
      const a1  = (k + 1) * angleStep - 0.05;
      const a2  = (k + 1) * angleStep + 0.05;
      profile.push({ x: r_r * Math.cos(a1), y: r_r * Math.sin(a1) });
      profile.push({ x: r_r * Math.cos(a2), y: r_r * Math.sin(a2) });
    }

    return profile;
  }

  // ── Stress analysis (Lewis beam strength equation) ─────────────────────────

  /**
   * lewisFormFactor
   *
   * Returns the Lewis form factor Y for this gear's tooth count.
   * The Lewis form factor accounts for the tooth shape in the bending
   * stress equation:  σ = F_t / (m · F · Y)
   *
   * Values are interpolated from the AGMA Lewis table.
   */
  lewisFormFactor(): number {
    // Tabulated Y values (AGMA standard, 20° pressure angle, full-depth teeth)
    const TABLE: [number, number][] = [
      [5, 0.066], [6, 0.078], [8, 0.094], [10, 0.107], [12, 0.115],
      [14, 0.121], [16, 0.127], [18, 0.132], [20, 0.136], [24, 0.143],
      [30, 0.151], [36, 0.154], [40, 0.156], [45, 0.158], [50, 0.160],
      [60, 0.162], [75, 0.164], [100, 0.165], [150, 0.166], [200, 0.167],
      [300, 0.168], [400, 0.169], [500, 0.170],
    ];

    const N = this.geometry.teeth;
    if (N >= 500) return 0.170;

    // Linear interpolation
    for (let i = 0; i < TABLE.length - 1; i++) {
      const [n0, y0] = TABLE[i];
      const [n1, y1] = TABLE[i + 1];
      if (N >= n0 && N <= n1) {
        return y0 + ((N - n0) / (n1 - n0)) * (y1 - y0);
      }
    }
    return TABLE[0][1];
  }

  /**
   * bendingStress_MPa
   *
   * Calculates the Lewis bending stress at the tooth root.
   *
   *   σ = F_t / (m · b · Y)
   *
   * where F_t = tangential force (N), m = module (m), b = face width (m), Y = Lewis factor.
   *
   * @param tangentialForce_N  Tangential force at pitch circle in Newtons.
   * @returns                  Bending stress in MPa.
   */
  bendingStress_MPa(tangentialForce_N: number): number {
    const m_m  = this.geometry.module_mm / 1000;        // mm → m
    const b_m  = this.geometry.face_width_mm / 1000;    // mm → m
    const Y    = this.lewisFormFactor();
    return tangentialForce_N / (m_m * b_m * Y) / 1e6;   // Pa → MPa
  }

  /**
   * safetyFactor
   *
   * Returns the bending safety factor SF = σ_yield / σ_bending.
   * SF < 1 means the tooth will fail under the given load.
   *
   * @param tangentialForce_N  Tangential force at pitch circle in Newtons.
   */
  safetyFactor(tangentialForce_N: number): number {
    const σ = this.bendingStress_MPa(tangentialForce_N);
    if (σ === 0) return Infinity;
    return this.spec.yield_strength_MPa / σ;
  }

  // ── Kinematic helpers ──────────────────────────────────────────────────────

  /** Pitch circle radius (mm). */
  get pitchRadius_mm(): number { return this.geometry.pitch_diameter_mm / 2; }

  /** Base circle radius (mm). */
  get baseRadius_mm(): number { return this.geometry.base_diameter_mm / 2; }

  /** Outside circle radius (mm). */
  get outsideRadius_mm(): number { return this.geometry.outside_diameter_mm / 2; }

  /** Root circle radius (mm). */
  get rootRadius_mm(): number { return this.geometry.root_diameter_mm / 2; }

  /** Tangential force (N) at the pitch circle for a given torque (N·m). */
  tangentialForce_N(torque_Nm: number): number {
    const r_m = this.pitchRadius_mm / 1000; // mm → m
    return torque_Nm / r_m;
  }

  /** Pitch-circle velocity (m/s) at a given rotational speed (rpm). */
  pitchVelocity_ms(speed_rpm: number): number {
    const r_m  = this.pitchRadius_mm / 1000;
    const ω    = (speed_rpm * 2 * Math.PI) / 60;
    return ω * r_m;
  }

  /** Summary string for debugging and logging. */
  toString(): string {
    const g = this.geometry;
    return (
      `InvoluteGear(N=${g.teeth}, m=${g.module_mm}, α=${this.spec.pressureAngle_deg}°, ` +
      `d_p=${g.pitch_diameter_mm.toFixed(2)}mm, d_b=${g.base_diameter_mm.toFixed(2)}mm, ` +
      `d_o=${g.outside_diameter_mm.toFixed(2)}mm, d_r=${g.root_diameter_mm.toFixed(2)}mm)`
    );
  }
}

// ---------------------------------------------------------------------------
// Gear mesh — two gears in contact
// ---------------------------------------------------------------------------

/** Result of meshing analysis between two gears. */
export interface MeshResult {
  /** Centre distance between the two gear axes (mm). */
  center_distance_mm: number;
  /** Gear ratio i = N_driven / N_driver. */
  ratio: number;
  /** Contact ratio — should be > 1.2 for smooth running. */
  contact_ratio: number;
  /** True if the gears can mesh (same module, no interference). */
  can_mesh: boolean;
  /** Human-readable diagnosis. */
  diagnosis: string;
  /**
   * Interference check result.
   * Interference occurs when the tip of one gear digs below the
   * root (base circle) of the other.
   */
  interference: boolean;
}

/**
 * meshGears
 *
 * Analyses whether two gears can mesh and computes kinematic/geometric
 * properties of their engagement.
 *
 * @param driver  The driving (input) gear.
 * @param driven  The driven (output) gear.
 */
export function meshGears(driver: InvoluteGear, driven: InvoluteGear): MeshResult {
  const issues: string[] = [];

  // Module must match for gears to mesh
  const moduleDiff = Math.abs(driver.geometry.module_mm - driven.geometry.module_mm);
  if (moduleDiff > 1e-6) {
    issues.push(
      `Module mismatch: driver=${driver.geometry.module_mm}mm, ` +
      `driven=${driven.geometry.module_mm}mm`
    );
  }

  // Pressure angle must match
  const αDiff = Math.abs(
    driver.geometry.pressureAngle_rad - driven.geometry.pressureAngle_rad
  );
  if (αDiff > 1e-6) {
    issues.push('Pressure angle mismatch');
  }

  const can_mesh = issues.length === 0;

  // Centre distance c = (d_p1 + d_p2) / 2
  const c = (driver.geometry.pitch_diameter_mm + driven.geometry.pitch_diameter_mm) / 2;

  // Gear ratio
  const ratio = driven.geometry.teeth / driver.geometry.teeth;

  // Contact ratio ε = (length of path of contact) / (base pitch of driver)
  // Path of approach  = sqrt(r_o2² - r_b2²) - r_p2 · sin α
  // Path of recess    = sqrt(r_o1² - r_b1²) - r_p1 · sin α
  const r_o1 = driver.outsideRadius_mm;
  const r_b1 = driver.baseRadius_mm;
  const r_p1 = driver.pitchRadius_mm;
  const r_o2 = driven.outsideRadius_mm;
  const r_b2 = driven.baseRadius_mm;
  const r_p2 = driven.pitchRadius_mm;
  const α    = driver.geometry.pressureAngle_rad;

  const pathApproach = Math.sqrt(Math.max(0, r_o2 ** 2 - r_b2 ** 2)) - r_p2 * Math.sin(α);
  const pathRecess   = Math.sqrt(Math.max(0, r_o1 ** 2 - r_b1 ** 2)) - r_p1 * Math.sin(α);
  const pathContact  = pathApproach + pathRecess;
  const contact_ratio = pathContact / driver.geometry.base_pitch_mm;

  if (can_mesh && contact_ratio < 1.2) {
    issues.push(`Low contact ratio: ${contact_ratio.toFixed(3)} (min 1.2 recommended)`);
  }

  // Interference check:
  // The driven gear tip must not reach below the driver's base circle.
  // Condition: r_o2 · sin(α) ≤ sqrt(c² - r_b1²)  … simplified check
  const interference = r_o2 * Math.sin(α) > Math.sqrt(Math.max(0, c ** 2 - r_b1 ** 2));

  if (interference) {
    issues.push(
      'Interference detected — tip of driven gear undercuts driver base circle; ' +
      'reduce teeth on driver, increase pressure angle, or use profile shift.'
    );
  }

  const diagnosis = can_mesh && !interference && contact_ratio >= 1.2
    ? `OK — ratio ${ratio.toFixed(4)}:1, contact ratio ${contact_ratio.toFixed(3)}, ` +
      `centre distance ${c.toFixed(3)} mm`
    : issues.join('; ');

  return { center_distance_mm: c, ratio, contact_ratio, can_mesh, diagnosis, interference };
}

// ---------------------------------------------------------------------------
// Gear train
// ---------------------------------------------------------------------------

/**
 * A single stage in a compound gear train.
 *
 * In a compound gear train, each stage has a driver (input) and a driven (output)
 * gear on the same shaft.  The speed at the output of one stage becomes the
 * input for the next.
 */
export interface GearStage {
  driver: InvoluteGear;
  driven: InvoluteGear;
  /**
   * Mesh efficiency η for this stage.
   * Spur gears: ~0.98–0.99; helical: ~0.99; worm: 0.40–0.90.
   * Default: 0.98.
   */
  efficiency?: number;
}

/** Full kinematic and power-flow result for a multi-stage gear train. */
export interface GearTrainResult {
  /** Total gear ratio (input speed / output speed). */
  total_ratio: number;
  /** Output speed (rpm) for a given input speed. */
  output_speed_rpm: number;
  /** Output torque (N·m) for a given input torque. */
  output_torque_Nm: number;
  /** Overall mechanical efficiency (product of per-stage efficiencies). */
  overall_efficiency: number;
  /** Per-stage breakdown. */
  stages: Array<{
    stage: number;
    ratio: number;
    efficiency: number;
    mesh: MeshResult;
  }>;
  /** Power loss (W) across the entire train at the given operating point. */
  power_loss_W: number;
}

/**
 * GearTrain
 *
 * Models a multi-stage compound gear train.  Chains any number of gear
 * pairs sequentially, calculating the cumulative ratio, efficiency, speed,
 * and torque at the output shaft.
 *
 * @example
 * const stage1 = { driver: new InvoluteGear({ teeth: 20, module: 2 }),
 *                  driven: new InvoluteGear({ teeth: 60, module: 2 }) };
 * const stage2 = { driver: new InvoluteGear({ teeth: 15, module: 1 }),
 *                  driven: new InvoluteGear({ teeth: 45, module: 1 }) };
 * const train  = new GearTrain([stage1, stage2]);
 * const result = train.analyze(1800, 5); // 1800 rpm input, 5 N·m input torque
 * console.log(result.output_speed_rpm);  // → 200 rpm
 * console.log(result.output_torque_Nm);  // → 43.26 N·m (× 9 ratio × 0.98² eff.)
 */
export class GearTrain {
  readonly stages: GearStage[];

  constructor(stages: GearStage[]) {
    if (stages.length === 0) {
      throw new Error('GearTrain: must have at least one stage');
    }
    this.stages = stages;
  }

  /**
   * analyze
   *
   * Computes full kinematics and power flow for the given input conditions.
   *
   * @param input_speed_rpm   Rotational speed at the input shaft (rpm).
   * @param input_torque_Nm   Torque at the input shaft (N·m).
   */
  analyze(input_speed_rpm: number, input_torque_Nm: number): GearTrainResult {
    let speed   = input_speed_rpm;
    let torque  = input_torque_Nm;
    let η_total = 1.0;

    const stageResults: GearTrainResult['stages'] = [];

    for (let i = 0; i < this.stages.length; i++) {
      const { driver, driven, efficiency = 0.98 } = this.stages[i];
      const mesh  = meshGears(driver, driven);
      const ratio = mesh.ratio;

      speed   = speed  / ratio;
      torque  = torque * ratio * efficiency;
      η_total = η_total * efficiency;

      stageResults.push({ stage: i + 1, ratio, efficiency, mesh });
    }

    const total_ratio  = input_speed_rpm / speed;
    const input_power_W = input_torque_Nm * (input_speed_rpm * 2 * Math.PI / 60);
    const output_power_W = torque * (speed * 2 * Math.PI / 60);
    const power_loss_W   = input_power_W - output_power_W;

    return {
      total_ratio,
      output_speed_rpm:  speed,
      output_torque_Nm:  torque,
      overall_efficiency: η_total,
      stages:            stageResults,
      power_loss_W,
    };
  }

  /** Convenience: output speed in rpm for a given input speed. */
  outputSpeed_rpm(inputSpeed_rpm: number): number {
    const ratio = this.stages.reduce((acc, { driver, driven }) => {
      return acc * (driven.geometry.teeth / driver.geometry.teeth);
    }, 1);
    return inputSpeed_rpm / ratio;
  }

  /** Convenience: output torque in N·m for a given input torque. */
  outputTorque_Nm(inputTorque_Nm: number, defaultEfficiency = 0.98): number {
    return this.stages.reduce((τ, { driver, driven, efficiency }) => {
      const η  = efficiency ?? defaultEfficiency;
      const i  = driven.geometry.teeth / driver.geometry.teeth;
      return τ * i * η;
    }, inputTorque_Nm);
  }

  /** Human-readable summary of the gear train. */
  toString(): string {
    const lines = [`GearTrain (${this.stages.length} stage${this.stages.length > 1 ? 's' : ''})`];
    for (const { driver, driven, efficiency = 0.98 } of this.stages) {
      lines.push(
        `  N${driver.geometry.teeth} → N${driven.geometry.teeth}  ` +
        `ratio=${(driven.geometry.teeth / driver.geometry.teeth).toFixed(4)}:1  ` +
        `η=${(efficiency * 100).toFixed(1)}%`
      );
    }
    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Planetary gear set
// ---------------------------------------------------------------------------

/** Configuration for an epicyclic (planetary) gear set. */
export interface PlanetaryGearConfig {
  /** Sun gear (central, driven by input shaft). */
  sun:    InvoluteGear;
  /** Planet gears (orbit the sun; all must be identical). */
  planet: InvoluteGear;
  /** Ring (annular) gear (internal teeth — outermost element). */
  ring:   InvoluteGear;
  /** Number of planet gears equally spaced (typically 3 or 4). */
  planetCount: number;
}

/** Kinematic modes for a planetary gear set. */
export type PlanetaryMode =
  | 'sun_in_carrier_out_ring_fixed'   // Most common — ring fixed, carrier is output
  | 'ring_in_carrier_out_sun_fixed'   // Ring drives, sun fixed, carrier outputs
  | 'sun_in_ring_out_carrier_fixed';  // Carrier fixed — high ratio

/** Planetary gear analysis result. */
export interface PlanetaryResult {
  mode: PlanetaryMode;
  /** Gear ratio (input speed / output speed). */
  ratio: number;
  /** Output speed (rpm). */
  output_speed_rpm: number;
  /** Direction: +1 = same as input, −1 = reversed. */
  direction: 1 | -1;
  /** Torque capacity check: can the planet-count handle the load? */
  planet_load_share: number;
}

/**
 * analyzePlanetary
 *
 * Computes the kinematic ratio for an epicyclic (planetary) gear set.
 *
 * The fundamental relation (Willis equation):
 *   (ω_ring − ω_carrier) / (ω_sun − ω_carrier) = −N_sun / N_ring
 *
 * @param config  Planetary gear configuration.
 * @param mode    Which element is fixed and which is input/output.
 * @param input_speed_rpm  Speed of the input element (rpm).
 */
export function analyzePlanetary(
  config: PlanetaryGearConfig,
  mode: PlanetaryMode,
  input_speed_rpm: number
): PlanetaryResult {
  const N_s = config.sun.geometry.teeth;
  const N_r = config.ring.geometry.teeth;

  // Willis equation: k = −N_sun / N_ring
  const k = -N_s / N_r;

  let ratio: number;
  let direction: 1 | -1;

  switch (mode) {
    case 'sun_in_carrier_out_ring_fixed':
      // ω_carrier / ω_sun = 1 / (1 − k)  =  N_ring / (N_ring + N_sun)
      ratio     = (N_r + N_s) / N_s;
      direction = 1;
      break;

    case 'ring_in_carrier_out_sun_fixed':
      // ω_carrier / ω_ring = N_ring / (N_ring + N_sun)  (reversed direction)
      ratio     = (N_r + N_s) / N_r;
      direction = 1;
      break;

    case 'sun_in_ring_out_carrier_fixed':
      // ω_ring / ω_sun = k  → direction reversal
      ratio     = -1 / k;        // = N_ring / N_sun
      direction = -1;
      break;

    default:
      throw new Error(`analyzePlanetary: unknown mode "${mode}"`);
  }

  return {
    mode,
    ratio,
    output_speed_rpm: input_speed_rpm / ratio,
    direction,
    planet_load_share: 1 / config.planetCount,
  };
}

// ---------------------------------------------------------------------------
// Gear material library
// ---------------------------------------------------------------------------

/** Material properties relevant to gear design. */
export interface GearMaterial {
  name: string;
  /** Young's modulus (GPa). */
  elasticModulus_GPa: number;
  /** Yield strength (MPa). */
  yieldStrength_MPa: number;
  /** Brinell hardness (HB). */
  hardness_HB: number;
  /** Maximum allowable bending stress (MPa) — AGMA allowable. */
  allowableBending_MPa: number;
  /** Maximum allowable contact (Hertz) stress (MPa). */
  allowableContact_MPa: number;
  /** Density (kg/m³). */
  density_kgm3: number;
}

export const GEAR_MATERIALS: Record<string, GearMaterial> = {
  mild_steel_1020: {
    name:                  'Mild Steel AISI 1020',
    elasticModulus_GPa:    207,
    yieldStrength_MPa:     207,
    hardness_HB:           111,
    allowableBending_MPa:  55,
    allowableContact_MPa:  380,
    density_kgm3:          7850,
  },
  alloy_steel_4340: {
    name:                  'Alloy Steel AISI 4340 (through-hardened)',
    elasticModulus_GPa:    207,
    yieldStrength_MPa:     470,
    hardness_HB:           260,
    allowableBending_MPa:  245,
    allowableContact_MPa:  1050,
    density_kgm3:          7850,
  },
  case_hardened_8620: {
    name:                  'Case-Hardened Steel 8620 (60 HRc case)',
    elasticModulus_GPa:    207,
    yieldStrength_MPa:     620,
    hardness_HB:           388,
    allowableBending_MPa:  380,
    allowableContact_MPa:  1550,
    density_kgm3:          7850,
  },
  bronze_c93200: {
    name:                  'Bronze SAE 660 (for worm wheel)',
    elasticModulus_GPa:    103,
    yieldStrength_MPa:     152,
    hardness_HB:           60,
    allowableBending_MPa:  55,
    allowableContact_MPa:  415,
    density_kgm3:          8800,
  },
  nylon_pa66: {
    name:                  'Nylon PA66 (light-load, quiet running)',
    elasticModulus_GPa:    3.2,
    yieldStrength_MPa:     82,
    hardness_HB:           20,
    allowableBending_MPa:  20,
    allowableContact_MPa:  55,
    density_kgm3:          1140,
  },
};

// ---------------------------------------------------------------------------
// Utility: gear weight estimate
// ---------------------------------------------------------------------------

/**
 * gearWeight_kg
 *
 * Estimates the mass of a spur gear disk (solid blank minus tooth volume
 * approximation) for a given material.
 *
 * Approximation:  m = ρ · π · ((d_o/2)² − (d_r/2)²) · b  × 0.80
 * (The 0.80 factor accounts for ~20 % material removed by tooth cutting.)
 *
 * @param gear      The gear to estimate mass for.
 * @param material  Material from GEAR_MATERIALS registry.
 */
export function gearWeight_kg(gear: InvoluteGear, material: GearMaterial): number {
  const g  = gear.geometry;
  const r_o = (g.outside_diameter_mm / 2) / 1000;    // mm → m
  const r_r = (g.root_diameter_mm    / 2) / 1000;
  const b   = g.face_width_mm / 1000;
  const ρ   = material.density_kgm3;
  return ρ * Math.PI * (r_o ** 2 - r_r ** 2) * b * 0.80;
}
