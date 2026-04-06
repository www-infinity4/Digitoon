/**
 * Kinematics — Standalone Machinist Arm Inverse Kinematics
 *
 * Two solving strategies are provided:
 *
 *  1. IKSolver2D  — Law-of-Cosines closed-form solver for a classic 2-joint
 *     planar arm.  Exact and instant; degenerates gracefully at the limits of
 *     reach.
 *
 *  2. FABRIKSolver — Forward And Backward Reaching IK (Aristidou & Lasenby,
 *     2011) for an arbitrary N-joint chain in 3D.  Iterative; converges to
 *     sub-millimetre tolerance in fewer than 20 iterations for typical arms.
 *
 *  3. RoboticArm  — Mario's machinist arm (shoulder→elbow→wrist) implemented
 *     over FABRIKSolver.  Converts from joint positions to a CNC toolpath
 *     with one call to `toCNCPath()`.
 *
 * References
 * ─────────────────────────────────────────────────────────────────────────────
 *  • Aristidou A., Lasenby J. (2011) FABRIK: A fast, iterative solver for the
 *    IK problem.  Graphical Models 73(5):243-260.
 *  • Craig J.J. (2005) Introduction to Robotics, 3rd ed.  Pearson.
 */

import { Vector3 } from './vector3';

// ─── Bone ─────────────────────────────────────────────────────────────────────

/**
 * A single rigid link in a kinematic chain.
 *
 * `angle`    — current joint angle in radians (mutable; IK updates it each solve).
 * `position` — world-space root of this bone (mutable; updated after each solve).
 */
export class Bone {
  public length: number;
  public angle: number;
  public position: Vector3;

  constructor(length: number, angle: number = 0, position: Vector3 = new Vector3()) {
    this.length = length;
    this.angle = angle;
    this.position = position;
  }

  /** Tip position given root position and current angle (2-D, in XY plane). */
  public tip2D(): Vector3 {
    return new Vector3(
      this.position.x + this.length * Math.cos(this.angle),
      this.position.y + this.length * Math.sin(this.angle),
      this.position.z
    );
  }
}

// ─── IKSolver2D ──────────────────────────────────────────────────────────────

/** Result from a 2-joint 2D IK solve. */
export interface IKResult2D {
  /** True when the target is reachable. */
  solved: boolean;
  /** Upper-arm joint angle (radians, measured from +X axis). */
  upperAngle: number;
  /** Elbow joint angle (radians, measured from upper arm). */
  lowerAngle: number;
  /** Total arm reach (sum of bone lengths). */
  reach: number;
  /** Euclidean distance from root to target. */
  distToTarget: number;
}

/**
 * Closed-form 2-joint inverse kinematics in 2D (XY plane).
 *
 * Uses the Law of Cosines to find elbow angle, then the two-argument
 * `atan2` to place the upper arm.
 *
 *   cos θ_elbow = (d² − L₁² − L₂²) / (2 L₁ L₂)
 *   θ_shoulder  = atan2(ty, tx) − atan2(L₂ sin θ_e, L₁ + L₂ cos θ_e)
 */
export class IKSolver2D {
  /**
   * Solve for the joint angles of a 2-link arm whose root is at `upper.position`.
   *
   * After solving, `upper.angle` and `lower.angle` are updated in-place
   * and the tip of `lower` lands as close to `target` as possible.
   */
  public solve(target: Vector3, upper: Bone, lower: Bone): IKResult2D {
    const L1 = upper.length;
    const L2 = lower.length;
    const reach = L1 + L2;

    // Distance from shoulder (upper.position) to target
    const dx = target.x - upper.position.x;
    const dy = target.y - upper.position.y;
    const d  = Math.sqrt(dx * dx + dy * dy);

    // Over-reach: target beyond total arm length — stretch toward it
    if (d >= reach) {
      const angle = Math.atan2(dy, dx);
      upper.angle = angle;
      lower.angle = 0; // fully extended
      lower.position = upper.tip2D();
      return { solved: false, upperAngle: angle, lowerAngle: 0, reach, distToTarget: d };
    }

    // Under-reach: target too close (L1+L2 < minimum) — best approximation
    const minReach = Math.abs(L1 - L2);
    if (d <= minReach) {
      const angle = Math.atan2(dy, dx);
      // Fold: elbow angle = π (fully folded) when target is inside
      const elbowAngle = L1 >= L2 ? Math.PI : -Math.PI;
      upper.angle = angle;
      lower.angle = elbowAngle;
      lower.position = upper.tip2D();
      return { solved: false, upperAngle: angle, lowerAngle: elbowAngle, reach, distToTarget: d };
    }

    // Law of Cosines: find elbow angle
    const cosElbow = (d * d - L1 * L1 - L2 * L2) / (2 * L1 * L2);
    const elbowAngle = Math.acos(Math.max(-1, Math.min(1, cosElbow)));

    // Shoulder angle
    const k1 = L1 + L2 * Math.cos(elbowAngle);
    const k2 = L2 * Math.sin(elbowAngle);
    const shoulderAngle = Math.atan2(dy, dx) - Math.atan2(k2, k1);

    upper.angle = shoulderAngle;
    lower.angle = elbowAngle;
    lower.position = upper.tip2D();

    return {
      solved: true,
      upperAngle: shoulderAngle,
      lowerAngle: elbowAngle,
      reach,
      distToTarget: d,
    };
  }
}

// ─── FABRIKSolver ─────────────────────────────────────────────────────────────

/** Result from a FABRIK multi-joint solve. */
export interface FABRIKResult {
  solved: boolean;
  /** Updated joint positions (length = joints.length). */
  joints: Vector3[];
  /** Number of iterations performed. */
  iterations: number;
  /** Distance from effector to target at convergence. */
  finalError: number;
}

/**
 * Forward And Backward Reaching Inverse Kinematics (FABRIK).
 *
 * Works on an N-joint chain in full 3D.  The algorithm alternates:
 *   Forward pass  — pull the end-effector to the target, re-anchor each joint.
 *   Backward pass — re-anchor root, re-apply joint-length constraints toward effector.
 *
 * Converges when `||effector − target|| < tolerance`.
 */
export class FABRIKSolver {
  private readonly tolerance: number;
  private readonly maxIterations: number;

  constructor(tolerance: number = 0.01, maxIterations: number = 64) {
    this.tolerance = tolerance;
    this.maxIterations = maxIterations;
  }

  /**
   * Solve the IK chain.
   *
   * @param joints      Mutable joint positions (will be cloned internally; originals untouched).
   * @param boneLengths Length of each bone connecting joints[i] to joints[i+1].
   *                    Must have length = joints.length − 1.
   * @param target      Desired end-effector world position.
   */
  public solve(joints: Vector3[], boneLengths: number[], target: Vector3): FABRIKResult {
    if (joints.length < 2 || boneLengths.length < joints.length - 1) {
      return { solved: false, joints: [...joints], iterations: 0, finalError: Infinity };
    }

    // Work on a mutable copy
    const p: Vector3[] = joints.map(j => new Vector3(j.x, j.y, j.z));
    const n = p.length;
    const root = new Vector3(p[0].x, p[0].y, p[0].z);

    // Total chain length
    const totalLength = boneLengths.reduce((s, l) => s + l, 0);

    // If target is unreachable, stretch the chain toward it
    const distToTarget = p[0].distanceTo(target);
    if (distToTarget > totalLength) {
      for (let i = 0; i < n - 1; i++) {
        const dir = target.subtract(p[i]).normalize();
        p[i + 1] = p[i].add(dir.scale(boneLengths[i]));
      }
      const finalError = p[n - 1].distanceTo(target);
      return { solved: false, joints: p, iterations: 1, finalError };
    }

    let iter = 0;
    let finalError = Infinity;

    while (iter < this.maxIterations) {
      finalError = p[n - 1].distanceTo(target);
      if (finalError < this.tolerance) break;

      // Forward pass: start at effector, pull toward target
      p[n - 1] = new Vector3(target.x, target.y, target.z);
      for (let i = n - 2; i >= 0; i--) {
        const dir = p[i].subtract(p[i + 1]).normalize();
        p[i] = p[i + 1].add(dir.scale(boneLengths[i]));
      }

      // Backward pass: restore root, propagate toward effector
      p[0] = new Vector3(root.x, root.y, root.z);
      for (let i = 0; i < n - 1; i++) {
        const dir = p[i + 1].subtract(p[i]).normalize();
        p[i + 1] = p[i].add(dir.scale(boneLengths[i]));
      }

      iter++;
    }

    finalError = p[n - 1].distanceTo(target);
    return {
      solved: finalError < this.tolerance,
      joints: p,
      iterations: iter,
      finalError,
    };
  }
}

// ─── RoboticArm ──────────────────────────────────────────────────────────────

/** Pose of Mario's 3-joint machinist arm after an IK solve. */
export interface RoboticArmPose {
  shoulder: Vector3;
  elbow: Vector3;
  wrist: Vector3;
  solved: boolean;
}

/**
 * Mario's machinist arm — three joints: shoulder, elbow, wrist.
 *
 * Internally driven by `FABRIKSolver` for robust 3D IK.  The shoulder is
 * fixed at the origin.
 */
export class RoboticArm {
  private readonly upperArmLen: number;
  private readonly forearmLen: number;
  private readonly handLen: number;
  private readonly solver: FABRIKSolver;

  private lastPose: RoboticArmPose = {
    shoulder: new Vector3(),
    elbow: new Vector3(),
    wrist: new Vector3(),
    solved: false,
  };

  constructor(upperArmLen: number = 300, forearmLen: number = 280, handLen: number = 120) {
    this.upperArmLen = upperArmLen;
    this.forearmLen = forearmLen;
    this.handLen = handLen;
    this.solver = new FABRIKSolver(0.1, 64);
  }

  /**
   * Solve IK to place the wrist at `target`.
   *
   * The shoulder is pinned at origin.  Elbow and wrist positions are
   * computed by FABRIK.
   */
  public reachTo(target: Vector3): RoboticArmPose {
    const shoulder = new Vector3(0, 0, 0);
    // Initial chain: shoulder, mid-point guess for elbow, end
    const joints = [
      shoulder,
      new Vector3(this.upperArmLen, 0, 0),
      new Vector3(this.upperArmLen + this.forearmLen, 0, 0),
      new Vector3(this.upperArmLen + this.forearmLen + this.handLen, 0, 0),
    ];
    const boneLengths = [this.upperArmLen, this.forearmLen, this.handLen];

    const result = this.solver.solve(joints, boneLengths, target);

    this.lastPose = {
      shoulder: result.joints[0],
      elbow: result.joints[1],
      wrist: result.joints[2],
      solved: result.solved,
    };
    return this.lastPose;
  }

  /**
   * Returns the three joint world positions as an ordered toolpath array.
   * Useful for feeding directly into `GCodeGenerator` or `Canvitar.renderPath`.
   */
  public toCNCPath(): Vector3[] {
    return [this.lastPose.shoulder, this.lastPose.elbow, this.lastPose.wrist];
  }
}
