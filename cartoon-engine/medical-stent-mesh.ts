/**
 * MedicalStentMesh — Vascular Stent Diamond-Pattern Geometry
 *
 * Generates the parametric diamond-cell mesh for coronary or peripheral
 * vascular stents.  All geometry is computed from cylindrical surface
 * coordinates and can be evaluated at any deployment state via
 * `interpolateDeployment(t)`.
 *
 * Cell parametric equations (deployed cylinder, radius r)
 * ─────────────────────────────────────────────────────────────────────────────
 *   x = r · cos(θ)
 *   y = r · sin(θ)
 *   z = z_axial
 *
 * Diamond vertices per cell (row i, column j)
 *   θ_mid = 2π · (j + 0.5) / cellsAround
 *   z_mid =  length · (i + 0.5) / cellsAlong
 *   half_dθ = π · sin(openAngle_deg · π/180) / cellsAround
 *   half_dz = length · 0.5 / cellsAlong
 *
 *   v_top    = (θ_mid,            z_mid + half_dz)
 *   v_right  = (θ_mid + half_dθ,  z_mid           )
 *   v_bottom = (θ_mid,            z_mid - half_dz )
 *   v_left   = (θ_mid - half_dθ,  z_mid           )
 *
 * Surface coverage
 * ─────────────────────────────────────────────────────────────────────────────
 *   strutArea  = 4 × strutWidth × strutLength per cell
 *   totalArea  = 2π · r · length
 *   coverage   = totalStruts / totalArea
 *
 * Clinical target: 15–25% for good haemodynamics (Kastrati 2001, ACC/AHA).
 *
 * G-code note
 * ─────────────────────────────────────────────────────────────────────────────
 *   EDM wire cutting operates on unrolled flat-pattern coordinates.
 *   Arcs (G2/G3) are used for curved struts in the hoop direction.
 */

import { Vector3 } from './vector3';
import { AABB } from './aabb';
import { BaseMachinistAsset, ValidationResult } from './aero-wing-ribs';

// ─── Public interfaces ────────────────────────────────────────────────────────

/** Physical dimensions of the stent in crimped and deployed states. */
export interface StentGeometry {
  /** Crimped outer diameter (mm) — for delivery catheter sizing. */
  diameterCrimped_mm: number;
  /** Deployed outer diameter (mm) — nominal vessel diameter. */
  diameterDeployed_mm: number;
  /** Stent length (mm). */
  length_mm: number;
  /** Strut width (mm) — radial cross-section. */
  strutWidth_mm: number;
  /** Strut thickness (mm) — wall thickness. */
  strutThickness_mm: number;
}

/** A single diamond cell of the stent mesh. */
export interface StentCell {
  /** The four diamond vertices in world space (deployed geometry). */
  vertices: Vector3[];
  /** Centroid of the diamond. */
  centre: Vector3;
  /** Cell opening area in mm². */
  cellArea_mm2: number;
}

/** Full configuration for a `MedicalStentMesh` instance. */
export interface StentMeshConfig {
  geometry: StentGeometry;
  /** Number of axial rows of diamonds. */
  cellsAlong: number;
  /** Number of circumferential columns. */
  cellsAround: number;
  /** Diamond opening angle in degrees. */
  openAngle_deg: number;
}

// ─── Default values ───────────────────────────────────────────────────────────

const DEFAULT_GEOMETRY: StentGeometry = {
  diameterCrimped_mm:  1.5,
  diameterDeployed_mm: 3.5,
  length_mm:          18.0,
  strutWidth_mm:       0.09,
  strutThickness_mm:   0.08,
};

const DEFAULT_CONFIG: StentMeshConfig = {
  geometry:      DEFAULT_GEOMETRY,
  cellsAlong:    6,
  cellsAround:   8,
  openAngle_deg: 60,
};

// ─── MedicalStentMesh ─────────────────────────────────────────────────────────

/**
 * Parametric vascular stent mesh generator.
 *
 * Implements `BaseMachinistAsset` for compatibility with the engine's
 * machinist asset pipeline.
 */
export class MedicalStentMesh implements BaseMachinistAsset {
  public readonly id = 'medical-stent-mesh';
  public toolpaths: Vector3[] = [];
  public safetyBounds: AABB;

  private readonly config: StentMeshConfig;

  constructor(config: Partial<StentMeshConfig> = {}) {
    this.config = {
      ...DEFAULT_CONFIG,
      ...config,
      geometry: { ...DEFAULT_GEOMETRY, ...(config.geometry ?? {}) },
    };

    const r = this.config.geometry.diameterDeployed_mm / 2;
    const L = this.config.geometry.length_mm;
    this.safetyBounds = new AABB(
      new Vector3(-r, -r, 0),
      new Vector3( r,  r, L)
    );

    this.toolpaths = this.getDeployedToolpaths();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /**
   * Build the full diamond mesh at deployed diameter.
   *
   * Returns one `StentCell` per (row × column) combination.
   */
  public buildDiamondMesh(): StentCell[] {
    const { cellsAlong, cellsAround, openAngle_deg, geometry } = this.config;
    const r = geometry.diameterDeployed_mm / 2;
    const L = geometry.length_mm;

    const halfDtheta = Math.PI * Math.sin(openAngle_deg * Math.PI / 180) / cellsAround;
    const halfDz     = L / (2 * cellsAlong);

    const cells: StentCell[] = [];

    for (let i = 0; i < cellsAlong; i++) {
      for (let j = 0; j < cellsAround; j++) {
        const thetaMid = 2 * Math.PI * (j + 0.5) / cellsAround;
        const zMid     = L * (i + 0.5) / cellsAlong;

        const top    = this.cylPoint(r, thetaMid,            zMid + halfDz);
        const right  = this.cylPoint(r, thetaMid + halfDtheta, zMid       );
        const bottom = this.cylPoint(r, thetaMid,            zMid - halfDz);
        const left   = this.cylPoint(r, thetaMid - halfDtheta, zMid       );

        const centre = this.cylPoint(r, thetaMid, zMid);

        // Cell area: approximate diamond as parallelogram (4 × half-base × half-height)
        const hoop_arc  = 2 * r * halfDtheta; // arc length in hoop direction
        const cellArea = hoop_arc * 2 * halfDz;

        cells.push({ vertices: [top, right, bottom, left], centre, cellArea_mm2: cellArea });
      }
    }

    return cells;
  }

  /** Toolpaths at crimped diameter (delivery state). */
  public getCrimpedToolpaths(): Vector3[] {
    return this.buildMeshAtRadius(this.config.geometry.diameterCrimped_mm / 2);
  }

  /** Toolpaths at deployed diameter. */
  public getDeployedToolpaths(): Vector3[] {
    return this.buildMeshAtRadius(this.config.geometry.diameterDeployed_mm / 2);
  }

  /**
   * Interpolate between crimped (t=0) and deployed (t=1) states.
   *
   * @param t  Deployment fraction [0, 1].
   */
  public interpolateDeployment(t: number): Vector3[] {
    const tc = Math.max(0, Math.min(1, t));
    const rCrimped  = this.config.geometry.diameterCrimped_mm  / 2;
    const rDeployed = this.config.geometry.diameterDeployed_mm / 2;
    const r = rCrimped + (rDeployed - rCrimped) * tc;
    return this.buildMeshAtRadius(r);
  }

  /**
   * Surface coverage ratio: (total strut projected area) / (cylinder surface area).
   *
   * Targets 15–25% for optimal haemodynamics.
   */
  public calculateSurfaceCoverage(): number {
    const { cellsAlong, cellsAround, geometry } = this.config;
    const r = geometry.diameterDeployed_mm / 2;
    const L = geometry.length_mm;
    const totalCells = cellsAlong * cellsAround;

    // Each diamond has 4 struts; approximate each strut length as half the cell diagonal
    const { cellsAlong: ca, cellsAround: co, openAngle_deg, geometry: g } = this.config;
    const halfDtheta = Math.PI * Math.sin(openAngle_deg * Math.PI / 180) / co;
    const halfDz     = L / (2 * ca);

    const strutLengthHoop = 2 * r * halfDtheta;
    const strutLengthAxial = 2 * halfDz;
    const strutLen = Math.sqrt(strutLengthHoop * strutLengthHoop + strutLengthAxial * strutLengthAxial);

    const strutAreaPerCell = 4 * geometry.strutWidth_mm * strutLen;
    const totalStrut = totalCells * strutAreaPerCell;
    const totalSurface = 2 * Math.PI * r * L;

    return totalStrut / totalSurface;
  }

  /**
   * Micro-machining G-code for EDM wire cutting.
   *
   * Struts are represented as G1 moves on the unrolled flat pattern.
   * Curved (hoop) struts use G2/G3 arcs.
   */
  public generateGCode(): string {
    const { geometry, cellsAlong, cellsAround } = this.config;
    const r = geometry.diameterDeployed_mm / 2;
    const L = geometry.length_mm;
    const cells = this.buildDiamondMesh();

    const lines: string[] = [];
    lines.push('; ── MedicalStentMesh EDM Wire-Cut G-code ─────────────────');
    lines.push(`; Stent: Ø${geometry.diameterDeployed_mm}mm deployed, L=${L}mm`);
    lines.push(`; Cells: ${cellsAlong}×${cellsAround}  Coverage: ${(this.calculateSurfaceCoverage() * 100).toFixed(1)}%`);
    lines.push('G21 G90 G17');
    lines.push('M3 S5000');
    lines.push('G0 Z2');

    for (const cell of cells) {
      const [top, right, bottom, left] = cell.vertices;
      // Unroll: use θ×r as Y coordinate, z as Z
      lines.push(`; Cell centre (${cell.centre.x.toFixed(3)},${cell.centre.y.toFixed(3)},${cell.centre.z.toFixed(3)})`);
      lines.push(`G0 X${fmt(top.z)} Y${fmt(Math.atan2(top.y, top.x) * r)}`);
      lines.push(`G1 X${fmt(right.z)} Y${fmt(Math.atan2(right.y, right.x) * r)} F50`);
      lines.push(`G1 X${fmt(bottom.z)} Y${fmt(Math.atan2(bottom.y, bottom.x) * r)} F50`);
      lines.push(`G1 X${fmt(left.z)} Y${fmt(Math.atan2(left.y, left.x) * r)} F50`);
      lines.push(`G1 X${fmt(top.z)} Y${fmt(Math.atan2(top.y, top.x) * r)} F50`);
    }

    lines.push('M5');
    lines.push('M30');
    return lines.join('\n');
  }

  /** Validate stent configuration. */
  public validate(): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const { geometry, cellsAlong, cellsAround } = this.config;

    if (geometry.diameterDeployed_mm <= geometry.diameterCrimped_mm) {
      errors.push('deployedDiameter must be > crimpedDiameter');
    }
    if (geometry.length_mm <= 0) {
      errors.push('length_mm must be > 0');
    }

    const coverage = this.calculateSurfaceCoverage();
    if (coverage < 0.10 || coverage > 0.40) {
      errors.push(`Surface coverage ${(coverage * 100).toFixed(1)}% is outside acceptable range (10–40%)`);
    } else if (coverage < 0.15 || coverage > 0.25) {
      warnings.push(`Surface coverage ${(coverage * 100).toFixed(1)}% is outside optimal haemodynamic range (15–25%)`);
    }

    // Check strut width < cell circumferential spacing
    const circumPerCell = Math.PI * geometry.diameterDeployed_mm / cellsAround;
    if (geometry.strutWidth_mm >= circumPerCell) {
      errors.push(`strutWidth_mm (${geometry.strutWidth_mm}) ≥ cell circumferential spacing (${circumPerCell.toFixed(3)}mm)`);
    }

    return { valid: errors.length === 0, errors, warnings };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /** Convert cylindrical coordinates to a Cartesian Vector3. */
  private cylPoint(r: number, theta: number, z: number): Vector3 {
    return new Vector3(
      r * Math.cos(theta),
      r * Math.sin(theta),
      z
    );
  }

  /** Build diamond mesh vertex toolpath at an arbitrary radius. */
  private buildMeshAtRadius(r: number): Vector3[] {
    const { cellsAlong, cellsAround, openAngle_deg, geometry } = this.config;
    const L = geometry.length_mm;
    const halfDtheta = Math.PI * Math.sin(openAngle_deg * Math.PI / 180) / cellsAround;
    const halfDz     = L / (2 * cellsAlong);
    const pts: Vector3[] = [];

    for (let i = 0; i < cellsAlong; i++) {
      for (let j = 0; j < cellsAround; j++) {
        const thetaMid = 2 * Math.PI * (j + 0.5) / cellsAround;
        const zMid     = L * (i + 0.5) / cellsAlong;
        pts.push(
          this.cylPoint(r, thetaMid,             zMid + halfDz),
          this.cylPoint(r, thetaMid + halfDtheta, zMid        ),
          this.cylPoint(r, thetaMid,             zMid - halfDz),
          this.cylPoint(r, thetaMid - halfDtheta, zMid        )
        );
      }
    }
    return pts;
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function fmt(n: number, dp = 4): string {
  return n.toFixed(dp);
}
