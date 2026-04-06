/**
 * Machinist Mario Engine — Matrix4 Core
 *
 * The "Hand" that moves the Vector3.  An immutable 4×4 homogeneous
 * transformation matrix stored in column-major order (matching WebGL,
 * OpenGL, and Android's GLES conventions).
 *
 * ── Why 4×4 homogeneous matrices ─────────────────────────────────────────────
 * A 3×3 rotation matrix cannot express translation.  Adding a 4th
 * homogeneous row/column unifies rotation, translation, and scale into
 * a single multiply operation:
 *
 *   [ R  t ] [ v ]   [ Rv + t ]
 *   [ 0  1 ] [ 1 ] = [   1   ]
 *
 * This lets us chain any number of transforms with a single matrix product:
 *   world = root × spine × upperArm × forearm
 *
 * ── Column-major storage ──────────────────────────────────────────────────────
 * Elements are stored as m[col × 4 + row], matching OpenGL / WebGL layout.
 * Android's android.opengl.Matrix also uses column-major order.
 *
 *   Column 0: m[0]  m[1]  m[2]  m[3]
 *   Column 1: m[4]  m[5]  m[6]  m[7]
 *   Column 2: m[8]  m[9]  m[10] m[11]
 *   Column 3: m[12] m[13] m[14] m[15]
 *
 * ── Immutability ──────────────────────────────────────────────────────────────
 * All factory methods and operators return new Matrix4 instances.
 * The internal Float64Array is frozen after construction.
 *
 * Usage:
 *   import { Matrix4 } from './matrix4';
 *   import { Vector3 } from './vector3';
 *
 *   const world = Matrix4.translation(new Vector3(1, 0, 0))
 *                        .multiply(Matrix4.rotationY(Math.PI / 4));
 *   const pt    = world.transformPoint(new Vector3(0, 0, 1));
 */

import { Vector3 } from './vector3';

// ---------------------------------------------------------------------------
// Quaternion (minimal, for fromQuaternion) — imported inline to avoid circular deps
// ---------------------------------------------------------------------------

/** A unit quaternion (w + xi + yj + zk). */
export interface Quat { x: number; y: number; z: number; w: number; }

// ---------------------------------------------------------------------------
// Matrix4
// ---------------------------------------------------------------------------

/**
 * Matrix4
 *
 * Immutable 4×4 homogeneous transformation matrix.
 * All methods return new Matrix4 instances — the receiver is never mutated.
 */
export class Matrix4 {

  /** Internal column-major storage (16 doubles). */
  readonly elements: Readonly<Float64Array>;

  private constructor(src?: ArrayLike<number>) {
    const e = new Float64Array(16);
    if (src) {
      for (let i = 0; i < 16; i++) e[i] = src[i] ?? 0;
    } else {
      // Identity
      e[0] = e[5] = e[10] = e[15] = 1;
    }
    this.elements = Object.freeze(e) as Readonly<Float64Array>;
  }

  // ── Factories ─────────────────────────────────────────────────────────────

  /** 4×4 identity matrix. */
  static identity(): Matrix4 {
    return new Matrix4();
  }

  /**
   * Pure translation matrix.
   *   T = I with column 3 = (tx, ty, tz, 1)
   */
  static translation(t: Vector3): Matrix4 {
    const e = new Float64Array(16);
    e[0] = e[5] = e[10] = e[15] = 1;
    e[12] = t.x; e[13] = t.y; e[14] = t.z;
    return new Matrix4(e);
  }

  /**
   * Pure uniform scale matrix.
   *   S = diag(sx, sy, sz, 1)
   */
  static scale(s: Vector3): Matrix4 {
    const e = new Float64Array(16);
    e[0] = s.x; e[5] = s.y; e[10] = s.z; e[15] = 1;
    return new Matrix4(e);
  }

  /**
   * Rotation about the X-axis by angle_rad radians.
   *   Rx = [1, 0,    0   ]
   *        [0, cosθ, −sinθ]
   *        [0, sinθ,  cosθ]
   */
  static rotationX(angle_rad: number): Matrix4 {
    const c = Math.cos(angle_rad);
    const s = Math.sin(angle_rad);
    const e = new Float64Array(16);
    e[0] = 1; e[5] = c; e[6] = s; e[9] = -s; e[10] = c; e[15] = 1;
    return new Matrix4(e);
  }

  /**
   * Rotation about the Y-axis by angle_rad radians.
   *   Ry = [cosθ,  0, sinθ]
   *        [0,     1, 0   ]
   *        [−sinθ, 0, cosθ]
   */
  static rotationY(angle_rad: number): Matrix4 {
    const c = Math.cos(angle_rad);
    const s = Math.sin(angle_rad);
    const e = new Float64Array(16);
    e[0] = c; e[2] = -s; e[5] = 1; e[8] = s; e[10] = c; e[15] = 1;
    return new Matrix4(e);
  }

  /**
   * Rotation about the Z-axis by angle_rad radians.
   *   Rz = [cosθ, −sinθ, 0]
   *        [sinθ,  cosθ, 0]
   *        [0,     0,    1]
   */
  static rotationZ(angle_rad: number): Matrix4 {
    const c = Math.cos(angle_rad);
    const s = Math.sin(angle_rad);
    const e = new Float64Array(16);
    e[0] = c; e[1] = s; e[4] = -s; e[5] = c; e[10] = 1; e[15] = 1;
    return new Matrix4(e);
  }

  /**
   * Rotation about an arbitrary axis by angle_rad (Rodrigues' rotation formula).
   *
   *   R = I·cos θ + (1−cos θ)·(k⊗k) + sin θ·[k]×
   *
   * where k is the unit axis vector and [k]× is the skew-symmetric cross-product matrix.
   *
   * @param axis       Unit rotation axis (normalised internally).
   * @param angle_rad  Rotation angle in radians.
   */
  static rotationAxis(axis: Vector3, angle_rad: number): Matrix4 {
    const n = axis.normalize();
    const { x, y, z } = n;
    const c  = Math.cos(angle_rad);
    const s  = Math.sin(angle_rad);
    const t  = 1 - c;

    const e = new Float64Array(16);
    // Row-by-column (column-major storage)
    e[0]  = t*x*x + c;    e[1]  = t*x*y + s*z;  e[2]  = t*x*z - s*y;
    e[4]  = t*x*y - s*z;  e[5]  = t*y*y + c;    e[6]  = t*y*z + s*x;
    e[8]  = t*x*z + s*y;  e[9]  = t*y*z - s*x;  e[10] = t*z*z + c;
    e[15] = 1;
    return new Matrix4(e);
  }

  /**
   * Rotation matrix from a unit quaternion.
   *
   *   R = [ 1−2(y²+z²)   2(xy−wz)    2(xz+wy) ]
   *       [ 2(xy+wz)    1−2(x²+z²)   2(yz−wx) ]
   *       [ 2(xz−wy)    2(yz+wx)    1−2(x²+y²) ]
   */
  static fromQuaternion(q: Quat): Matrix4 {
    const { x, y, z, w } = q;
    const e = new Float64Array(16);
    e[0]  = 1 - 2*(y*y + z*z);
    e[1]  =     2*(x*y + z*w);
    e[2]  =     2*(x*z - y*w);
    e[4]  =     2*(x*y - z*w);
    e[5]  = 1 - 2*(x*x + z*z);
    e[6]  =     2*(y*z + x*w);
    e[8]  =     2*(x*z + y*w);
    e[9]  =     2*(y*z - x*w);
    e[10] = 1 - 2*(x*x + y*y);
    e[15] = 1;
    return new Matrix4(e);
  }

  /**
   * TRS: Translation × Rotation (from quaternion) × Scale.
   * The standard "object transform" used in every joint of the skeletal rig.
   *
   * @param t  Translation vector.
   * @param r  Unit quaternion rotation.
   * @param s  Scale vector (default Vector3.ONE).
   */
  static fromTRS(t: Vector3, r: Quat, s: Vector3 = Vector3.ONE): Matrix4 {
    return Matrix4.translation(t)
      .multiply(Matrix4.fromQuaternion(r))
      .multiply(Matrix4.scale(s));
  }

  /**
   * lookAt
   *
   * Constructs a view matrix that positions the camera at `eye`, looking
   * toward `target`, with `up` defining the camera's upward direction.
   *
   * Identical to gl-matrix's mat4.lookAt.
   *
   * @param eye     Camera position.
   * @param target  Look-at point.
   * @param up      World up vector (usually Vector3.Y).
   */
  static lookAt(eye: Vector3, target: Vector3, up: Vector3 = Vector3.Y): Matrix4 {
    const f  = eye.subtract(target).normalize();          // forward (−z)
    const r  = up.cross(f).normalize();                   // right
    const u  = f.cross(r);                                // recalculated up

    const e = new Float64Array(16);
    e[0]  = r.x;  e[1]  = u.x;  e[2]  = f.x;
    e[4]  = r.y;  e[5]  = u.y;  e[6]  = f.y;
    e[8]  = r.z;  e[9]  = u.z;  e[10] = f.z;
    e[12] = -r.dot(eye);
    e[13] = -u.dot(eye);
    e[14] = -f.dot(eye);
    e[15] = 1;
    return new Matrix4(e);
  }

  /**
   * perspective
   *
   * OpenGL-style perspective projection matrix.
   *
   * @param fovy_rad  Vertical field of view (radians).
   * @param aspect    Viewport width / height.
   * @param near      Near clipping plane distance (> 0).
   * @param far       Far clipping plane distance (> near).
   */
  static perspective(fovy_rad: number, aspect: number, near: number, far: number): Matrix4 {
    const f   = 1 / Math.tan(fovy_rad / 2);
    const nf  = 1 / (near - far);
    const e   = new Float64Array(16);
    e[0]  = f / aspect;
    e[5]  = f;
    e[10] = (far + near) * nf;
    e[11] = -1;
    e[14] = 2 * far * near * nf;
    return new Matrix4(e);
  }

  /**
   * orthographic
   *
   * Orthographic projection matrix — used for 2-D G-code preview rendering
   * on the Android canvas (no perspective distortion).
   */
  static orthographic(
    left: number, right: number,
    bottom: number, top: number,
    near: number, far: number
  ): Matrix4 {
    const lr  = 1 / (left   - right);
    const bt  = 1 / (bottom - top);
    const nf  = 1 / (near   - far);
    const e   = new Float64Array(16);
    e[0]  = -2 * lr;
    e[5]  = -2 * bt;
    e[10] =  2 * nf;
    e[12] = (left  + right)  * lr;
    e[13] = (top   + bottom) * bt;
    e[14] = (far   + near)   * nf;
    e[15] = 1;
    return new Matrix4(e);
  }

  // ── Operations ────────────────────────────────────────────────────────────

  /**
   * multiply
   *
   * Standard 4×4 matrix product: this × other.
   *
   * Transform order: vectors are multiplied on the right, so
   *   world = parent.multiply(local)
   * applies `local` first, then `parent`.
   */
  multiply(other: Matrix4): Matrix4 {
    const a = this.elements;
    const b = other.elements;
    const r = new Float64Array(16);

    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 4; col++) {
        let sum = 0;
        for (let k = 0; k < 4; k++) {
          sum += a[k * 4 + row] * b[col * 4 + k];
        }
        r[col * 4 + row] = sum;
      }
    }
    return new Matrix4(r);
  }

  /**
   * transformPoint
   *
   * Applies this transform to a position vector (w = 1).
   * Performs perspective divide when the matrix is a projection.
   */
  transformPoint(v: Vector3): Vector3 {
    const m = this.elements;
    const w = m[3]*v.x + m[7]*v.y + m[11]*v.z + m[15];
    const iw = w === 0 ? 1 : 1 / w;
    return new Vector3(
      (m[0]*v.x + m[4]*v.y + m[8]*v.z  + m[12]) * iw,
      (m[1]*v.x + m[5]*v.y + m[9]*v.z  + m[13]) * iw,
      (m[2]*v.x + m[6]*v.y + m[10]*v.z + m[14]) * iw
    );
  }

  /**
   * transformDirection
   *
   * Applies the rotational part of this transform to a direction vector
   * (w = 0 — translation is NOT applied).
   * Used for normals, velocities, and force vectors.
   */
  transformDirection(v: Vector3): Vector3 {
    const m = this.elements;
    return new Vector3(
      m[0]*v.x + m[4]*v.y + m[8]*v.z,
      m[1]*v.x + m[5]*v.y + m[9]*v.z,
      m[2]*v.x + m[6]*v.y + m[10]*v.z
    );
  }

  // ── Decomposition ─────────────────────────────────────────────────────────

  /** Extract the translation component (column 3, rows 0–2). */
  getTranslation(): Vector3 {
    const m = this.elements;
    return new Vector3(m[12], m[13], m[14]);
  }

  /**
   * Extract the scale from the matrix (length of each basis column vector).
   * Only valid for TRS matrices with no shear.
   */
  getScale(): Vector3 {
    const m = this.elements;
    return new Vector3(
      Math.sqrt(m[0]**2 + m[1]**2 + m[2]**2),
      Math.sqrt(m[4]**2 + m[5]**2 + m[6]**2),
      Math.sqrt(m[8]**2 + m[9]**2 + m[10]**2)
    );
  }

  // ── Inversion ─────────────────────────────────────────────────────────────

  /**
   * invertRigid
   *
   * Fast inversion for rigid-body matrices (pure rotation + translation,
   * no scale or shear).
   *
   *   If M = [R | t], then M⁻¹ = [Rᵀ | −Rᵀt]
   *
   * Used for: converting world coordinates back to joint-local space
   * (required by the CCD IK solver in skeletal-rig.ts).
   */
  invertRigid(): Matrix4 {
    const m   = this.elements;
    const e   = new Float64Array(16);

    // Transpose the 3×3 rotation block
    e[0] = m[0]; e[1] = m[4]; e[2]  = m[8];
    e[4] = m[1]; e[5] = m[5]; e[6]  = m[9];
    e[8] = m[2]; e[9] = m[6]; e[10] = m[10];
    e[15] = 1;

    // Translation: −Rᵀ · t
    const tx = m[12]; const ty = m[13]; const tz = m[14];
    e[12] = -(e[0]*tx + e[4]*ty + e[8]*tz);
    e[13] = -(e[1]*tx + e[5]*ty + e[9]*tz);
    e[14] = -(e[2]*tx + e[6]*ty + e[10]*tz);

    return new Matrix4(e);
  }

  /**
   * invert
   *
   * General 4×4 matrix inversion using Cramer's rule (cofactor expansion).
   * Returns null if the matrix is singular (determinant ≈ 0).
   *
   * Use `invertRigid()` when possible — this is ~4× slower.
   */
  invert(): Matrix4 | null {
    const m   = this.elements;
    const inv = new Float64Array(16);

    inv[0]  =  m[5]*m[10]*m[15] - m[5]*m[11]*m[14] - m[9]*m[6]*m[15] + m[9]*m[7]*m[14] + m[13]*m[6]*m[11] - m[13]*m[7]*m[10];
    inv[4]  = -m[4]*m[10]*m[15] + m[4]*m[11]*m[14] + m[8]*m[6]*m[15] - m[8]*m[7]*m[14] - m[12]*m[6]*m[11] + m[12]*m[7]*m[10];
    inv[8]  =  m[4]*m[9] *m[15] - m[4]*m[11]*m[13] - m[8]*m[5]*m[15] + m[8]*m[7]*m[13] + m[12]*m[5]*m[11] - m[12]*m[7]*m[9];
    inv[12] = -m[4]*m[9] *m[14] + m[4]*m[10]*m[13] + m[8]*m[5]*m[14] - m[8]*m[6]*m[13] - m[12]*m[5]*m[10] + m[12]*m[6]*m[9];

    inv[1]  = -m[1]*m[10]*m[15] + m[1]*m[11]*m[14] + m[9]*m[2]*m[15] - m[9]*m[3]*m[14] - m[13]*m[2]*m[11] + m[13]*m[3]*m[10];
    inv[5]  =  m[0]*m[10]*m[15] - m[0]*m[11]*m[14] - m[8]*m[2]*m[15] + m[8]*m[3]*m[14] + m[12]*m[2]*m[11] - m[12]*m[3]*m[10];
    inv[9]  = -m[0]*m[9] *m[15] + m[0]*m[11]*m[13] + m[8]*m[1]*m[15] - m[8]*m[3]*m[13] - m[12]*m[1]*m[11] + m[12]*m[3]*m[9];
    inv[13] =  m[0]*m[9] *m[14] - m[0]*m[10]*m[13] - m[8]*m[1]*m[14] + m[8]*m[2]*m[13] + m[12]*m[1]*m[10] - m[12]*m[2]*m[9];

    inv[2]  =  m[1]*m[6]*m[15] - m[1]*m[7]*m[14] - m[5]*m[2]*m[15] + m[5]*m[3]*m[14] + m[13]*m[2]*m[7] - m[13]*m[3]*m[6];
    inv[6]  = -m[0]*m[6]*m[15] + m[0]*m[7]*m[14] + m[4]*m[2]*m[15] - m[4]*m[3]*m[14] - m[12]*m[2]*m[7] + m[12]*m[3]*m[6];
    inv[10] =  m[0]*m[5]*m[15] - m[0]*m[7]*m[13] - m[4]*m[1]*m[15] + m[4]*m[3]*m[13] + m[12]*m[1]*m[7] - m[12]*m[3]*m[5];
    inv[14] = -m[0]*m[5]*m[14] + m[0]*m[6]*m[13] + m[4]*m[1]*m[14] - m[4]*m[2]*m[13] - m[12]*m[1]*m[6] + m[12]*m[2]*m[5];

    inv[3]  = -m[1]*m[6]*m[11] + m[1]*m[7]*m[10] + m[5]*m[2]*m[11] - m[5]*m[3]*m[10] - m[9]*m[2]*m[7] + m[9]*m[3]*m[6];
    inv[7]  =  m[0]*m[6]*m[11] - m[0]*m[7]*m[10] - m[4]*m[2]*m[11] + m[4]*m[3]*m[10] + m[8]*m[2]*m[7] - m[8]*m[3]*m[6];
    inv[11] = -m[0]*m[5]*m[11] + m[0]*m[7]*m[9]  + m[4]*m[1]*m[11] - m[4]*m[3]*m[9]  - m[8]*m[1]*m[7] + m[8]*m[3]*m[5];
    inv[15] =  m[0]*m[5]*m[10] - m[0]*m[6]*m[9]  - m[4]*m[1]*m[10] + m[4]*m[2]*m[9]  + m[8]*m[1]*m[6] - m[8]*m[2]*m[5];

    const det = m[0]*inv[0] + m[1]*inv[4] + m[2]*inv[8] + m[3]*inv[12];
    if (Math.abs(det) < 1e-15) return null;

    const id = 1 / det;
    for (let i = 0; i < 16; i++) inv[i] *= id;

    return new Matrix4(inv);
  }

  // ── Serialisation ─────────────────────────────────────────────────────────

  /** Return elements as a plain 16-element array (column-major). */
  toArray(): number[] {
    return Array.from(this.elements);
  }

  /** Return a copy of the internal Float64Array. */
  toFloat64Array(): Float64Array {
    return new Float64Array(this.elements);
  }

  static fromArray(arr: ArrayLike<number>): Matrix4 {
    return new Matrix4(arr);
  }

  /** Format as a 4×4 grid for debugging. */
  toString(): string {
    const m = this.elements;
    const f = (n: number) => n.toFixed(4).padStart(9);
    return [
      `[ ${f(m[0])} ${f(m[4])} ${f(m[8])}  ${f(m[12])} ]`,
      `[ ${f(m[1])} ${f(m[5])} ${f(m[9])}  ${f(m[13])} ]`,
      `[ ${f(m[2])} ${f(m[6])} ${f(m[10])} ${f(m[14])} ]`,
      `[ ${f(m[3])} ${f(m[7])} ${f(m[11])} ${f(m[15])} ]`,
    ].join('\n');
  }
}
