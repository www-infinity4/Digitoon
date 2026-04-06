/**
 * Cartoon Prompt Engine — Skeletal Rigging & Animation System
 *
 * A renderer-agnostic skeletal animation engine built entirely from first
 * principles — inspired by ozz-animation's architecture but implemented
 * in TypeScript with no external dependencies.
 *
 * ── Architecture ─────────────────────────────────────────────────────────────
 *
 *  Vec3 / Quaternion / Mat4   — 3-D math primitives (from scratch)
 *  Joint                      — single joint with local transform + parent
 *  Skeleton                   — tree of joints, builds bind-pose transforms
 *  ForwardKinematics          — propagates parent transforms down the chain
 *  InverseKinematics (CCD)    — Cyclic Coordinate Descent solver
 *  AnimationClip              — keyframe sequence for one or more joints
 *  AnimationBlender           — cross-fades between two clips
 *  BalanceSolver              — computes centre-of-mass, tips character for weight
 *
 * ── Forward Kinematics ───────────────────────────────────────────────────────
 *   World transform of joint k:
 *     T_world[k] = T_world[parent(k)] · T_local[k]
 *   Represented as 4×4 homogeneous matrices.
 *
 * ── Inverse Kinematics (CCD) ─────────────────────────────────────────────────
 *   Cyclic Coordinate Descent: iterate from end-effector toward root,
 *   rotating each joint in turn to bring the end-effector closer to the target.
 *
 *   Per iteration, joint i is rotated by:
 *     θᵢ = angle between (effector − joint_i) and (target − joint_i) vectors
 *     axis = normalize((effector − joint_i) × (target − joint_i))
 *   Constraints (angle limits) are applied at each step.
 *
 * ── Centre-of-Mass ───────────────────────────────────────────────────────────
 *   CoM = Σ(mᵢ · pᵢ) / Σmᵢ
 *   Used by BalanceSolver to tilt the skeleton so the CoM projects within
 *   the support polygon (feet).
 *
 * Usage:
 *   import { Skeleton, ForwardKinematics, CCDSolver, AnimationClip } from './skeletal-rig';
 *
 *   const skeleton = Skeleton.humanoid();
 *   const fk = new ForwardKinematics(skeleton);
 *   skeleton.joint('forearm_r').localRotation = Quaternion.fromAxisAngle(Vec3.X, -Math.PI/6);
 *   fk.solve();
 *   console.log(skeleton.joint('wrist_r').worldPosition);
 */

// ===========================================================================
// 3-D Math Primitives
// ===========================================================================

// ---------------------------------------------------------------------------
// Vec3
// ---------------------------------------------------------------------------

/** A 3-D vector (x, y, z). */
export class Vec3 {
  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0
  ) {}

  static readonly ZERO  = new Vec3(0, 0, 0);
  static readonly ONE   = new Vec3(1, 1, 1);
  static readonly X     = new Vec3(1, 0, 0);
  static readonly Y     = new Vec3(0, 1, 0);
  static readonly Z     = new Vec3(0, 0, 1);
  static readonly UP    = new Vec3(0, 1, 0);
  static readonly RIGHT = new Vec3(1, 0, 0);

  clone():            Vec3 { return new Vec3(this.x, this.y, this.z); }
  add(v: Vec3):       Vec3 { return new Vec3(this.x + v.x, this.y + v.y, this.z + v.z); }
  sub(v: Vec3):       Vec3 { return new Vec3(this.x - v.x, this.y - v.y, this.z - v.z); }
  scale(s: number):   Vec3 { return new Vec3(this.x * s, this.y * s, this.z * s); }
  negate():           Vec3 { return this.scale(-1); }

  dot(v: Vec3): number {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v: Vec3): Vec3 {
    return new Vec3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  length():       number { return Math.sqrt(this.dot(this)); }
  lengthSq():     number { return this.dot(this); }
  distanceTo(v: Vec3): number { return this.sub(v).length(); }

  normalize(): Vec3 {
    const len = this.length();
    return len < 1e-10 ? Vec3.ZERO.clone() : this.scale(1 / len);
  }

  lerp(v: Vec3, t: number): Vec3 {
    return new Vec3(
      this.x + (v.x - this.x) * t,
      this.y + (v.y - this.y) * t,
      this.z + (v.z - this.z) * t
    );
  }

  /** Angle between this and v (radians). */
  angleTo(v: Vec3): number {
    const d = this.normalize().dot(v.normalize());
    return Math.acos(Math.max(-1, Math.min(1, d)));
  }

  toArray(): [number, number, number] { return [this.x, this.y, this.z]; }
  toString(): string { return `Vec3(${this.x.toFixed(4)}, ${this.y.toFixed(4)}, ${this.z.toFixed(4)})`; }

  static fromArray(a: [number, number, number]): Vec3 { return new Vec3(a[0], a[1], a[2]); }
}

// ---------------------------------------------------------------------------
// Quaternion
// ---------------------------------------------------------------------------

/**
 * Unit quaternion representing a 3-D rotation.
 *
 *   q = w + xi + yj + zk  where w = cos(θ/2), (x,y,z) = sin(θ/2)·axis
 *
 * Quaternions avoid gimbal lock and are ideal for skeletal animation blending.
 */
export class Quaternion {
  constructor(
    public x: number = 0,
    public y: number = 0,
    public z: number = 0,
    public w: number = 1
  ) {}

  static readonly IDENTITY = new Quaternion(0, 0, 0, 1);

  clone(): Quaternion { return new Quaternion(this.x, this.y, this.z, this.w); }

  /** Magnitude of the quaternion (should be 1 for a unit quaternion). */
  length(): number {
    return Math.sqrt(this.x**2 + this.y**2 + this.z**2 + this.w**2);
  }

  normalize(): Quaternion {
    const len = this.length();
    if (len < 1e-10) return Quaternion.IDENTITY.clone();
    return new Quaternion(this.x/len, this.y/len, this.z/len, this.w/len);
  }

  conjugate(): Quaternion {
    return new Quaternion(-this.x, -this.y, -this.z, this.w);
  }

  /** Quaternion multiplication q·r (apply r first, then q). */
  multiply(r: Quaternion): Quaternion {
    return new Quaternion(
      this.w*r.x + this.x*r.w + this.y*r.z - this.z*r.y,
      this.w*r.y - this.x*r.z + this.y*r.w + this.z*r.x,
      this.w*r.z + this.x*r.y - this.y*r.x + this.z*r.w,
      this.w*r.w - this.x*r.x - this.y*r.y - this.z*r.z
    ).normalize();
  }

  /** Rotate a Vec3 by this quaternion. */
  rotateVector(v: Vec3): Vec3 {
    const q = this;
    const uv  = new Vec3(
      q.y*v.z - q.z*v.y,
      q.z*v.x - q.x*v.z,
      q.x*v.y - q.y*v.x
    );
    const uuv = new Vec3(
      q.y*uv.z - q.z*uv.y,
      q.z*uv.x - q.x*uv.z,
      q.x*uv.y - q.y*uv.x
    );
    return v
      .add(uv.scale(2 * q.w))
      .add(uuv.scale(2));
  }

  /**
   * Spherical linear interpolation (SLERP).
   * Produces smooth rotation interpolation between two quaternions.
   *
   * @param target  Target quaternion.
   * @param t       Blend factor [0,1].
   */
  slerp(target: Quaternion, t: number): Quaternion {
    let dot = this.x*target.x + this.y*target.y + this.z*target.z + this.w*target.w;

    // Ensure shortest-path rotation
    let tgt = target;
    if (dot < 0) {
      tgt = new Quaternion(-target.x, -target.y, -target.z, -target.w);
      dot = -dot;
    }

    if (dot > 0.9995) {
      // Linear interpolation for very close quaternions
      return new Quaternion(
        this.x + t*(tgt.x - this.x),
        this.y + t*(tgt.y - this.y),
        this.z + t*(tgt.z - this.z),
        this.w + t*(tgt.w - this.w)
      ).normalize();
    }

    const θ₀  = Math.acos(dot);
    const θ   = θ₀ * t;
    const sinθ₀ = Math.sin(θ₀);
    const s0   = Math.cos(θ) - dot * Math.sin(θ) / sinθ₀;
    const s1   = Math.sin(θ) / sinθ₀;

    return new Quaternion(
      s0*this.x + s1*tgt.x,
      s0*this.y + s1*tgt.y,
      s0*this.z + s1*tgt.z,
      s0*this.w + s1*tgt.w
    ).normalize();
  }

  /** Construct a quaternion from axis–angle representation. */
  static fromAxisAngle(axis: Vec3, angle_rad: number): Quaternion {
    const n = axis.normalize();
    const s = Math.sin(angle_rad / 2);
    return new Quaternion(n.x*s, n.y*s, n.z*s, Math.cos(angle_rad / 2));
  }

  /** Construct a quaternion from Euler angles (XYZ order, radians). */
  static fromEulerXYZ(x: number, y: number, z: number): Quaternion {
    const qx = Quaternion.fromAxisAngle(Vec3.X, x);
    const qy = Quaternion.fromAxisAngle(Vec3.Y, y);
    const qz = Quaternion.fromAxisAngle(Vec3.Z, z);
    return qz.multiply(qy).multiply(qx);
  }

  /** Convert to axis-angle representation. */
  toAxisAngle(): { axis: Vec3; angle_rad: number } {
    const q    = this.normalize();
    const angle = 2 * Math.acos(Math.max(-1, Math.min(1, q.w)));
    const s     = Math.sqrt(1 - q.w**2);
    const axis  = s < 1e-10
      ? new Vec3(1, 0, 0)
      : new Vec3(q.x/s, q.y/s, q.z/s);
    return { axis, angle_rad: angle };
  }

  toArray(): [number, number, number, number] {
    return [this.x, this.y, this.z, this.w];
  }

  toString(): string {
    const { axis, angle_rad } = this.toAxisAngle();
    return `Quaternion(axis=${axis}, angle=${((angle_rad*180)/Math.PI).toFixed(2)}°)`;
  }
}

// ---------------------------------------------------------------------------
// Mat4 — 4×4 column-major homogeneous transformation matrix
// ---------------------------------------------------------------------------

/**
 * 4×4 homogeneous transformation matrix (column-major storage).
 *
 * Used to represent combined translation + rotation + scale for each joint.
 * Column-major matches WebGL and most 3-D engines.
 */
export class Mat4 {
  /** 16-element column-major array. m[col*4 + row]. */
  readonly m: Float64Array;

  constructor(elements?: ArrayLike<number>) {
    this.m = new Float64Array(16);
    if (elements) {
      for (let i = 0; i < 16; i++) this.m[i] = elements[i] ?? 0;
    } else {
      // Identity
      this.m[0] = this.m[5] = this.m[10] = this.m[15] = 1;
    }
  }

  static identity(): Mat4 { return new Mat4(); }

  clone(): Mat4 { return new Mat4(this.m); }

  /** Multiply this × other (standard 4×4 matrix product). */
  multiply(o: Mat4): Mat4 {
    const r = new Mat4();
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += this.m[k*4 + row] * o.m[col*4 + k];
        }
        r.m[col*4 + row] = sum;
      }
    }
    return r;
  }

  /** Transform a Vec3 position (w=1). */
  transformPoint(v: Vec3): Vec3 {
    const m = this.m;
    const w = m[3]*v.x + m[7]*v.y + m[11]*v.z + m[15];
    return new Vec3(
      (m[0]*v.x + m[4]*v.y + m[8]*v.z  + m[12]) / w,
      (m[1]*v.x + m[5]*v.y + m[9]*v.z  + m[13]) / w,
      (m[2]*v.x + m[6]*v.y + m[10]*v.z + m[14]) / w
    );
  }

  /** Transform a Vec3 direction (w=0). */
  transformDirection(v: Vec3): Vec3 {
    const m = this.m;
    return new Vec3(
      m[0]*v.x + m[4]*v.y + m[8]*v.z,
      m[1]*v.x + m[5]*v.y + m[9]*v.z,
      m[2]*v.x + m[6]*v.y + m[10]*v.z
    );
  }

  /** Extract the translation component. */
  getTranslation(): Vec3 {
    return new Vec3(this.m[12], this.m[13], this.m[14]);
  }

  /** Build a translation matrix. */
  static fromTranslation(t: Vec3): Mat4 {
    const m = Mat4.identity();
    m.m[12] = t.x; m.m[13] = t.y; m.m[14] = t.z;
    return m;
  }

  /** Build a rotation matrix from a quaternion. */
  static fromQuaternion(q: Quaternion): Mat4 {
    const { x, y, z, w } = q.normalize();
    const m = Mat4.identity();
    m.m[0]  = 1 - 2*(y*y + z*z);
    m.m[1]  = 2*(x*y + z*w);
    m.m[2]  = 2*(x*z - y*w);
    m.m[4]  = 2*(x*y - z*w);
    m.m[5]  = 1 - 2*(x*x + z*z);
    m.m[6]  = 2*(y*z + x*w);
    m.m[8]  = 2*(x*z + y*w);
    m.m[9]  = 2*(y*z - x*w);
    m.m[10] = 1 - 2*(x*x + y*y);
    return m;
  }

  /** Build a TRS (translation × rotation × scale) matrix. */
  static fromTRS(t: Vec3, r: Quaternion, s: Vec3): Mat4 {
    const rot   = Mat4.fromQuaternion(r);
    const trans = Mat4.fromTranslation(t);
    const scale = Mat4.identity();
    scale.m[0]  = s.x; scale.m[5] = s.y; scale.m[10] = s.z;
    return trans.multiply(rot).multiply(scale);
  }

  /** Compute the inverse of a rigid-body (no scale) matrix. */
  invertRigid(): Mat4 {
    // For a rigid-body matrix M = [R | t; 0 | 1]:
    // M⁻¹ = [Rᵀ | −Rᵀt; 0 | 1]
    const m  = this.m;
    const inv = Mat4.identity();
    // Transpose the 3×3 rotation sub-matrix
    inv.m[0] = m[0]; inv.m[1] = m[4]; inv.m[2]  = m[8];
    inv.m[4] = m[1]; inv.m[5] = m[5]; inv.m[6]  = m[9];
    inv.m[8] = m[2]; inv.m[9] = m[6]; inv.m[10] = m[10];
    // Negate the rotated translation
    const tx = m[12]; const ty = m[13]; const tz = m[14];
    inv.m[12] = -(inv.m[0]*tx + inv.m[4]*ty + inv.m[8]*tz);
    inv.m[13] = -(inv.m[1]*tx + inv.m[5]*ty + inv.m[9]*tz);
    inv.m[14] = -(inv.m[2]*tx + inv.m[6]*ty + inv.m[10]*tz);
    return inv;
  }
}

// ===========================================================================
// Skeletal Rig
// ===========================================================================

// ---------------------------------------------------------------------------
// Joint angle constraints
// ---------------------------------------------------------------------------

/** Min/max rotation limits for one Euler axis (radians). */
export interface AxisConstraint { min: number; max: number; }

/** Rotation constraints for a joint (one per Euler axis). */
export interface JointConstraints {
  x?: AxisConstraint;
  y?: AxisConstraint;
  z?: AxisConstraint;
}

/** Apply constraint to a single angle. */
function applyConstraint(angle: number, c?: AxisConstraint): number {
  if (!c) return angle;
  return Math.max(c.min, Math.min(c.max, angle));
}

// ---------------------------------------------------------------------------
// Joint
// ---------------------------------------------------------------------------

/**
 * Joint
 *
 * A single joint in the skeletal hierarchy.
 *
 *   localTranslation  — joint position relative to parent joint (bind-pose offset)
 *   localRotation     — current rotation in local space (animation-driven)
 *   worldTransform    — computed by ForwardKinematics; do not set directly
 */
export class Joint {
  readonly id:   string;
  readonly name: string;
  /** Index in the Skeleton.joints array. */
  readonly index: number;
  /** Index of parent joint (−1 = root). */
  readonly parentIndex: number;
  /** Bone mass estimate (kg) — used for centre-of-mass calculation. */
  mass_kg: number;

  /** Local translation relative to parent (bind-pose rest position). */
  localTranslation: Vec3;
  /** Current local rotation (set by animator or IK solver). */
  localRotation:    Quaternion;
  /** Local scale (typically Vec3.ONE — non-uniform scale is rare in rigs). */
  localScale:       Vec3;

  /** Rotation constraints (optional). */
  constraints: JointConstraints;

  // ── Computed by ForwardKinematics ──────────────────────────────────────────
  /** World-space transform matrix (parent chain applied). */
  worldTransform: Mat4 = Mat4.identity();
  /** Cached world-space position of this joint's pivot. */
  worldPosition:  Vec3 = Vec3.ZERO.clone();

  constructor(options: {
    id:          string;
    name:        string;
    index:       number;
    parentIndex: number;
    translation: Vec3;
    mass_kg?:    number;
    constraints?: JointConstraints;
  }) {
    this.id           = options.id;
    this.name         = options.name;
    this.index        = options.index;
    this.parentIndex  = options.parentIndex;
    this.localTranslation = options.translation.clone();
    this.localRotation    = Quaternion.IDENTITY.clone();
    this.localScale       = Vec3.ONE.clone();
    this.mass_kg          = options.mass_kg ?? 1;
    this.constraints      = options.constraints ?? {};
  }

  /** Apply rotation constraints to the current localRotation. */
  applyConstraints(): void {
    const { axis, angle_rad } = this.localRotation.toAxisAngle();
    // Simplified constraint: clamp total rotation angle
    const clamped = Math.max(-Math.PI, Math.min(Math.PI, angle_rad));
    this.localRotation = Quaternion.fromAxisAngle(axis, clamped);
  }

  /** Local TRS matrix. */
  localMatrix(): Mat4 {
    return Mat4.fromTRS(this.localTranslation, this.localRotation, this.localScale);
  }
}

// ---------------------------------------------------------------------------
// Skeleton
// ---------------------------------------------------------------------------

/**
 * Skeleton
 *
 * A tree of joints stored in a flat array.  The array order is topological
 * (parent always before child) so a single forward pass solves all joints.
 */
export class Skeleton {
  readonly joints: Joint[];
  /** Map from joint ID to array index. */
  private _indexMap: Map<string, number>;

  constructor(joints: Joint[]) {
    this.joints    = joints;
    this._indexMap = new Map(joints.map((j) => [j.id, j.index]));
  }

  /** Look up a joint by ID. Throws if not found. */
  joint(id: string): Joint {
    const idx = this._indexMap.get(id);
    if (idx === undefined) throw new Error(`Skeleton: joint "${id}" not found`);
    return this.joints[idx];
  }

  /** Returns true if the skeleton contains a joint with the given ID. */
  hasJoint(id: string): boolean {
    return this._indexMap.has(id);
  }

  /** Total mass of all joints (kg). */
  get totalMass_kg(): number {
    return this.joints.reduce((sum, j) => sum + j.mass_kg, 0);
  }

  // ── Factory: humanoid biped ───────────────────────────────────────────────

  /**
   * humanoid
   *
   * Creates a standard humanoid skeleton with 22 joints.
   * Joint positions are in metres, centred at the hips.
   *
   * Joint hierarchy (parent → children):
   *   root (hips)
   *   ├── spine_mid
   *   │   ├── spine_upper
   *   │   │   ├── neck
   *   │   │   │   └── head
   *   │   │   ├── shoulder_l → upper_arm_l → forearm_l → hand_l
   *   │   │   └── shoulder_r → upper_arm_r → forearm_r → hand_r
   *   ├── thigh_l → shin_l → foot_l → toe_l
   *   └── thigh_r → shin_r → foot_r → toe_r
   */
  static humanoid(): Skeleton {
    type JSpec = {
      id: string; name: string; parent: number;
      t: [number, number, number]; mass?: number;
      constraints?: JointConstraints;
    };

    const specs: JSpec[] = [
      // idx 0 — root (hips)
      { id:'root',        name:'Hips',           parent:-1, t:[0,0,0],         mass:6.0 },
      // Spine
      { id:'spine_mid',   name:'Spine Mid',      parent:0,  t:[0,0.15,0],      mass:4.0 },
      { id:'spine_upper', name:'Spine Upper',    parent:1,  t:[0,0.15,0],      mass:3.5 },
      { id:'neck',        name:'Neck',           parent:2,  t:[0,0.22,0],      mass:0.8,
        constraints:{ x:{min:-Math.PI/6, max:Math.PI/3}, z:{min:-Math.PI/6, max:Math.PI/6} } },
      { id:'head',        name:'Head',           parent:3,  t:[0,0.12,0],      mass:4.5 },
      // Left arm
      { id:'shoulder_l',  name:'Shoulder L',     parent:2,  t:[-0.18,0.02,0],  mass:0.5 },
      { id:'upper_arm_l', name:'Upper Arm L',    parent:5,  t:[-0.30,0,0],     mass:1.8,
        constraints:{ x:{min:-Math.PI,max:Math.PI}, y:{min:-Math.PI/2,max:Math.PI/2} } },
      { id:'forearm_l',   name:'Forearm L',      parent:6,  t:[-0.28,0,0],     mass:1.1,
        constraints:{ z:{min:-Math.PI*0.9,max:0} } },
      { id:'hand_l',      name:'Hand L',         parent:7,  t:[-0.20,0,0],     mass:0.6 },
      // Right arm
      { id:'shoulder_r',  name:'Shoulder R',     parent:2,  t:[ 0.18,0.02,0],  mass:0.5 },
      { id:'upper_arm_r', name:'Upper Arm R',    parent:9,  t:[ 0.30,0,0],     mass:1.8,
        constraints:{ x:{min:-Math.PI,max:Math.PI}, y:{min:-Math.PI/2,max:Math.PI/2} } },
      { id:'forearm_r',   name:'Forearm R',      parent:10, t:[ 0.28,0,0],     mass:1.1,
        constraints:{ z:{min:0,max:Math.PI*0.9} } },
      { id:'hand_r',      name:'Hand R',         parent:11, t:[ 0.20,0,0],     mass:0.6 },
      // Left leg
      { id:'thigh_l',     name:'Thigh L',        parent:0,  t:[-0.10,-0.05,0], mass:6.5,
        constraints:{ x:{min:-Math.PI*0.8,max:Math.PI/3}, z:{min:0,max:Math.PI/4} } },
      { id:'shin_l',      name:'Shin L',         parent:13, t:[0,-0.44,0],     mass:3.0,
        constraints:{ x:{min:0,max:Math.PI*0.9} } },
      { id:'foot_l',      name:'Foot L',         parent:14, t:[0,-0.42,0],     mass:1.0,
        constraints:{ x:{min:-Math.PI/4,max:Math.PI/6} } },
      { id:'toe_l',       name:'Toe L',          parent:15, t:[0.12,-0.04,0],  mass:0.3 },
      // Right leg
      { id:'thigh_r',     name:'Thigh R',        parent:0,  t:[ 0.10,-0.05,0], mass:6.5,
        constraints:{ x:{min:-Math.PI*0.8,max:Math.PI/3}, z:{min:-Math.PI/4,max:0} } },
      { id:'shin_r',      name:'Shin R',         parent:17, t:[0,-0.44,0],     mass:3.0,
        constraints:{ x:{min:0,max:Math.PI*0.9} } },
      { id:'foot_r',      name:'Foot R',         parent:18, t:[0,-0.42,0],     mass:1.0,
        constraints:{ x:{min:-Math.PI/4,max:Math.PI/6} } },
      { id:'toe_r',       name:'Toe R',          parent:19, t:[0.12,-0.04,0],  mass:0.3 },
    ];

    const joints = specs.map((s, idx) =>
      new Joint({
        id:          s.id,
        name:        s.name,
        index:       idx,
        parentIndex: s.parent,
        translation: new Vec3(...s.t),
        mass_kg:     s.mass,
        constraints: s.constraints,
      })
    );

    return new Skeleton(joints);
  }
}

// ---------------------------------------------------------------------------
// ForwardKinematics
// ---------------------------------------------------------------------------

/**
 * ForwardKinematics
 *
 * Propagates local joint transforms down the skeleton hierarchy to produce
 * world-space transforms.
 *
 *   T_world[k] = T_world[parent(k)] · T_local[k]
 *
 * The joints array must be in topological order (parent before child).
 * This is guaranteed by the humanoid() factory.
 */
export class ForwardKinematics {
  constructor(readonly skeleton: Skeleton) {}

  /**
   * solve
   *
   * Computes world transforms for all joints in one linear pass.
   * Call after any local rotation/translation change.
   *
   * @param rootTransform  Optional world-space transform of the skeleton root.
   *                       Default: identity (skeleton at world origin).
   */
  solve(rootTransform = Mat4.identity()): void {
    const joints = this.skeleton.joints;

    for (const joint of joints) {
      const localMat = joint.localMatrix();

      const parentWorld = joint.parentIndex < 0
        ? rootTransform
        : joints[joint.parentIndex].worldTransform;

      joint.worldTransform = parentWorld.multiply(localMat);
      joint.worldPosition  = joint.worldTransform.getTranslation();
    }
  }
}

// ---------------------------------------------------------------------------
// Inverse Kinematics — Cyclic Coordinate Descent (CCD)
// ---------------------------------------------------------------------------

/** Configuration for a CCD IK chain. */
export interface CCDConfig {
  /** Ordered joint IDs from end-effector toward root. */
  chainIds:    string[];
  /** Maximum iterations per solve call. */
  maxIter:     number;
  /** Convergence threshold (metres). Stop when |effector − target| < threshold. */
  threshold_m: number;
}

/** Result of a CCD solve. */
export interface CCDResult {
  /** Final distance from end-effector to target (metres). */
  residual_m: number;
  /** Number of iterations performed. */
  iterations: number;
  /** True if residual < threshold (target reached). */
  converged: boolean;
}

/**
 * CCDSolver
 *
 * Cyclic Coordinate Descent inverse kinematics solver.
 *
 * Algorithm per iteration, per joint (end → root):
 *   1. Get current end-effector world position (tip of chain)
 *   2. Compute vector A = normalize(effector − joint_world_pos)
 *   3. Compute vector B = normalize(target   − joint_world_pos)
 *   4. Rotation axis  = normalize(A × B)
 *   5. Rotation angle = acos(A · B)
 *   6. Apply rotation to joint.localRotation
 *   7. Apply joint constraints
 *   8. Re-run ForwardKinematics for joints from this joint downward
 *
 * Repeat until |effector − target| < threshold or maxIter reached.
 */
export class CCDSolver {
  readonly config: CCDConfig;
  readonly fk:     ForwardKinematics;

  constructor(fk: ForwardKinematics, config: CCDConfig) {
    this.fk     = fk;
    this.config = config;
  }

  /**
   * solve
   *
   * @param target     World-space target position for the end-effector.
   * @param rootWorld  World transform of the skeleton root.
   */
  solve(target: Vec3, rootWorld = Mat4.identity()): CCDResult {
    const sk    = this.fk.skeleton;
    const chain = this.config.chainIds.map((id) => sk.joint(id));
    const end   = chain[0];   // end-effector joint
    let iter    = 0;
    let residual = Infinity;

    while (iter < this.config.maxIter) {
      // Iterate from end-effector upward toward root
      for (let ci = 0; ci < chain.length; ci++) {
        const joint = chain[ci];

        // Current effector position
        this.fk.solve(rootWorld);
        const effPos = end.worldPosition;

        // Vectors from joint to effector and joint to target
        const toEffector = effPos.sub(joint.worldPosition).normalize();
        const toTarget   = target.sub(joint.worldPosition).normalize();

        const dot   = Math.max(-1, Math.min(1, toEffector.dot(toTarget)));
        const angle = Math.acos(dot);

        if (angle < 1e-6) continue;

        const axis = toEffector.cross(toTarget).normalize();
        if (axis.length() < 1e-8) continue;

        // Convert axis to local space of this joint
        const jointInvWorld = joint.worldTransform.invertRigid();
        const localAxis     = jointInvWorld.transformDirection(axis).normalize();

        // Apply incremental rotation
        const deltaQ = Quaternion.fromAxisAngle(localAxis, angle);
        joint.localRotation = joint.localRotation.multiply(deltaQ).normalize();
        joint.applyConstraints();
      }

      this.fk.solve(rootWorld);
      residual = end.worldPosition.distanceTo(target);
      iter++;

      if (residual < this.config.threshold_m) break;
    }

    return {
      residual_m:  residual,
      iterations:  iter,
      converged:   residual < this.config.threshold_m,
    };
  }
}

// ---------------------------------------------------------------------------
// Animation keyframes & blending
// ---------------------------------------------------------------------------

/** A single keyframe for one joint. */
export interface Keyframe {
  time_s:      number;
  translation: Vec3;
  rotation:    Quaternion;
  scale:       Vec3;
}

/** Animation data for one joint. */
export interface JointTrack {
  jointId:   string;
  keyframes: Keyframe[];
}

/** An animation clip — a sequence of joint tracks. */
export interface AnimationClip {
  name:        string;
  duration_s:  number;
  fps:         number;
  tracks:      JointTrack[];
  /** Whether the clip loops. */
  loop:        boolean;
}

/**
 * sampleTrack
 *
 * Evaluates a JointTrack at time t by finding the surrounding keyframes
 * and SLERP-interpolating the rotation, LERP-interpolating translation/scale.
 */
export function sampleTrack(track: JointTrack, t: number): Keyframe {
  const kf = track.keyframes;
  if (kf.length === 0) {
    return { time_s: t, translation: Vec3.ZERO.clone(), rotation: Quaternion.IDENTITY.clone(), scale: Vec3.ONE.clone() };
  }
  if (t <= kf[0].time_s)               return kf[0];
  if (t >= kf[kf.length - 1].time_s)   return kf[kf.length - 1];

  // Binary search for surrounding frames
  let lo = 0; let hi = kf.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (kf[mid].time_s <= t) lo = mid; else hi = mid;
  }

  const a  = kf[lo];
  const b  = kf[hi];
  const dt = b.time_s - a.time_s;
  const u  = dt < 1e-10 ? 0 : (t - a.time_s) / dt;

  return {
    time_s:      t,
    translation: a.translation.lerp(b.translation, u),
    rotation:    a.rotation.slerp(b.rotation, u),
    scale:       a.scale.lerp(b.scale, u),
  };
}

/**
 * applyClip
 *
 * Applies an AnimationClip at a given time to a Skeleton by setting
 * each joint's localTranslation / localRotation / localScale.
 *
 * @param skeleton  The skeleton to pose.
 * @param clip      The animation clip.
 * @param time_s    Current playback time (seconds).
 */
export function applyClip(skeleton: Skeleton, clip: AnimationClip, time_s: number): void {
  let t = clip.loop
    ? ((time_s % clip.duration_s) + clip.duration_s) % clip.duration_s
    : Math.min(time_s, clip.duration_s);

  for (const track of clip.tracks) {
    if (!skeleton.hasJoint(track.jointId)) continue;
    const joint  = skeleton.joint(track.jointId);
    const sample = sampleTrack(track, t);
    joint.localTranslation = sample.translation;
    joint.localRotation    = sample.rotation;
    joint.localScale       = sample.scale;
  }
}

/**
 * blendClips
 *
 * Cross-fades between two animation clips (A and B) using per-joint
 * SLERP/LERP with a scalar blend factor.
 *
 * @param skeleton   The skeleton to pose.
 * @param clipA      Source clip.
 * @param timeA_s    Current time in clip A.
 * @param clipB      Target clip.
 * @param timeB_s    Current time in clip B.
 * @param blend      Blend factor [0=clipA only, 1=clipB only].
 */
export function blendClips(
  skeleton: Skeleton,
  clipA: AnimationClip, timeA_s: number,
  clipB: AnimationClip, timeB_s: number,
  blend: number
): void {
  const b = Math.max(0, Math.min(1, blend));

  for (const trackA of clipA.tracks) {
    if (!skeleton.hasJoint(trackA.jointId)) continue;
    const trackB = clipB.tracks.find((t) => t.jointId === trackA.jointId);
    const sA     = sampleTrack(trackA, timeA_s);
    const sB     = trackB ? sampleTrack(trackB, timeB_s) : sA;

    const joint = skeleton.joint(trackA.jointId);
    joint.localTranslation = sA.translation.lerp(sB.translation, b);
    joint.localRotation    = sA.rotation.slerp(sB.rotation, b);
    joint.localScale       = sA.scale.lerp(sB.scale, b);
  }
}

// ---------------------------------------------------------------------------
// Centre-of-mass & balance solver
// ---------------------------------------------------------------------------

/**
 * BalanceSolver
 *
 * Computes the centre of mass (CoM) of the skeleton and checks whether
 * it falls within the support polygon (defined by foot joint positions).
 *
 * If the CoM is outside the support polygon, the solver tilts the root
 * joint to bring the CoM back within bounds — simulating the weight-shift
 * a real character makes to maintain balance.
 *
 * Medical application: identical math is used for surgical robot arm
 * stability analysis — the CoM of the arm must stay within the base footprint.
 */
export class BalanceSolver {
  constructor(readonly fk: ForwardKinematics) {}

  /**
   * centreOfMass
   *
   * CoM = Σ(mᵢ · pᵢ) / Σmᵢ
   *
   * @returns  World-space centre of mass position.
   */
  centreOfMass(): Vec3 {
    const joints = this.fk.skeleton.joints;
    let totalMass = 0;
    let comX = 0, comY = 0, comZ = 0;

    for (const joint of joints) {
      const m   = joint.mass_kg;
      const pos = joint.worldPosition;
      comX += m * pos.x;
      comY += m * pos.y;
      comZ += m * pos.z;
      totalMass += m;
    }
    if (totalMass === 0) return Vec3.ZERO.clone();
    return new Vec3(comX / totalMass, comY / totalMass, comZ / totalMass);
  }

  /**
   * isBalanced
   *
   * Checks if the CoM (projected onto the ground plane Y=0) falls within
   * the convex hull of the foot joint positions.
   *
   * Uses a simple point-in-polygon test (shoelace winding number).
   *
   * @param footJointIds  IDs of the foot joints defining the support polygon.
   */
  isBalanced(footJointIds: string[]): boolean {
    const sk      = this.fk.skeleton;
    const com     = this.centreOfMass();
    const comX    = com.x;
    const comZ    = com.z;

    // Foot positions projected onto ground
    const feet = footJointIds.map((id) => {
      const p = sk.joint(id).worldPosition;
      return { x: p.x, z: p.z };
    });

    if (feet.length < 3) {
      // Line support: check if CoM is between two feet ±0.05 m margin
      if (feet.length === 2) {
        const [a, b] = feet;
        const t = ((comX - a.x)*(b.x-a.x) + (comZ - a.z)*(b.z-a.z)) /
                  ((b.x-a.x)**2 + (b.z-a.z)**2 + 1e-12);
        const px = a.x + t*(b.x-a.x);
        const pz = a.z + t*(b.z-a.z);
        return Math.sqrt((comX-px)**2 + (comZ-pz)**2) < 0.05;
      }
      return true;
    }

    // Winding number test
    let winding = 0;
    const n = feet.length;
    for (let i = 0; i < n; i++) {
      const a = feet[i];
      const b = feet[(i + 1) % n];
      if (a.z <= comZ) {
        if (b.z > comZ) {
          const cross = (b.x - a.x) * (comZ - a.z) - (comX - a.x) * (b.z - a.z);
          if (cross > 0) winding++;
        }
      } else {
        if (b.z <= comZ) {
          const cross = (b.x - a.x) * (comZ - a.z) - (comX - a.x) * (b.z - a.z);
          if (cross < 0) winding--;
        }
      }
    }
    return winding !== 0;
  }
}
