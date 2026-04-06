/**
 * Machinist Mario Engine — Vector3 Core
 *
 * The "atomic particle" of the 500k-line system.
 * Immutable by design: every method returns a NEW Vector3 rather than
 * mutating the receiver.  This means the engine can track every step of
 * a physics calculation without losing previous state — essential for
 * deterministic animation, G-code generation, and undo/redo stacks.
 *
 * ── Why immutability matters ─────────────────────────────────────────────────
 * In a clockwork gear train, each tooth-mesh event produces a new velocity
 * vector.  If vectors were mutable, a shared reference would silently corrupt
 * upstream calculations.  Immutable vectors make every intermediate state
 * inspectable and serialisable — a requirement for the verification hash
 * chain in verify.ts.
 *
 * ── Cross Product: the "Swirl" ────────────────────────────────────────────────
 * The cross product A × B produces a vector perpendicular to the plane of A
 * and B, with magnitude |A||B|sin θ.  This "swirl" is the fundamental
 * operation behind:
 *   • Gear torque:    τ = r × F  (force perpendicular to the crank radius)
 *   • Aero lift:      L ∝ V × ω  (Kutta–Joukowski vortex lift theorem)
 *   • CCD IK:         rotation axis = effector_vec × target_vec
 *   • Helix/3D print: each step rotates the tangent via cross product
 *   • Radiation swirl: particle spiral path in a magnetic field
 *
 * ── Coordinate systems ───────────────────────────────────────────────────────
 *   Cartesian:    (x, y, z)                     — primary representation
 *   Cylindrical:  (r, θ, z)                     — lathe turning, gear rotation
 *   Spherical:    (r, θ_polar, φ_azimuth)        — medical imaging, radiation
 *
 * Usage:
 *   import { Vector3 } from './vector3';
 *
 *   const torque = radius.cross(force);          // gear torque vector
 *   const lift   = velocity.cross(vorticity);    // Kutta–Joukowski lift
 *   const helix  = Vector3.helix(32, 0.05, 0.1); // 3D printer nozzle path
 */

// ---------------------------------------------------------------------------
// Spherical coordinate representation
// ---------------------------------------------------------------------------

/** A vector expressed in spherical coordinates (physics convention). */
export interface Spherical {
  /** Radial distance from the origin (r ≥ 0). */
  r:       number;
  /**
   * Polar angle from the +Y axis (0 = pointing up, π = pointing down).
   * Range: [0, π].
   */
  theta:   number;
  /**
   * Azimuthal angle in the XZ plane from the +X axis.
   * Range: [−π, π].
   */
  phi:     number;
}

/** A vector expressed in cylindrical coordinates. */
export interface Cylindrical {
  /** Radial distance from the Z-axis (ρ ≥ 0). */
  rho:     number;
  /**
   * Azimuthal angle from the +X axis in the XY plane.
   * Range: [−π, π].
   */
  theta:   number;
  /** Height along the Z-axis. */
  z:       number;
}

// ---------------------------------------------------------------------------
// Vector3 — immutable 3-D vector
// ---------------------------------------------------------------------------

/**
 * Vector3
 *
 * Immutable 3-D vector with a full physics / geometry / CNC toolpath API.
 *
 * All arithmetic methods return new Vector3 instances — the receiver is
 * never mutated.  This enables fearless composition:
 *
 *   const path = pos.add(vel.scale(dt)).add(acc.scale(0.5 * dt * dt));
 *   // pos, vel, acc are unchanged; path is the new position.
 */
export class Vector3 {

  /** x component (Cartesian, metres or normalised units). */
  public readonly x: number;
  /** y component. */
  public readonly y: number;
  /** z component. */
  public readonly z: number;

  constructor(x: number = 0, y: number = 0, z: number = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  // ── Static constants (frozen so they are never mutated) ───────────────────

  static readonly ZERO  = Object.freeze(new Vector3(0, 0, 0));
  static readonly ONE   = Object.freeze(new Vector3(1, 1, 1));
  /** Unit vector along the +X axis. */
  static readonly X     = Object.freeze(new Vector3(1, 0, 0));
  /** Unit vector along the +Y axis (world up). */
  static readonly Y     = Object.freeze(new Vector3(0, 1, 0));
  /** Unit vector along the +Z axis. */
  static readonly Z     = Object.freeze(new Vector3(0, 0, 1));

  // ── Basic arithmetic ──────────────────────────────────────────────────────

  /**
   * Hand-over-hand addition: particle A grabs particle B.
   * Returns a new vector = this + v.
   */
  public add(v: Vector3): Vector3 {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  /**
   * Hand-over-hand subtraction.
   * Returns a new vector = this − v.
   */
  public subtract(v: Vector3): Vector3 {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  /**
   * Uniform scale.
   * Returns a new vector = this × s.
   */
  public scale(s: number): Vector3 {
    return new Vector3(this.x * s, this.y * s, this.z * s);
  }

  /**
   * Component-wise multiply (Hadamard product).
   * Useful for applying per-axis scale factors.
   */
  public multiply(v: Vector3): Vector3 {
    return new Vector3(this.x * v.x, this.y * v.y, this.z * v.z);
  }

  /** Negate all components. Returns −this. */
  public negate(): Vector3 {
    return new Vector3(-this.x, -this.y, -this.z);
  }

  // ── Dot product ───────────────────────────────────────────────────────────

  /**
   * Dot product (scalar): this · v = |this||v|cos θ.
   *
   * Physical meaning:
   *   • Work done:    W = F · d
   *   • Projection:   |this| cos θ onto direction v̂
   *   • Alignment:    +1 = same dir, 0 = perpendicular, −1 = opposite
   */
  public dot(v: Vector3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  // ── Cross product — the "Swirl" ───────────────────────────────────────────

  /**
   * Cross product ("swirl"): this × v = perpendicular vector with
   * magnitude |this||v|sin θ, direction given by the right-hand rule.
   *
   * Applications in this engine:
   *   Gear torque:     τ = r × F
   *   Aero lift:       L̂ = V̂ × ω̂      (Kutta–Joukowski direction)
   *   IK rotation axis: axis = effector × target
   *   Helix step:      next_tangent = tangent × up
   *   Particle swirl:  r_{n+1} = r_n × ω (magnetic field spiral)
   */
  public cross(v: Vector3): Vector3 {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  // ── Magnitude & direction ─────────────────────────────────────────────────

  /**
   * Magnitude (Euclidean length): |this| = √(x²+y²+z²).
   * Also called "the strength of the particle pull."
   */
  public magnitude(): number {
    return Math.sqrt(this.x ** 2 + this.y ** 2 + this.z ** 2);
  }

  /** Squared magnitude — cheaper than magnitude() when only comparisons are needed. */
  public magnitudeSq(): number {
    return this.x ** 2 + this.y ** 2 + this.z ** 2;
  }

  /**
   * Normalize: return the unit vector in the same direction.
   * Returns ZERO if this is the zero vector (safe division).
   *
   * "The direction of the climb."
   */
  public normalize(): Vector3 {
    const mag = this.magnitude();
    return mag < 1e-12 ? Vector3.ZERO : this.scale(1 / mag);
  }

  /** Euclidean distance from this to v. */
  public distanceTo(v: Vector3): number {
    return this.subtract(v).magnitude();
  }

  /** Squared distance (no sqrt — fast for comparisons). */
  public distanceSqTo(v: Vector3): number {
    return this.subtract(v).magnitudeSq();
  }

  /**
   * Angle between this and v (radians, [0, π]).
   * Clamped to avoid NaN from floating-point dot > 1.
   */
  public angleTo(v: Vector3): number {
    const d = this.normalize().dot(v.normalize());
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }

  // ── Interpolation ─────────────────────────────────────────────────────────

  /**
   * Linear interpolation: lerp(v, 0) = this, lerp(v, 1) = v.
   * Used for position tween and animation blending.
   */
  public lerp(v: Vector3, t: number): Vector3 {
    return new Vector3(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
      this.z + (v.z - this.z) * t
    );
  }

  /**
   * Spherical linear interpolation along the surface of a unit sphere.
   * Produces constant angular velocity — smoother than lerp for directions.
   * Falls back to lerp when vectors are nearly parallel.
   */
  public slerp(v: Vector3, t: number): Vector3 {
    const cosA = Math.max(-1, Math.min(1, this.normalize().dot(v.normalize())));
    const angle = Math.acos(Math.abs(cosA));

    if (angle < 1e-6) return this.lerp(v, t);

    const sinA = Math.sin(angle);
    const wa   = Math.sin((1 - t) * angle) / sinA;
    const wb   = Math.sin(t       * angle) / sinA;

    return this.scale(wa).add(v.scale(wb));
  }

  // ── Reflection & projection ───────────────────────────────────────────────

  /**
   * Reflect this vector about a normal n (must be unit vector).
   *   reflected = this − 2(this·n)n
   * Used for: aero surface bounce, tool-path reflection symmetry.
   */
  public reflect(normal: Vector3): Vector3 {
    const d = 2 * this.dot(normal);
    return this.subtract(normal.scale(d));
  }

  /**
   * Project this onto direction v (scalar projection × v̂).
   *   proj = (this·v̂) v̂
   * Used for: CNC feed-rate along a toolpath direction.
   */
  public projectOnto(v: Vector3): Vector3 {
    const vn  = v.normalize();
    return vn.scale(this.dot(vn));
  }

  /**
   * Reject from direction v (component perpendicular to v).
   *   reject = this − project(this, v)
   */
  public rejectFrom(v: Vector3): Vector3 {
    return this.subtract(this.projectOnto(v));
  }

  // ── Coordinate system conversions ─────────────────────────────────────────

  /**
   * Convert to spherical coordinates (r, θ, φ).
   *
   *   r     = |this|
   *   θ     = arccos(y / r)              polar angle from +Y (0 = up)
   *   φ     = atan2(z, x)               azimuth in XZ plane from +X
   *
   * Medical imaging application:
   *   MRI/CT voxel data is often stored in spherical coordinates centred
   *   on the patient's head.  toSpherical() maps Cartesian mesh vertices
   *   back to scanner coordinates for DICOM export.
   *
   * Radiation particle spiral:
   *   A charged particle in a uniform magnetic field B moves in a helix.
   *   Its azimuthal angle φ increases linearly with time; convert to
   *   Cartesian for each frame via fromSpherical().
   */
  public toSpherical(): Spherical {
    const r = this.magnitude();
    if (r < 1e-12) return { r: 0, theta: 0, phi: 0 };
    return {
      r,
      theta: Math.acos(Math.max(-1, Math.min(1, this.y / r))),
      phi:   Math.atan2(this.z, this.x),
    };
  }

  /**
   * Construct a Vector3 from spherical coordinates.
   *   x = r sin θ cos φ
   *   y = r cos θ
   *   z = r sin θ sin φ
   */
  static fromSpherical(s: Spherical): Vector3 {
    const sinT = Math.sin(s.theta);
    return new Vector3(
      s.r * sinT * Math.cos(s.phi),
      s.r * Math.cos(s.theta),
      s.r * sinT * Math.sin(s.phi)
    );
  }

  /**
   * Convert to cylindrical coordinates (ρ, θ, z).
   *
   *   ρ     = sqrt(x² + z²)             radial distance from Y-axis
   *   θ     = atan2(z, x)               azimuth in XZ plane
   *   z     = this.y                    height along Y-axis
   *
   * Lathe application:
   *   The workpiece rotates about the Y-axis.  The tool position is
   *   described by ρ (distance from axis) and z (axial position).
   *   Convert the desired neck profile to cylindrical, then drive
   *   ρ and z with G-code moves while the spindle provides θ.
   */
  public toCylindrical(): Cylindrical {
    return {
      rho:   Math.sqrt(this.x ** 2 + this.z ** 2),
      theta: Math.atan2(this.z, this.x),
      z:     this.y,
    };
  }

  /**
   * Construct a Vector3 from cylindrical coordinates.
   *   x = ρ cos θ
   *   y = z
   *   z = ρ sin θ
   */
  static fromCylindrical(c: Cylindrical): Vector3 {
    return new Vector3(
      c.rho * Math.cos(c.theta),
      c.z,
      c.rho * Math.sin(c.theta)
    );
  }

  // ── Torque ────────────────────────────────────────────────────────────────

  /**
   * torque
   *
   * Computes the torque vector produced by force `f` applied at this position
   * vector (moment arm) relative to a pivot:
   *
   *   τ = r × F
   *
   * Applications:
   *   • Gear tooth force:      τ = pitchRadius × tangentialForce
   *   • Lathe cutting torque:  τ = toolOffset × cuttingForce
   *   • Surgical robot:        τ = linkLength × endForce
   *
   * @param force  Applied force vector (N).
   * @returns      Torque vector (N·m).  Magnitude = |r||F|sin θ.
   */
  public torque(force: Vector3): Vector3 {
    return this.cross(force);
  }

  // ── Static generators ─────────────────────────────────────────────────────

  /**
   * helix
   *
   * Generates n points along a helix (the 3D-printer nozzle path and the
   * exact trajectory of a charged particle in a uniform magnetic field).
   *
   *   x(t) = radius · cos(2π t / turns)
   *   y(t) = pitch  · t / n              (linear rise)
   *   z(t) = radius · sin(2π t / turns)
   *
   * @param n       Number of sample points.
   * @param radius  Helix radius (metres).
   * @param pitch   Axial advance per full revolution (metres).
   * @param turns   Number of complete revolutions.  Default: 1.
   * @param centre  Centre of the helix base.  Default: origin.
   */
  static helix(
    n:       number,
    radius:  number,
    pitch:   number,
    turns:   number   = 1,
    centre:  Vector3  = Vector3.ZERO
  ): Vector3[] {
    const pts: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const t     = (i / (n - 1)) * turns;
      const angle = 2 * Math.PI * t;
      pts.push(new Vector3(
        centre.x + radius * Math.cos(angle),
        centre.y + pitch  * t,
        centre.z + radius * Math.sin(angle)
      ));
    }
    return pts;
  }

  /**
   * vortex
   *
   * Simulates a vortex filament — the "swirling particle" model of
   * aerodynamic lift (Kutta–Joukowski vortex sheet).
   *
   * Each step applies a rotation about the vortex axis using the
   * cross product, then advances along the axis:
   *
   *   r_{n+1} = r_n + ω × r_n · dt + axis · advance
   *
   * Produces the characteristic helical tip-vortex wake behind a wing
   * or the swirling wake of a cartoon character's cape.
   *
   * @param n       Number of sample points.
   * @param start   Starting position vector.
   * @param axis    Vortex rotation axis (unit vector = vorticity direction).
   * @param omega   Angular velocity (rad/s).
   * @param advance Axial advance per step (m/step).
   * @param dt      Time step per sample (s).
   */
  static vortex(
    n:       number,
    start:   Vector3,
    axis:    Vector3,
    omega:   number,
    advance: number,
    dt:      number
  ): Vector3[] {
    const pts: Vector3[] = [start];
    const axisN = axis.normalize();

    for (let i = 1; i < n; i++) {
      const prev   = pts[i - 1];
      // Rotation rate: dr/dt = ω × r
      const drdt   = axisN.cross(prev).scale(omega);
      const next   = prev
        .add(drdt.scale(dt))
        .add(axisN.scale(advance));
      pts.push(next);
    }
    return pts;
  }

  /**
   * spiral
   *
   * Generates a logarithmic (equiangular) spiral — the natural growth
   * pattern of shells, galaxy arms, and CNC face-milling toolpaths.
   *
   *   r(θ) = a · e^(b·θ)
   *
   * @param n      Number of points.
   * @param a      Scale factor (initial radius at θ=0).
   * @param b      Growth rate.  b=0 → Archimedean spiral (constant spacing).
   * @param turns  Total angular range in full revolutions.
   */
  static spiral(n: number, a: number, b: number, turns: number = 3): Vector3[] {
    const pts: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const θ = (i / (n - 1)) * turns * 2 * Math.PI;
      const r = a * Math.exp(b * θ);
      pts.push(new Vector3(r * Math.cos(θ), 0, r * Math.sin(θ)));
    }
    return pts;
  }

  /**
   * arc
   *
   * Generates n points along a circular arc in the XZ plane.
   * Used for G2/G3 arc interpolation in G-code and for gear pitch circles.
   *
   * @param centre      Centre of the arc.
   * @param radius      Arc radius.
   * @param startAngle  Start angle (radians, 0 = +X axis).
   * @param endAngle    End angle (radians).
   * @param n           Number of points.
   */
  static arc(
    centre:     Vector3,
    radius:     number,
    startAngle: number,
    endAngle:   number,
    n:          number = 32
  ): Vector3[] {
    const pts: Vector3[] = [];
    for (let i = 0; i < n; i++) {
      const θ = startAngle + (endAngle - startAngle) * (i / (n - 1));
      pts.push(new Vector3(
        centre.x + radius * Math.cos(θ),
        centre.y,
        centre.z + radius * Math.sin(θ)
      ));
    }
    return pts;
  }

  // ── Angular momentum & rotational physics ─────────────────────────────────

  /**
   * angularMomentum
   *
   * L = r × (m · v)   (angular momentum about the origin)
   *
   * This is the "swirl" stored by a spinning object.
   * A gear stores angular momentum L = I·ω; this method computes the
   * equivalent from position and linear momentum.
   *
   * @param velocity  Linear velocity vector (m/s).
   * @param mass_kg   Mass of the particle (kg).
   * @returns         Angular momentum vector (kg·m²/s).
   */
  public angularMomentum(velocity: Vector3, mass_kg: number): Vector3 {
    return this.cross(velocity.scale(mass_kg));
  }

  /**
   * centrifugalAcceleration
   *
   * a_c = −ω × (ω × r)   (centrifugal acceleration in rotating frame)
   *
   * In a gear, the centrifugal force on a tooth is:
   *   F_c = m · |ω|² · r  (outward, perpendicular to ω)
   *
   * @param omega  Angular velocity vector (rad/s) of the rotating frame.
   * @returns      Centrifugal acceleration (m/s²) — points away from axis.
   */
  public centrifugalAcceleration(omega: Vector3): Vector3 {
    return omega.cross(omega.cross(this)).negate();
  }

  // ── Geometry helpers ──────────────────────────────────────────────────────

  /**
   * midpoint
   *
   * Returns the midpoint between this and v.  Equivalent to lerp(v, 0.5).
   */
  public midpoint(v: Vector3): Vector3 {
    return this.lerp(v, 0.5);
  }

  /**
   * clamp
   *
   * Clamps each component to [lo, hi].  Used for machine-volume bounds checking.
   */
  public clamp(lo: Vector3, hi: Vector3): Vector3 {
    return new Vector3(
      Math.max(lo.x, Math.min(hi.x, this.x)),
      Math.max(lo.y, Math.min(hi.y, this.y)),
      Math.max(lo.z, Math.min(hi.z, this.z))
    );
  }

  /**
   * isWithinBox
   *
   * Returns true if this point is inside the axis-aligned bounding box
   * defined by corners [lo, hi].  Used for CNC machine-volume collision.
   */
  public isWithinBox(lo: Vector3, hi: Vector3): boolean {
    return (
      this.x >= lo.x && this.x <= hi.x &&
      this.y >= lo.y && this.y <= hi.y &&
      this.z >= lo.z && this.z <= hi.z
    );
  }

  /**
   * isZero
   *
   * Returns true if all components are within `epsilon` of zero.
   */
  public isZero(epsilon = 1e-10): boolean {
    return this.magnitudeSq() < epsilon * epsilon;
  }

  /**
   * equals
   *
   * Component-wise equality within epsilon tolerance.
   */
  public equals(v: Vector3, epsilon = 1e-10): boolean {
    return (
      Math.abs(this.x - v.x) < epsilon &&
      Math.abs(this.y - v.y) < epsilon &&
      Math.abs(this.z - v.z) < epsilon
    );
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  public toArray(): [number, number, number] {
    return [this.x, this.y, this.z];
  }

  public toJSON(): { x: number; y: number; z: number } {
    return { x: this.x, y: this.y, z: this.z };
  }

  static fromArray(a: [number, number, number]): Vector3 {
    return new Vector3(a[0], a[1], a[2]);
  }

  static fromJSON(o: { x: number; y: number; z: number }): Vector3 {
    return new Vector3(o.x, o.y, o.z);
  }

  public toString(): string {
    return `Vector3(${this.x.toFixed(6)}, ${this.y.toFixed(6)}, ${this.z.toFixed(6)})`;
  }
}
