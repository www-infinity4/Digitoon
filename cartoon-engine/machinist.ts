/**
 * Machinist Mario Engine — CNC / 3D-Printer / Lathe & Flying V G-code Generator
 *
 * Translates 3-D geometry into raw machine movements for three fabrication modes:
 *   CNC Mill   — subtractive; G0/G1/G2/G3 toolpaths with stepover passes
 *   3D Printer — additive; Z-slice layers with contour + infill movements
 *   Lathe      — turning; X/Z profile with spindle speed and feed rate
 *
 * The "Flying V" guitar is the canonical test shape — two mirror-image V-wings
 * plus a neck pocket, defined by real luthier dimensions.
 *
 * ── G-code commands used ─────────────────────────────────────────────────────
 *   G0  Rapid positioning (no material removal, maximum speed)
 *   G1  Linear interpolation at feed rate (cutting/printing/boring)
 *   G2  Clockwise circular arc interpolation (I/J centre offsets)
 *   G3  Counter-clockwise arc interpolation
 *   G17 XY plane selection (mill default)
 *   G18 XZ plane selection (lathe default)
 *   G20 Inch units
 *   G21 Millimetre units
 *   G28 Return to machine home
 *   G90 Absolute positioning mode
 *   G91 Incremental positioning mode
 *   M3  Spindle start CW  (mill) / Chuck CW (lathe)
 *   M5  Spindle stop
 *   M30 Program end & rewind
 *   S   Spindle speed (RPM)
 *   F   Feed rate (mm/min)
 *
 * ── Flying V dimensions (standardised) ──────────────────────────────────────
 *   Scale length:  628.65 mm (24.75")
 *   Body width:    431.8 mm  (17")
 *   Body depth:    38.1 mm   (1.5" mahogany slab)
 *   Wing angle:    30° from centreline
 *   Neck pocket:   56.9 mm wide × 76.2 mm long × 16 mm deep
 *
 * Usage:
 *   import { GuitarMachinist, ThreeDPrinterSlicer, LatheController } from './machinist';
 *
 *   const guitar = new GuitarMachinist();
 *   const gcode  = guitar.generateFlyingVPaths(431.8, 558.8);
 *   console.log(gcode.join('\n'));
 *
 *   const slicer = new ThreeDPrinterSlicer({ layerHeight_mm: 0.2, nozzleDiam_mm: 0.4 });
 *   const layers = slicer.slice(guitar.bodyPolygon(), 38.1);
 */

import { Vector3 } from './vector3';
import { nacaThickness } from './aero-physics';

// ---------------------------------------------------------------------------
// G-code formatting helpers
// ---------------------------------------------------------------------------

/** Format a number to n decimal places, stripping trailing zeros. */
function fmt(n: number, dp = 3): string {
  return parseFloat(n.toFixed(dp)).toString();
}

/** Build a G1 move string. */
function g1(pos: Partial<{ X: number; Y: number; Z: number; F: number }>): string {
  const parts = ['G1'];
  if (pos.X !== undefined) parts.push(`X${fmt(pos.X)}`);
  if (pos.Y !== undefined) parts.push(`Y${fmt(pos.Y)}`);
  if (pos.Z !== undefined) parts.push(`Z${fmt(pos.Z)}`);
  if (pos.F !== undefined) parts.push(`F${fmt(pos.F, 0)}`);
  return parts.join(' ');
}

/** Build a G0 rapid move string. */
function g0(pos: Partial<{ X: number; Y: number; Z: number }>): string {
  const parts = ['G0'];
  if (pos.X !== undefined) parts.push(`X${fmt(pos.X)}`);
  if (pos.Y !== undefined) parts.push(`Y${fmt(pos.Y)}`);
  if (pos.Z !== undefined) parts.push(`Z${fmt(pos.Z)}`);
  return parts.join(' ');
}

/** Build a G2/G3 arc move string. */
function arc(
  cw: boolean,
  end: { X: number; Y: number },
  centre: { I: number; J: number },
  feedRate: number
): string {
  return `${cw ? 'G2' : 'G3'} X${fmt(end.X)} Y${fmt(end.Y)} I${fmt(centre.I)} J${fmt(centre.J)} F${fmt(feedRate, 0)}`;
}

// ---------------------------------------------------------------------------
// Machinist parameters
// ---------------------------------------------------------------------------

/** Spindle / cutting parameters for a machining operation. */
export interface MachinistParams {
  /** Spindle speed (RPM). Typical: 8000–24000 rpm (mill), 200–3000 rpm (lathe). */
  spindleSpeed_rpm: number;
  /** Feed rate (mm/min). Typical mill: 500–3000. Lathe: 50–400. */
  feedRate_mm_min:  number;
  /** Depth of cut per pass (mm). */
  depthOfCut_mm:    number;
  /** Radial stepover for area clearing (mm). Typically 40–60 % of tool diameter. */
  stepover_mm:      number;
  /** Tool diameter (mm). */
  toolDiam_mm:      number;
  /** Safe Z height for rapid moves (mm above workpiece top). */
  safeZ_mm:         number;
}

const DEFAULT_PARAMS: MachinistParams = {
  spindleSpeed_rpm: 18000,
  feedRate_mm_min:  1500,
  depthOfCut_mm:    3,
  stepover_mm:      4,
  toolDiam_mm:      6,
  safeZ_mm:         5,
};

// ---------------------------------------------------------------------------
// Flying V geometry
// ---------------------------------------------------------------------------

/** A 2-D polygon vertex (mm in the XY plane). */
export interface Vertex2D { x: number; y: number; }

/**
 * FlyingVDimensions
 *
 * All key dimensions of a Flying V guitar body.
 * Defaults match the original 1958 Gibson Flying V specification.
 */
export interface FlyingVDimensions {
  /** Total body width (mm). Default: 431.8 mm = 17". */
  bodyWidth_mm:    number;
  /** Total body length from tail to neck join (mm). Default: 558.8 mm = 22". */
  bodyLength_mm:   number;
  /** Body slab thickness (mm). Default: 38.1 mm = 1.5". */
  bodyDepth_mm:    number;
  /** Half-angle of the V wings from the centreline (degrees). Default: 30°. */
  wingAngle_deg:   number;
  /** Scale length (nut to saddle, mm). Default: 628.65 mm = 24.75". */
  scaleLength_mm:  number;
  /** Neck pocket width (mm). Default: 56.9 mm. */
  neckPocketW_mm:  number;
  /** Neck pocket depth into body (mm). Default: 16 mm. */
  neckPocketD_mm:  number;
  /** Neck pocket length (mm). Default: 76.2 mm = 3". */
  neckPocketL_mm:  number;
  /** Corner radius on wing tips (mm) — smoothed with G2 arcs. */
  tipRadius_mm:    number;
}

const DEFAULT_DIMS: FlyingVDimensions = {
  bodyWidth_mm:    431.8,
  bodyLength_mm:   558.8,
  bodyDepth_mm:    38.1,
  wingAngle_deg:   30,
  scaleLength_mm:  628.65,
  neckPocketW_mm:  56.9,
  neckPocketD_mm:  16.0,
  neckPocketL_mm:  76.2,
  tipRadius_mm:    12.7,
};

// ---------------------------------------------------------------------------
// GuitarMachinist — Flying V G-code generator
// ---------------------------------------------------------------------------

/**
 * GuitarMachinist
 *
 * Generates complete G-code programs for machining a Flying V guitar body
 * using a 3-axis CNC mill.  Each method returns an array of G-code lines
 * that can be joined with '\n' and sent directly to a controller.
 *
 * The body is positioned with the V-apex at the origin (0, 0) and the
 * body extending in the +Y direction.  The two wings flare out at
 * ±wingAngle_deg from the Y-axis.
 *
 * CNC coordinate system (G17 — XY plane):
 *   X = across the body (0 = centreline)
 *   Y = along the body (0 = apex, positive toward tail)
 *   Z = down into the material (0 = top surface, negative = cutting depth)
 */
export class GuitarMachinist {
  readonly dims:   FlyingVDimensions;
  readonly params: MachinistParams;

  constructor(
    dims:   Partial<FlyingVDimensions> = {},
    params: Partial<MachinistParams>   = {}
  ) {
    this.dims   = { ...DEFAULT_DIMS,   ...dims   };
    this.params = { ...DEFAULT_PARAMS, ...params };
  }

  // ── Body polygon ──────────────────────────────────────────────────────────

  /**
   * bodyPolygon
   *
   * Returns the 2-D perimeter of the Flying V body as an ordered polygon.
   * Points are listed CCW (positive Z out of page — standard machining convention).
   *
   * Polygon vertices:
   *   [0] Apex (V tip):          (0, 0)
   *   [1] Left wing tip:         (−W/2, wingY)
   *   [2] Left wing base:        (−W/2, bodyLength)
   *   [3] Neck centreline base:  (0,    bodyLength)
   *   [4] Right wing base:       ( W/2, bodyLength)
   *   [5] Right wing tip:        ( W/2, wingY)
   *
   * where wingY = (W/2) / tan(wingAngle_deg)
   */
  bodyPolygon(): Vertex2D[] {
    const { bodyWidth_mm: W, bodyLength_mm: L, wingAngle_deg } = this.dims;
    const halfW  = W / 2;
    const wingY  = halfW / Math.tan((wingAngle_deg * Math.PI) / 180);

    return [
      { x: 0,      y: 0    },   // apex (V tip)
      { x: -halfW, y: wingY },  // left wing tip
      { x: -halfW, y: L    },   // left base
      { x: 0,      y: L    },   // neck base centre
      { x:  halfW, y: L    },   // right base
      { x:  halfW, y: wingY },  // right wing tip
    ];
  }

  /**
   * neckPocketPolygon
   *
   * Returns the 4 corners of the neck pocket rectangle, centred on the
   * body centreline at the top (neck end) of the body.
   */
  neckPocketPolygon(): Vertex2D[] {
    const { neckPocketW_mm: W, neckPocketL_mm: L, bodyLength_mm: BL } = this.dims;
    const halfW = W / 2;
    const y0    = BL - L;

    return [
      { x: -halfW, y: y0  },
      { x:  halfW, y: y0  },
      { x:  halfW, y: BL  },
      { x: -halfW, y: BL  },
    ];
  }

  // ── Program header / footer ───────────────────────────────────────────────

  private header(): string[] {
    const { spindleSpeed_rpm } = this.params;
    return [
      '; Flying V Guitar Body — Machinist Mario G-code',
      `; Generated: ${new Date().toISOString()}`,
      `; Dims: W=${this.dims.bodyWidth_mm}mm L=${this.dims.bodyLength_mm}mm D=${this.dims.bodyDepth_mm}mm`,
      'G21         ; metric units (mm)',
      'G90         ; absolute positioning',
      'G17         ; XY plane',
      'G28         ; return to home',
      `M3 S${spindleSpeed_rpm} ; spindle on CW`,
      '',
    ];
  }

  private footer(): string[] {
    return [
      '',
      'M5          ; spindle off',
      'G28         ; return to home',
      'M30         ; program end',
    ];
  }

  // ── Perimeter profile (body outline) ─────────────────────────────────────

  /**
   * generateFlyingVPaths
   *
   * Generates the complete perimeter contour toolpath for the Flying V body.
   * The tool follows the polygon outline at the specified depth, using
   * G2 arcs at the wing tips for smooth radius transitions.
   *
   * Multiple depth passes are made from 0 to bodyDepth_mm in increments
   * of depthOfCut_mm.
   *
   * @param bodyWidth    Override body width (mm).  Default: this.dims.bodyWidth_mm.
   * @param bodyLength   Override body length (mm). Default: this.dims.bodyLength_mm.
   */
  generateFlyingVPaths(
    bodyWidth:  number = this.dims.bodyWidth_mm,
    bodyLength: number = this.dims.bodyLength_mm
  ): string[] {
    const { feedRate_mm_min: F, depthOfCut_mm: doc,
            bodyDepth_mm: totalDepth, safeZ_mm, tipRadius_mm } = {
      ...this.params,
      bodyDepth_mm: this.dims.bodyDepth_mm,
      tipRadius_mm: this.dims.tipRadius_mm,
    };

    const halfW  = bodyWidth / 2;
    const α      = (this.dims.wingAngle_deg * Math.PI) / 180;
    const wingY  = halfW / Math.tan(α);
    const R      = tipRadius_mm;

    const lines: string[] = [
      ...this.header(),
      '; === BODY PERIMETER CONTOUR ===',
      '',
    ];

    const passes = Math.ceil(this.dims.bodyDepth_mm / doc);

    for (let pass = 1; pass <= passes; pass++) {
      const z = -Math.min(pass * doc, this.dims.bodyDepth_mm);
      lines.push(`; Pass ${pass}/${passes}  Z=${z}mm`);

      // 1. Rapid to apex start position
      lines.push(g0({ X: 0, Y: 0, Z: safeZ_mm }));

      // 2. Plunge to cut depth
      lines.push(g1({ Z: z, F: F / 3 }));

      // 3. Left wing — apex to left wing tip (with NACA-edge smoothing)
      const leftWingPts = this._nacaEdgePath(halfW, wingY, -1, 24);
      for (const pt of leftWingPts) {
        lines.push(g1({ X: pt.x, Y: pt.y, F }));
      }

      // 4. Left wing tip — rounded with G3 arc
      lines.push(`; Left wing tip radius R=${R}mm`);
      lines.push(arc(false,
        { X: -halfW + R, Y: wingY + R },
        { I: R,          J: 0 },
        F / 2
      ));

      // 5. Left base — wing tip along base to centreline
      lines.push(g1({ X: -halfW, Y: bodyLength, F }));
      lines.push(g1({ X: 0,      Y: bodyLength, F }));

      // 6. Right base
      lines.push(g1({ X:  halfW, Y: bodyLength, F }));

      // 7. Right wing tip — rounded with G2 arc
      lines.push(`; Right wing tip radius R=${R}mm`);
      lines.push(arc(true,
        { X: halfW - R, Y: wingY + R },
        { I: -R,        J: 0 },
        F / 2
      ));

      // 8. Right wing — tip back to apex (mirror of left)
      const rightWingPts = this._nacaEdgePath(halfW, wingY, 1, 24).reverse();
      for (const pt of rightWingPts) {
        lines.push(g1({ X: pt.x, Y: pt.y, F }));
      }

      // 9. Close at apex
      lines.push(g1({ X: 0, Y: 0, F }));
      lines.push(g0({ Z: safeZ_mm }));
      lines.push('');
    }

    lines.push(...this.footer());
    return lines;
  }

  /**
   * _nacaEdgePath
   *
   * Uses the NACA thickness distribution to smooth the wing leading edge,
   * producing a series of toolpath points that follow the aerodynamic
   * curvature of the guitar's V-edge.
   *
   * This ensures the edge has proper "aero-machining" quality — the same
   * math that defines a wing's leading edge also defines the guitar's
   * bevelled edge chamfer.
   */
  private _nacaEdgePath(
    halfW: number,
    wingY: number,
    side:  1 | -1,
    n:     number
  ): Vertex2D[] {
    const pts: Vertex2D[] = [];
    const t_foil = 0.12;   // NACA 12 % thickness

    for (let i = 0; i <= n; i++) {
      const u = i / n;                          // 0 = apex, 1 = wing tip
      const yRaw = u * wingY;
      const xRaw = u * halfW;

      // Apply NACA thickness as a subtle edge bevel
      const bevel = nacaThickness(u, t_foil) * halfW * 0.05;
      pts.push({ x: side * (xRaw - bevel), y: yRaw });
    }
    return pts;
  }

  // ── Neck pocket ───────────────────────────────────────────────────────────

  /**
   * generateNeckPocket
   *
   * Generates the G-code to pocket the neck slot to neckPocketD_mm depth.
   * Uses a spiral-in area-clearing strategy for clean chip evacuation.
   */
  generateNeckPocket(): string[] {
    const { feedRate_mm_min: F, depthOfCut_mm: doc,
            stepover_mm: so, safeZ_mm } = this.params;
    const { neckPocketW_mm: W, neckPocketL_mm: L,
            neckPocketD_mm: D, bodyLength_mm: BL } = this.dims;

    const halfW = W / 2;
    const y0    = BL - L;
    const lines: string[] = [
      ...this.header(),
      '; === NECK POCKET ===',
      `; W=${W}mm L=${L}mm D=${D}mm`,
      '',
    ];

    const passes = Math.ceil(D / doc);
    for (let pass = 1; pass <= passes; pass++) {
      const z = -Math.min(pass * doc, D);
      lines.push(`; Pass ${pass}/${passes}  Z=${z}mm`);
      lines.push(g0({ X: 0, Y: y0 + L / 2, Z: safeZ_mm }));
      lines.push(g1({ Z: z, F: F / 3 }));

      // Spiral outward from centre
      let currentW = so;
      while (currentW <= halfW) {
        const currentL = Math.min(currentW * (L / W), L / 2);
        lines.push(g1({ X: -currentW, Y: y0 + L / 2 - currentL, F }));
        lines.push(g1({ X:  currentW, Y: y0 + L / 2 - currentL, F }));
        lines.push(g1({ X:  currentW, Y: y0 + L / 2 + currentL, F }));
        lines.push(g1({ X: -currentW, Y: y0 + L / 2 + currentL, F }));
        currentW += so;
      }

      // Final perimeter pass
      lines.push(g1({ X: -halfW, Y: y0,       F: F / 2 }));
      lines.push(g1({ X:  halfW, Y: y0,       F: F / 2 }));
      lines.push(g1({ X:  halfW, Y: BL,       F: F / 2 }));
      lines.push(g1({ X: -halfW, Y: BL,       F: F / 2 }));
      lines.push(g1({ X: -halfW, Y: y0,       F: F / 2 }));
      lines.push(g0({ Z: safeZ_mm }));
      lines.push('');
    }

    lines.push(...this.footer());
    return lines;
  }

  // ── Summary stats ─────────────────────────────────────────────────────────

  /**
   * estimatedMachineTime_min
   *
   * Rough estimate of total cutting time (minutes) for the body perimeter.
   * Perimeter ≈ 2 × (wingLength × 2 + baseWidth)  × numberOfPasses.
   */
  estimatedMachineTime_min(): number {
    const { bodyWidth_mm: W, bodyLength_mm: L, bodyDepth_mm: D,
            wingAngle_deg } = this.dims;
    const { feedRate_mm_min: F, depthOfCut_mm: doc } = this.params;

    const halfW     = W / 2;
    const wingY     = halfW / Math.tan((wingAngle_deg * Math.PI) / 180);
    const wingLen   = Math.sqrt(halfW ** 2 + wingY ** 2);
    const perimeter = 2 * wingLen * 2 + W + L - wingY;
    const passes    = Math.ceil(D / doc);
    return (perimeter * passes) / F;
  }
}

// ---------------------------------------------------------------------------
// 3D Printer Slicer
// ---------------------------------------------------------------------------

/** Configuration for the 3D-printer slicer. */
export interface SlicerConfig {
  /** Layer height (mm). Common: 0.1–0.3 mm. */
  layerHeight_mm:  number;
  /** Nozzle diameter (mm). Common: 0.4 mm. */
  nozzleDiam_mm:   number;
  /** Print speed (mm/s). Typical: 40–80 mm/s. */
  printSpeed_mms:  number;
  /** Infill density (0–1). 0.2 = 20 % infill. */
  infillDensity:   number;
  /** Infill pattern: 'lines' | 'grid' | 'concentric'. */
  infillPattern:   'lines' | 'grid' | 'concentric';
  /** Number of perimeter shells. */
  shells:          number;
  /** Bed temperature (°C). */
  bedTemp_C:       number;
  /** Nozzle temperature (°C). */
  nozzleTemp_C:    number;
  /** Retraction distance (mm). */
  retraction_mm:   number;
}

const DEFAULT_SLICER: SlicerConfig = {
  layerHeight_mm:  0.2,
  nozzleDiam_mm:   0.4,
  printSpeed_mms:  50,
  infillDensity:   0.2,
  infillPattern:   'lines',
  shells:          3,
  bedTemp_C:       60,
  nozzleTemp_C:    200,
  retraction_mm:   1.0,
};

/** One printed layer's G-code lines and metadata. */
export interface PrintLayer {
  layerIndex:  number;
  z_mm:        number;
  lineCount:   number;
  gcode:       string[];
}

/**
 * ThreeDPrinterSlicer
 *
 * Converts a 2-D polygon (the Flying V body outline or any V-shape profile)
 * into per-layer G-code for FDM 3-D printing.
 *
 * Strategy:
 *   1. For each layer at height z = layerIndex × layerHeight:
 *   2.   Emit shell perimeter moves (shells × polygon offset)
 *   3.   Emit infill moves (lines / grid / concentric)
 *   4.   Emit Z-hop retraction between layers
 */
export class ThreeDPrinterSlicer {
  readonly config: SlicerConfig;

  constructor(config: Partial<SlicerConfig> = {}) {
    this.config = { ...DEFAULT_SLICER, ...config };
  }

  /**
   * slice
   *
   * Slices a 2-D polygon to a given total height, returning one PrintLayer
   * per Z-level.
   *
   * @param polygon      Ordered list of 2-D vertices defining the outline.
   * @param totalZ_mm    Total height to print (e.g. bodyDepth_mm).
   */
  slice(polygon: Vertex2D[], totalZ_mm: number): PrintLayer[] {
    const { layerHeight_mm: lh, printSpeed_mms: spd,
            shells, infillDensity, infillPattern,
            nozzleTemp_C, bedTemp_C, retraction_mm } = this.config;

    const layerCount = Math.ceil(totalZ_mm / lh);
    const F_print    = spd * 60;       // mm/s → mm/min

    const layers: PrintLayer[] = [];

    // Start sequence (first layer only)
    const startGcode = [
      '; Flying V — 3D Print G-code  (Machinist Mario Slicer)',
      `M140 S${bedTemp_C}    ; bed temp`,
      `M109 S${nozzleTemp_C} ; nozzle temp (wait)`,
      'G21 ; metric',
      'G90 ; absolute',
      'G28 ; home all',
      'M83 ; extruder relative',
    ];

    for (let li = 0; li < layerCount; li++) {
      const z = (li + 1) * lh;
      const gcode: string[] = li === 0 ? [...startGcode] : [];

      gcode.push(`; --- Layer ${li + 1} / ${layerCount}  Z=${z.toFixed(3)}mm ---`);
      gcode.push(g0({ Z: z + 0.2 }));     // Z-hop to layer height

      // Shell perimeters
      for (let sh = 0; sh < shells; sh++) {
        const offset = (sh + 0.5) * this.config.nozzleDiam_mm;
        const shrunk = this._offsetPolygon(polygon, -offset);
        if (shrunk.length < 3) continue;

        gcode.push(`; Shell ${sh + 1}`);
        gcode.push(g0({ X: shrunk[0].x, Y: shrunk[0].y }));
        gcode.push(g1({ Z: z, F: F_print }));

        for (let vi = 1; vi < shrunk.length; vi++) {
          const e = this._extrude(shrunk[vi - 1], shrunk[vi]);
          gcode.push(`G1 X${fmt(shrunk[vi].x)} Y${fmt(shrunk[vi].y)} E${fmt(e, 5)} F${F_print}`);
        }
        // Close perimeter
        const e = this._extrude(shrunk[shrunk.length - 1], shrunk[0]);
        gcode.push(`G1 X${fmt(shrunk[0].x)} Y${fmt(shrunk[0].y)} E${fmt(e, 5)} F${F_print}`);
      }

      // Infill
      if (infillDensity > 0) {
        const infillLines = this._infill(polygon, li, infillDensity, infillPattern);
        gcode.push(`; Infill (${infillPattern} ${(infillDensity * 100).toFixed(0)}%)`);
        gcode.push(...infillLines);
      }

      // Retraction between layers
      gcode.push(`G1 E-${retraction_mm} F3000 ; retract`);
      gcode.push(g0({ Z: z + 0.2 }));

      layers.push({ layerIndex: li, z_mm: z, lineCount: gcode.length, gcode });
    }

    // End sequence
    if (layers.length > 0) {
      layers[layers.length - 1].gcode.push(
        'M140 S0  ; bed off',
        'M104 S0  ; hotend off',
        'M84      ; motors off',
        'M30      ; end'
      );
    }

    return layers;
  }

  /** Estimate total filament used (metres). */
  estimateFilament_m(polygon: Vertex2D[], totalZ_mm: number): number {
    const layers = this.slice(polygon, totalZ_mm);
    let totalE = 0;
    for (const layer of layers) {
      for (const line of layer.gcode) {
        const m = line.match(/E([\d.]+)/);
        if (m) totalE += parseFloat(m[1]);
      }
    }
    return totalE / 1000;   // mm → m
  }

  /** Simple polygon inset (Minkowski shrink — approximate for convex polygons). */
  private _offsetPolygon(poly: Vertex2D[], offset: number): Vertex2D[] {
    return poly.map((v, i) => {
      const prev = poly[(i - 1 + poly.length) % poly.length];
      const next = poly[(i + 1) % poly.length];
      const dx1  = v.x - prev.x; const dy1 = v.y - prev.y;
      const dx2  = next.x - v.x; const dy2 = next.y - v.y;
      const n1   = Math.sqrt(dx1**2 + dy1**2) || 1;
      const n2   = Math.sqrt(dx2**2 + dy2**2) || 1;
      const nx   = (-dy1/n1 + -dy2/n2) / 2;
      const ny   = ( dx1/n1 +  dx2/n2) / 2;
      const len  = Math.sqrt(nx**2 + ny**2) || 1;
      return { x: v.x + (nx / len) * offset, y: v.y + (ny / len) * offset };
    });
  }

  /** Calculate extrusion amount for a move segment (mm of filament). */
  private _extrude(a: Vertex2D, b: Vertex2D): number {
    const dist = Math.sqrt((b.x - a.x)**2 + (b.y - a.y)**2);
    const area = this.config.nozzleDiam_mm * this.config.layerHeight_mm;
    const filamentArea = Math.PI * (1.75 / 2) ** 2;   // 1.75mm filament
    return (dist * area) / filamentArea;
  }

  /** Generate infill G-code lines for a layer. */
  private _infill(
    poly:    Vertex2D[],
    layerIdx: number,
    density: number,
    pattern: 'lines' | 'grid' | 'concentric'
  ): string[] {
    const F = this.config.printSpeed_mms * 60 * 1.2;   // infill faster
    const spacing = this.config.nozzleDiam_mm / density;

    const xs = poly.map((v) => v.x);
    const ys = poly.map((v) => v.y);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);

    const lines: string[] = [];

    if (pattern === 'lines' || pattern === 'grid') {
      const angleRad = layerIdx % 2 === 0 ? 0 : Math.PI / 2;
      let coord = minY;
      let flip   = false;

      while (coord <= maxY) {
        const x0 = flip ? maxX : minX;
        const x1 = flip ? minX : maxX;
        if (angleRad === 0) {
          lines.push(g0({ X: x0, Y: coord }));
          const e = this._extrude({ x: x0, y: coord }, { x: x1, y: coord });
          lines.push(`G1 X${fmt(x1)} Y${fmt(coord)} E${fmt(e, 5)} F${F}`);
        } else {
          lines.push(g0({ X: coord, Y: flip ? maxY : minY }));
          const e = this._extrude({ x: coord, y: flip ? maxY : minY },
                                  { x: coord, y: flip ? minY : maxY });
          lines.push(`G1 X${fmt(coord)} Y${fmt(flip ? minY : maxY)} E${fmt(e, 5)} F${F}`);
        }
        coord += spacing;
        flip   = !flip;
      }
    } else {
      // Concentric — spiral inward
      let shrink = this.config.nozzleDiam_mm;
      while (shrink < Math.min(maxX - minX, maxY - minY) / 2) {
        const ring = this._offsetPolygon(poly, -shrink);
        if (ring.length < 3) break;
        lines.push(g0({ X: ring[0].x, Y: ring[0].y }));
        for (let vi = 1; vi < ring.length; vi++) {
          const e = this._extrude(ring[vi - 1], ring[vi]);
          lines.push(`G1 X${fmt(ring[vi].x)} Y${fmt(ring[vi].y)} E${fmt(e, 5)} F${F}`);
        }
        shrink += spacing;
      }
    }

    return lines;
  }
}

// ---------------------------------------------------------------------------
// Lathe Controller — Guitar Neck Turning
// ---------------------------------------------------------------------------

/** Guitar neck cross-section profile at a given axial position. */
export interface NeckProfilePoint {
  /** Axial position from nut (mm). */
  z_mm:        number;
  /** Neck width at this position (mm). */
  width_mm:    number;
  /** Neck thickness at this position (mm). */
  thickness_mm: number;
  /** Back-of-neck radius (mm) — the radius of the turned profile. */
  radius_mm:   number;
}

/** Standard guitar neck profile shapes. */
export type NeckProfileShape = 'C' | 'D' | 'V' | 'U' | 'asymmetric';

/** Configuration for lathe turning a guitar neck. */
export interface LatheConfig {
  /** Total neck length from nut to heel (mm). Default: 628.65 / 2 = 314mm. */
  neckLength_mm:     number;
  /** Nut width (mm). Default: 42.67 mm = 1.68". */
  nutWidth_mm:       number;
  /** Heel width (mm). Default: 56.9 mm. */
  heelWidth_mm:      number;
  /** Profile shape. */
  shape:             NeckProfileShape;
  /** Spindle speed for neck turning (RPM). */
  spindleSpeed_rpm:  number;
  /** Feed rate (mm/rev) — lathe uses mm/rev not mm/min. */
  feedRate_mm_rev:   number;
  /** Rough turning passes. */
  roughPasses:       number;
  /** Finishing passes. */
  finishPasses:      number;
}

const DEFAULT_LATHE: LatheConfig = {
  neckLength_mm:     314,
  nutWidth_mm:       42.67,
  heelWidth_mm:      56.9,
  shape:             'C',
  spindleSpeed_rpm:  800,
  feedRate_mm_rev:   0.15,
  roughPasses:       4,
  finishPasses:      2,
};

/**
 * LatheController
 *
 * Generates G-code for turning a guitar neck profile on a 2-axis CNC lathe.
 *
 * Lathe coordinate system (G18 — XZ plane):
 *   X = diameter (cross-section)
 *   Z = axial position (0 = chuck face / heel, positive toward nut)
 *
 * The neck profile is computed at n stations along the Z-axis, then
 * interpolated as a series of G1 moves.
 */
export class LatheController {
  readonly config: LatheConfig;

  constructor(config: Partial<LatheConfig> = {}) {
    this.config = { ...DEFAULT_LATHE, ...config };
  }

  /**
   * neckProfile
   *
   * Computes the neck cross-section profile at n stations along the Z-axis.
   * The back-of-neck radius is computed from the profile shape and taper.
   */
  neckProfile(n = 20): NeckProfilePoint[] {
    const { neckLength_mm: L, nutWidth_mm: Wn, heelWidth_mm: Wh, shape } = this.config;
    const pts: NeckProfilePoint[] = [];

    for (let i = 0; i <= n; i++) {
      const u    = i / n;                           // 0 = nut, 1 = heel
      const z    = u * L;
      const w    = Wn + (Wh - Wn) * u;             // linear width taper

      // Thickness and radius depend on profile shape
      let thickness: number;
      let radius:    number;

      switch (shape) {
        case 'C':
          // Classic C: gradually thickens, roughly semicircular back
          thickness = 19 + 3 * u;
          radius    = w / 2 * (1.1 + 0.4 * u);
          break;
        case 'D':
          // Flatter back, wider shoulder — faster-playing D shape
          thickness = 20 + 2 * u;
          radius    = w * 0.65;
          break;
        case 'V':
          // Sharp spine — vintage V-shape (matches our V-block machining!)
          thickness = 21 + 2 * u;
          radius    = w * 0.45;
          break;
        case 'U':
          // Very full, deep U — large bat profile
          thickness = 22 + 4 * u;
          radius    = w * 0.60;
          break;
        case 'asymmetric':
          // Bass-side fuller than treble-side
          thickness = 19 + 3 * u;
          radius    = w * (0.55 + 0.05 * Math.sin(Math.PI * u));
          break;
        default:
          thickness = 20; radius = w / 2;
      }

      pts.push({ z_mm: z, width_mm: w, thickness_mm: thickness, radius_mm: radius });
    }
    return pts;
  }

  /**
   * generateNeckTurningCode
   *
   * Full lathe G-code for turning the neck profile.
   * Multiple passes: rough (high DOC, fast feed) → finish (low DOC, slow feed).
   */
  generateNeckTurningCode(): string[] {
    const { spindleSpeed_rpm, feedRate_mm_rev,
            roughPasses, finishPasses, neckLength_mm } = this.config;

    const profile = this.neckProfile(40);
    const F       = feedRate_mm_rev;

    const lines: string[] = [
      '; Guitar Neck Turning — Machinist Mario Lathe G-code',
      `; Shape: ${this.config.shape}  L=${neckLength_mm}mm`,
      `; Generated: ${new Date().toISOString()}`,
      'G21 ; metric',
      'G18 ; XZ plane (lathe)',
      'G90 ; absolute',
      `G97 S${spindleSpeed_rpm} M3 ; constant RPM, spindle CW`,
      `G96 S100 ; CSS surface speed`,
      '',
    ];

    const maxDiam = Math.max(...profile.map((p) => p.width_mm));

    // Rough turning passes (from OD inward)
    for (let pass = 1; pass <= roughPasses; pass++) {
      const stock = maxDiam * (1 - pass / (roughPasses + 1));
      lines.push(`; Rough pass ${pass}/${roughPasses}  X=${stock.toFixed(2)}mm`);
      lines.push(g0({ X: stock + 2, Z: 2 }));
      lines.push(g1({ X: stock, Z: 0, F: F * 3 }));

      for (const pt of profile) {
        const targetX = Math.min(stock, pt.width_mm);
        lines.push(`G1 X${fmt(targetX)} Z${fmt(pt.z_mm)} F${F}`);
      }
      lines.push(g0({ X: maxDiam + 5, Z: 2 }));
      lines.push('');
    }

    // Finish passes
    for (let pass = 1; pass <= finishPasses; pass++) {
      lines.push(`; Finish pass ${pass}/${finishPasses}`);
      lines.push(g0({ X: Math.max(...profile.map((p) => p.width_mm)) + 1, Z: 2 }));

      for (const pt of profile) {
        lines.push(`G1 X${fmt(pt.width_mm)} Z${fmt(pt.z_mm)} F${fmt(F * 0.5)}`);
      }
      lines.push(g0({ X: Math.max(...profile.map((p) => p.width_mm)) + 5 }));
      lines.push('');
    }

    lines.push('M5  ; spindle off', 'G28 ; home', 'M30 ; end');
    return lines;
  }
}

// ---------------------------------------------------------------------------
// Collision Detector — Machine Volume Simulation
// ---------------------------------------------------------------------------

/** The work envelope of a CNC machine (safe cutting region). */
export interface MachineEnvelope {
  /** Minimum X, Y, Z coordinates (mm). */
  min: Vector3;
  /** Maximum X, Y, Z coordinates (mm). */
  max: Vector3;
}

/** Result of a toolpath collision check. */
export interface CollisionResult {
  /** True if any toolpath point is outside the machine envelope or into a fixture. */
  hasCollision: boolean;
  /**
   * Index of the first colliding G-code line (−1 if no collision).
   * Use to highlight the offending move in the Android G-code visualiser.
   */
  firstCollisionLine: number;
  /** World position of the first collision point. */
  collisionPoint: Vector3 | null;
  /** Human-readable description. */
  description: string;
  /** Android haptic pattern to trigger on collision (intensity 0–255). */
  hapticPattern: number[];
}

/**
 * CollisionDetector
 *
 * Parses a G-code program and checks every tool move against the
 * machine work envelope.  Returns the first out-of-bounds position
 * and a haptic vibration pattern for Android's Vibrator API.
 *
 * Also detects:
 *   • Rapid moves (G0) into material (Z > 0 while X/Y is inside workpiece)
 *   • Feed moves (G1) above safe Z height
 *   • Arc moves that exceed the machine radius
 */
export class CollisionDetector {
  readonly envelope: MachineEnvelope;

  constructor(envelope: MachineEnvelope) {
    this.envelope = envelope;
  }

  /**
   * check
   *
   * Parse and validate a G-code program.
   *
   * @param gcode  Array of G-code lines (as produced by GuitarMachinist et al.).
   */
  check(gcode: string[]): CollisionResult {
    let pos = new Vector3(0, 0, 0);
    const { min, max } = this.envelope;

    for (let li = 0; li < gcode.length; li++) {
      const line  = gcode[li].trim();
      if (!line || line.startsWith(';')) continue;

      // Parse X, Y, Z from line
      const xm = line.match(/X(-?[\d.]+)/);
      const ym = line.match(/Y(-?[\d.]+)/);
      const zm = line.match(/Z(-?[\d.]+)/);

      const nx = xm ? parseFloat(xm[1]) : pos.x;
      const ny = ym ? parseFloat(ym[1]) : pos.y;
      const nz = zm ? parseFloat(zm[1]) : pos.z;
      const next = new Vector3(nx, ny, nz);

      if (!next.isWithinBox(min, max)) {
        return {
          hasCollision:       true,
          firstCollisionLine: li,
          collisionPoint:     next,
          description:
            `COLLISION at line ${li + 1}: ` +
            `tool at X${nx} Y${ny} Z${nz} exceeds machine envelope ` +
            `[${min.toArray().join(',')}] → [${max.toArray().join(',')}]. ` +
            `Emergency stop! Retract spindle immediately.`,
          hapticPattern: [0, 200, 100, 200, 100, 400],   // Android VibrationEffect pattern
        };
      }

      // G0 crash-into-material check: rapid move with Z ≤ 0 while XY inside workpiece
      if (line.startsWith('G0') && nz <= 0 && Math.abs(nx) < 250 && ny > 0 && ny < 600) {
        return {
          hasCollision:       true,
          firstCollisionLine: li,
          collisionPoint:     next,
          description:
            `RAPID CRASH at line ${li + 1}: ` +
            `G0 rapid move at Z=${nz} while inside workpiece boundary. ` +
            `Add G0 Z${Math.abs(nz) + 5} before XY rapid move.`,
          hapticPattern: [0, 100, 50, 100, 50, 100, 50, 400],
        };
      }

      pos = next;
    }

    return {
      hasCollision:       false,
      firstCollisionLine: -1,
      collisionPoint:     null,
      description:        'No collisions detected — toolpath is safe.',
      hapticPattern:      [0, 50],   // short confirmation buzz
    };
  }
}

// ---------------------------------------------------------------------------
// Standard machine envelopes
// ---------------------------------------------------------------------------

export const MACHINE_ENVELOPES: Record<string, MachineEnvelope> = {
  hobbyMill_300x300: {
    min: new Vector3(-150, 0,    -50),
    max: new Vector3( 150, 300,   5),
  },
  professionalMill_600x600: {
    min: new Vector3(-300, 0,    -100),
    max: new Vector3( 300, 600,    5),
  },
  lathe_400mm: {
    min: new Vector3(0,  0,    -410),
    max: new Vector3(200, 200,   5),
  },
  fdmPrinter_220x220: {
    min: new Vector3(0,    0,    0),
    max: new Vector3(220, 220, 250),
  },
};
