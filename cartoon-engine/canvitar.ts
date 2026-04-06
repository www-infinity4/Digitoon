/**
 * Canvitar — Dependency-Free 3D→2D Canvas Renderer
 *
 * Projects Vector3 scene geometry onto an HTML canvas with perspective or
 * orthographic projection.  Designed to run safely in Node.js test
 * environments: when constructed with `null` the canvas-context is never
 * accessed and all draw calls become no-ops.
 *
 * The DOM types (HTMLCanvasElement, CanvasRenderingContext2D) are intentionally
 * avoided in type annotations so this module compiles under tsconfig.engine.json
 * which omits the "dom" lib.  Duck-typed interfaces are used instead.
 *
 * Coordinate conventions
 * ─────────────────────────────────────────────────────────────────────────────
 *  World   X = right, Y = up, Z = toward viewer (right-handed)
 *  Screen  u = right, v = down from canvas centre
 *
 * Perspective model
 * ─────────────────────────────────────────────────────────────────────────────
 *  zoom = focalLength / (focalLength + z)
 *  u    = x × zoom + halfWidth
 *  v    = -y × zoom + halfHeight
 */

import { Vector3 } from './vector3';

// ─── Minimal duck-typed canvas interfaces ────────────────────────────────────
// We don't import DOM types; instead we define just what we need so the module
// compiles under both "dom" and "esnext"-only lib configurations.

interface CanvasLike {
  width: number;
  height: number;
  getContext(id: '2d'): CanvasCtxLike | null;
}

interface CanvasCtxLike {
  save(): void;
  restore(): void;
  beginPath(): void;
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
  stroke(): void;
  fillRect(x: number, y: number, w: number, h: number): void;
  fillText(text: string, x: number, y: number): void;
  clearRect(x: number, y: number, w: number, h: number): void;
  setLineDash(segments: number[]): void;
  strokeStyle: string;
  lineWidth: number;
  fillStyle: string;
  font: string;
}

// ─── Public Interfaces ────────────────────────────────────────────────────────

/** Perspective camera parameters. */
export interface CameraState {
  /** Distance from the eye to the projection plane (px).  Larger = less distortion. */
  focalLength: number;
  /** Horizontal canvas-centre offset (px). */
  offsetX: number;
  /** Vertical canvas-centre offset (px). */
  offsetY: number;
}

/** 2D projected screen coordinate (canvas centre as origin). */
export interface ScreenPoint {
  u: number;
  v: number;
}

/** Options for `renderPath`. */
export interface RenderPathOptions {
  color?: string;
  lineWidth?: number;
  /** Reduces focalLength to 100 for an 8-bit NES perspective feel. */
  retro?: boolean;
  dashed?: boolean;
}

/** Options for `renderHUD`. */
export interface HUDOptions {
  font?: string;
  color?: string;
  lineHeight?: number;
}

// ─── Default camera ───────────────────────────────────────────────────────────

const DEFAULT_CAMERA: CameraState = {
  focalLength: 400,
  offsetX: 0,
  offsetY: 0,
};

// ─── Canvitar ─────────────────────────────────────────────────────────────────

/**
 * 3D→2D renderer that wraps a canvas element.
 *
 * Pass `null` as the canvas argument to run in server / test mode where all
 * draw methods silently become no-ops.
 */
export class Canvitar {
  private readonly ctx: CanvasCtxLike | null;
  private readonly width: number;
  private readonly height: number;
  private readonly isServer: boolean;

  constructor(canvas: CanvasLike | null) {
    if (canvas === null) {
      this.ctx = null;
      this.width = 800;
      this.height = 600;
      this.isServer = true;
    } else {
      this.ctx = canvas.getContext('2d');
      this.width = canvas.width;
      this.height = canvas.height;
      this.isServer = false;
    }
  }

  // ── Projection ──────────────────────────────────────────────────────────────

  /**
   * Perspective projection using the pinhole camera model.
   *
   *   zoom = focalLength / (focalLength + v.z)
   *   u    = v.x × zoom + halfW + offsetX
   *   v    = −v.y × zoom + halfH + offsetY
   */
  public project(v: Vector3, camera: CameraState = DEFAULT_CAMERA): ScreenPoint {
    const fl = camera.focalLength;
    const zoom = fl / (fl + v.z);
    return {
      u: v.x * zoom + this.width * 0.5 + camera.offsetX,
      v: -v.y * zoom + this.height * 0.5 + camera.offsetY,
    };
  }

  /**
   * Orthographic (parallel) projection — no perspective distortion.
   * Z depth is ignored for screen position (but preserved for sorting).
   */
  public projectOrthographic(v: Vector3): ScreenPoint {
    return {
      u: v.x + this.width * 0.5,
      v: -v.y + this.height * 0.5,
    };
  }

  // ── Draw calls ──────────────────────────────────────────────────────────────

  /**
   * Stroke a polyline of 3D points projected onto the canvas.
   *
   * @param path   Ordered list of 3D vertices.
   * @param opts   Visual options — color, lineWidth, retro, dashed.
   */
  public renderPath(path: Vector3[], opts: RenderPathOptions = {}): void {
    if (!this.ctx || this.isServer || path.length < 2) return;

    const camera: CameraState = {
      ...DEFAULT_CAMERA,
      focalLength: opts.retro ? 100 : DEFAULT_CAMERA.focalLength,
    };

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = opts.color ?? '#00ff41';
    ctx.lineWidth = opts.lineWidth ?? 1.5;
    if (opts.dashed) ctx.setLineDash([6, 3]);

    ctx.beginPath();
    const first = this.project(path[0], camera);
    ctx.moveTo(first.u, first.v);
    for (let i = 1; i < path.length; i++) {
      const pt = this.project(path[i], camera);
      ctx.lineTo(pt.u, pt.v);
    }
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Draw a wireframe mesh from triangle faces.
   * Faces are painter-sorted (back-to-front) by average Z so closer
   * triangles appear on top.
   *
   * @param faces  Array of triangles, each given as three Vector3 vertices.
   * @param opts   Same visual options as `renderPath`.
   */
  public renderWireframe(
    faces: [Vector3, Vector3, Vector3][],
    opts: RenderPathOptions = {}
  ): void {
    if (!this.ctx || this.isServer || faces.length === 0) return;

    // Painter sort: draw far faces first
    const sorted = [...faces].sort((a, b) => {
      const avgA = (a[0].z + a[1].z + a[2].z) / 3;
      const avgB = (b[0].z + b[1].z + b[2].z) / 3;
      return avgA - avgB; // ascending: back drawn first
    });

    const camera: CameraState = {
      ...DEFAULT_CAMERA,
      focalLength: opts.retro ? 100 : DEFAULT_CAMERA.focalLength,
    };

    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = opts.color ?? '#ffffff';
    ctx.lineWidth = opts.lineWidth ?? 1;
    if (opts.dashed) ctx.setLineDash([4, 2]);

    for (const [a, b, c] of sorted) {
      const pa = this.project(a, camera);
      const pb = this.project(b, camera);
      const pc = this.project(c, camera);
      ctx.beginPath();
      ctx.moveTo(pa.u, pa.v);
      ctx.lineTo(pb.u, pb.v);
      ctx.lineTo(pc.u, pc.v);
      ctx.closePath();
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * Render a monospaced text overlay in the top-left corner.
   *
   * @param lines  Lines of text to display.
   * @param opts   Font, color, lineHeight.
   */
  public renderHUD(lines: string[], opts: HUDOptions = {}): void {
    if (!this.ctx || this.isServer || lines.length === 0) return;

    const ctx = this.ctx;
    ctx.save();
    ctx.font = opts.font ?? '14px monospace';
    ctx.fillStyle = opts.color ?? '#00ff41';
    const lh = opts.lineHeight ?? 18;

    lines.forEach((line, i) => {
      ctx.fillText(line, 10, 20 + i * lh);
    });
    ctx.restore();
  }

  /**
   * Clear the canvas.  If `fillStyle` is provided, flood-fills with that colour.
   */
  public clear(fillStyle?: string): void {
    if (!this.ctx || this.isServer) return;
    if (fillStyle) {
      this.ctx.fillStyle = fillStyle;
      this.ctx.fillRect(0, 0, this.width, this.height);
    } else {
      this.ctx.clearRect(0, 0, this.width, this.height);
    }
  }
}

// ─── Pure geometry generators ─────────────────────────────────────────────────

/**
 * Generate a 3D helix suitable for visualising 3D-printer screw paths.
 *
 * Parametric form:
 *   x = radius × cos(2π × t × turns)
 *   y = radius × sin(2π × t × turns)
 *   z = pitch × t × turns
 *
 * @param turns   Number of full revolutions.
 * @param radius  Helix radius (mm or scene units).
 * @param pitch   Axial advance per full revolution.
 * @param steps   Sample count (default 64 per turn).
 */
export function createHelixPath(
  turns: number,
  radius: number,
  pitch: number,
  steps: number = 64
): Vector3[] {
  const totalSteps = Math.max(2, Math.round(steps * turns));
  const path: Vector3[] = [];
  for (let i = 0; i <= totalSteps; i++) {
    const t = i / totalSteps;
    const angle = 2 * Math.PI * turns * t;
    path.push(new Vector3(
      radius * Math.cos(angle),
      radius * Math.sin(angle),
      pitch * turns * t
    ));
  }
  return path;
}

/**
 * Generate a symmetric V-shape in the XY plane (z = 0).
 *
 * The two arms extend from the origin at ±(angle_deg / 2) from the +Y axis.
 *
 * @param angle_deg  Opening angle of the V (degrees).
 * @param armLength  Length of each arm.
 */
export function createVShapePath(angle_deg: number, armLength: number): Vector3[] {
  const half = (angle_deg / 2) * (Math.PI / 180);
  const leftTip  = new Vector3(-Math.sin(half) * armLength,  Math.cos(half) * armLength, 0);
  const rightTip = new Vector3( Math.sin(half) * armLength,  Math.cos(half) * armLength, 0);
  // left arm → apex → right arm
  return [leftTip, new Vector3(0, 0, 0), rightTip];
}
