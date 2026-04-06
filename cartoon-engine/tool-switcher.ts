/**
 * Machinist Mario Engine — Multi-Material 3D Printer Tool Switcher
 *
 * Generates the precise G-code sequences required when a multi-material
 * FDM printer (e.g. Prusa XL, Bambu X1C, or a custom 4-head machine)
 * needs to change filament mid-print.  The switcher handles:
 *
 *   • Retraction & Z-lift before the move
 *   • Rapid travel to the purge tower (off the part)
 *   • Extrusion purge to flush residual material from the previous filament
 *   • Nozzle wipe (linear stroke across a silicone brush or wipe pad)
 *   • Tool-change command (T0 … Tn + M6 on machines that require it)
 *   • Prime / re-pressurise the new filament before returning to the part
 *   • Return to the last print position and resume
 *
 * ── Purge tower geometry ──────────────────────────────────────────────────────
 * Each tool change extrudes a fixed purge bead at a dedicated XY location.
 * The tower grows in Z with each swap so purge beads never contaminate
 * already-printed layers.
 *
 * ── Per-material profiles ─────────────────────────────────────────────────────
 * Different filament materials have different retraction, temperature, and
 * purge volume requirements.  The profiles table encodes these — analogous to
 * a machinist's "Feeds & Speeds" chart.
 *
 * ── G-code commands used ─────────────────────────────────────────────────────
 *   T0 … Tn  Select tool/extruder
 *   M6       Tool change confirmation (Mach3/LinuxCNC / some Klipper configs)
 *   M104 S   Set extruder temperature (non-blocking)
 *   M109 S   Set extruder temperature and wait
 *   M106 S   Set part-cooling fan speed (0–255)
 *   G1 E     Extrude (positive = forward, negative = retract)
 *   G92 E0   Reset extruder position
 *
 * Usage:
 *   import { ToolSwitcher, MaterialType } from './tool-switcher';
 *   import { Vector3 } from './vector3';
 *
 *   const switcher = new ToolSwitcher({
 *     purgeLocation: new Vector3(5, 5, 0),
 *     wipeLength_mm: 10,
 *   });
 *
 *   // Switch from PLA (tool 0) to ABS (tool 1) at Z = 3.6 mm
 *   const gcode = switcher.switch(0, MaterialType.PLA, 1, MaterialType.ABS, 3.6, new Vector3(100, 80, 3.6));
 *   console.log(gcode);
 */

import { Vector3 } from './vector3';

// ---------------------------------------------------------------------------
// Material types and profiles
// ---------------------------------------------------------------------------

/** Supported material identifiers. */
export enum MaterialType {
  PLA          = 'PLA',
  ABS          = 'ABS',
  PETG         = 'PETG',
  TPU          = 'TPU',
  ASA          = 'ASA',
  NYLON        = 'NYLON',
  CARBON_FIBRE = 'CARBON_FIBRE',
  SUPPORT_PVA  = 'SUPPORT_PVA',
  SUPPORT_HIPS = 'SUPPORT_HIPS',
  /** Brass / bronze-filled PLA for decorative metallic finishes. */
  METAL_FILL   = 'METAL_FILL',
}

/** Per-material print parameters. */
export interface MaterialProfile {
  /** Nozzle temperature (°C). */
  nozzleTemp_C:    number;
  /** Heated bed temperature (°C). */
  bedTemp_C:       number;
  /** Retraction length before tool change (mm). */
  retraction_mm:   number;
  /** Retraction speed (mm/min). */
  retractionSpeed: number;
  /** Volume of filament to purge after a tool change (mm of extrusion). */
  purgeLength_mm:  number;
  /** Feed rate for purge extrusion (mm/min). */
  purgeFeedRate:   number;
  /** Prime length after returning to print position (mm). */
  primeLength_mm:  number;
  /** Fan speed 0–255 (PWM). */
  fanSpeed:        number;
}

/** Look-up table of default material profiles. */
export const MATERIAL_PROFILES: Record<MaterialType, MaterialProfile> = {
  [MaterialType.PLA]: {
    nozzleTemp_C:    215, bedTemp_C:   60, retraction_mm:    5, retractionSpeed: 2400,
    purgeLength_mm:  30,  purgeFeedRate: 120, primeLength_mm: 4, fanSpeed: 255,
  },
  [MaterialType.ABS]: {
    nozzleTemp_C:    240, bedTemp_C:   100, retraction_mm:   6, retractionSpeed: 2400,
    purgeLength_mm:  35,  purgeFeedRate: 100, primeLength_mm: 5, fanSpeed: 0,
  },
  [MaterialType.PETG]: {
    nozzleTemp_C:    235, bedTemp_C:   85, retraction_mm:    4, retractionSpeed: 2000,
    purgeLength_mm:  30,  purgeFeedRate: 110, primeLength_mm: 4, fanSpeed: 128,
  },
  [MaterialType.TPU]: {
    nozzleTemp_C:    230, bedTemp_C:   40, retraction_mm:    1, retractionSpeed: 800,
    purgeLength_mm:  40,  purgeFeedRate:  80, primeLength_mm: 5, fanSpeed: 255,
  },
  [MaterialType.ASA]: {
    nozzleTemp_C:    245, bedTemp_C:   100, retraction_mm:   6, retractionSpeed: 2400,
    purgeLength_mm:  35,  purgeFeedRate: 100, primeLength_mm: 5, fanSpeed: 0,
  },
  [MaterialType.NYLON]: {
    nozzleTemp_C:    260, bedTemp_C:   70, retraction_mm:    7, retractionSpeed: 2400,
    purgeLength_mm:  50,  purgeFeedRate:  90, primeLength_mm: 6, fanSpeed: 0,
  },
  [MaterialType.CARBON_FIBRE]: {
    nozzleTemp_C:    255, bedTemp_C:   90, retraction_mm:    5, retractionSpeed: 2000,
    purgeLength_mm:  40,  purgeFeedRate: 100, primeLength_mm: 5, fanSpeed: 64,
  },
  [MaterialType.SUPPORT_PVA]: {
    nozzleTemp_C:    210, bedTemp_C:   60, retraction_mm:    5, retractionSpeed: 2000,
    purgeLength_mm:  35,  purgeFeedRate: 100, primeLength_mm: 4, fanSpeed: 192,
  },
  [MaterialType.SUPPORT_HIPS]: {
    nozzleTemp_C:    230, bedTemp_C:   100, retraction_mm:   6, retractionSpeed: 2000,
    purgeLength_mm:  35,  purgeFeedRate: 100, primeLength_mm: 5, fanSpeed: 0,
  },
  [MaterialType.METAL_FILL]: {
    nozzleTemp_C:    220, bedTemp_C:   60, retraction_mm:    5, retractionSpeed: 2000,
    purgeLength_mm:  40,  purgeFeedRate: 100, primeLength_mm: 5, fanSpeed: 128,
  },
};

// ---------------------------------------------------------------------------
// ToolSwitcher configuration
// ---------------------------------------------------------------------------

/** Configuration for the ToolSwitcher. */
export interface ToolSwitcherConfig {
  /** XY location of the purge tower origin (Z is set per-layer). */
  purgeLocation:     Vector3;
  /** Length of the nozzle wipe stroke (mm). Default: 15 mm. */
  wipeLength_mm?:    number;
  /** Z clearance height during rapid travel between part and purge tower (mm). Default: 2 mm. */
  zClearance_mm?:    number;
  /** Rapid travel speed (mm/min). Default: 9000. */
  rapidSpeed?:       number;
  /** Whether to emit M6 (tool change acknowledgement) after Tn. Default: false. */
  emitM6?:           boolean;
  /** Whether to wait for temperature (M109) rather than just setting it (M104). Default: true. */
  waitForTemp?:      boolean;
  /** Floating-point precision for coordinate output. Default: 3. */
  precision?:        number;
}

// ---------------------------------------------------------------------------
// ToolChange record
// ---------------------------------------------------------------------------

/** Record of a single tool-change event. */
export interface ToolChangeRecord {
  fromTool:       number;
  toTool:         number;
  fromMaterial:   MaterialType;
  toMaterial:     MaterialType;
  layerZ_mm:      number;
  gcode:          string;
  purgeLength_mm: number;
}

// ---------------------------------------------------------------------------
// ToolSwitcher
// ---------------------------------------------------------------------------

/**
 * ToolSwitcher
 *
 * Generates G-code for multi-material tool changes.  Maintains an internal
 * log of all tool changes performed (useful for purge-tower height tracking).
 */
export class ToolSwitcher {
  private readonly cfg: Required<ToolSwitcherConfig>;
  private currentTool:     number       = -1;
  private currentMaterial: MaterialType | null = null;
  private readonly log:    ToolChangeRecord[]  = [];
  private purgeTowerZ:     number              = 0;

  constructor(cfg: ToolSwitcherConfig) {
    this.cfg = {
      purgeLocation:  cfg.purgeLocation,
      wipeLength_mm:  cfg.wipeLength_mm  ?? 15,
      zClearance_mm:  cfg.zClearance_mm  ?? 2,
      rapidSpeed:     cfg.rapidSpeed     ?? 9000,
      emitM6:         cfg.emitM6         ?? false,
      waitForTemp:    cfg.waitForTemp     ?? true,
      precision:      cfg.precision       ?? 3,
    };
  }

  // ── Primary API ────────────────────────────────────────────────────────────

  /**
   * Generate G-code for a complete material tool-change sequence.
   *
   * @param fromTool      Currently active tool index (0-based; -1 = first load).
   * @param fromMaterial  Currently loaded material.
   * @param toTool        Target tool index.
   * @param toMaterial    Target material.
   * @param layerZ_mm     Current layer Z height (mm).
   * @param returnPos     XYZ position to return to after the swap.
   */
  public switch(
    fromTool:     number,
    fromMaterial: MaterialType,
    toTool:       number,
    toMaterial:   MaterialType,
    layerZ_mm:    number,
    returnPos:    Vector3,
  ): string {
    if (fromTool === toTool) return `; No tool change required (T${toTool} already active)\n`;

    const fromProfile = MATERIAL_PROFILES[fromMaterial];
    const toProfile   = MATERIAL_PROFILES[toMaterial];
    const p           = this.cfg.precision;
    const lines: string[] = [];

    const f = (n: number) => n.toFixed(p);
    const safeZ = layerZ_mm + this.cfg.zClearance_mm;

    // ── 1. Retract current material ─────────────────────────────────────────
    lines.push(`; ═══ TOOL CHANGE: T${fromTool}(${fromMaterial}) → T${toTool}(${toMaterial}) @ Z${f(layerZ_mm)} ═══`);
    lines.push(`G1 E-${f(fromProfile.retraction_mm)} F${fromProfile.retractionSpeed} ; Retract`);

    // ── 2. Z-lift and travel to purge tower ─────────────────────────────────
    lines.push(`G1 Z${f(safeZ)} F${this.cfg.rapidSpeed}            ; Z-lift for clearance`);
    const px = this.cfg.purgeLocation.x;
    const py = this.cfg.purgeLocation.y;
    lines.push(`G1 X${f(px)} Y${f(py)} F${this.cfg.rapidSpeed}     ; Travel to purge tower`);

    // ── 3. Select new tool ──────────────────────────────────────────────────
    lines.push(`T${toTool}${this.cfg.emitM6 ? ' M6' : ''}          ; Select tool ${toTool}`);

    // ── 4. Set temperature for new material ─────────────────────────────────
    const tempCmd = this.cfg.waitForTemp ? 'M109' : 'M104';
    lines.push(`${tempCmd} S${toProfile.nozzleTemp_C}              ; ${this.cfg.waitForTemp ? 'Wait for' : 'Set'} nozzle temp`);
    lines.push(`M190 S${toProfile.bedTemp_C}                       ; Wait for bed temp`);
    lines.push(`M106 S${toProfile.fanSpeed}                        ; Set fan speed`);

    // ── 5. Purge at purge tower ─────────────────────────────────────────────
    this.purgeTowerZ = Math.max(this.purgeTowerZ, layerZ_mm);
    lines.push(`G1 Z${f(this.purgeTowerZ + 0.2)} F${this.cfg.rapidSpeed} ; Lower to purge height`);
    lines.push(`G1 E${f(toProfile.purgeLength_mm)} F${f(toProfile.purgeFeedRate)} ; Purge new material`);
    lines.push(`G92 E0                                              ; Reset extruder`);

    // ── 6. Nozzle wipe ──────────────────────────────────────────────────────
    const wipeEnd = px + this.cfg.wipeLength_mm;
    lines.push(`G1 X${f(wipeEnd)} Y${f(py)} F${this.cfg.rapidSpeed} ; Wipe nozzle pass 1`);
    lines.push(`G1 X${f(px)} Y${f(py)} F${this.cfg.rapidSpeed}      ; Wipe nozzle pass 2`);

    // ── 7. Advance purge tower Z ─────────────────────────────────────────────
    this.purgeTowerZ += 0.4;

    // ── 8. Return to part ───────────────────────────────────────────────────
    lines.push(`G1 X${f(returnPos.x)} Y${f(returnPos.y)} F${this.cfg.rapidSpeed} ; Return to part`);
    lines.push(`G1 Z${f(layerZ_mm)} F${this.cfg.rapidSpeed}       ; Lower to layer Z`);

    // ── 9. Prime ────────────────────────────────────────────────────────────
    lines.push(`G1 E${f(toProfile.primeLength_mm)} F${f(toProfile.purgeFeedRate)} ; Prime new material`);
    lines.push(`G92 E0                                              ; Reset extruder`);
    lines.push(`; ═══ RESUME PRINTING with T${toTool}(${toMaterial}) ═══`);
    lines.push('');

    this.currentTool     = toTool;
    this.currentMaterial = toMaterial;

    const gcode = lines.join('\n');

    this.log.push({
      fromTool, toTool, fromMaterial, toMaterial,
      layerZ_mm, gcode, purgeLength_mm: toProfile.purgeLength_mm,
    });

    return gcode;
  }

  // ── Multi-layer sequence ───────────────────────────────────────────────────

  /**
   * Generate a complete layer-by-layer tool-change plan for a print.
   *
   * @param plan  Array of `{ layerZ_mm, toolIndex, material }` entries
   *              (one per material segment, in print order).
   * @param returnPos  XY return position (Z is set per layer).
   */
  public generatePlan(
    plan: Array<{ layerZ_mm: number; toolIndex: number; material: MaterialType }>,
    returnPos: Vector3 = new Vector3(100, 100, 0),
  ): string {
    if (plan.length === 0) return '; Empty plan\n';

    const blocks: string[] = [`; Multi-material plan: ${plan.length} segment(s)\n`];

    // Load first tool without a "from" context
    const first = plan[0];
    const fp    = MATERIAL_PROFILES[first.material];
    blocks.push(`; Initial load: T${first.toolIndex} (${first.material})`);
    blocks.push(`T${first.toolIndex}${this.cfg.emitM6 ? ' M6' : ''}`);
    blocks.push(`M109 S${fp.nozzleTemp_C}`);
    blocks.push(`M190 S${fp.bedTemp_C}`);
    blocks.push('');

    this.currentTool     = first.toolIndex;
    this.currentMaterial = first.material;

    for (let i = 1; i < plan.length; i++) {
      const prev = plan[i - 1];
      const curr = plan[i];
      const ret  = new Vector3(returnPos.x, returnPos.y, curr.layerZ_mm);
      blocks.push(
        this.switch(prev.toolIndex, prev.material, curr.toolIndex, curr.material, curr.layerZ_mm, ret)
      );
    }

    return blocks.join('\n');
  }

  // ── Utilities ──────────────────────────────────────────────────────────────

  /** Total volume of filament purged across all tool changes (mm of extrusion). */
  public totalPurgeLength_mm(): number {
    return this.log.reduce((sum, r) => sum + r.purgeLength_mm, 0);
  }

  /** Number of tool changes performed so far. */
  public get changeCount(): number { return this.log.length; }

  /** Read-only log of all tool changes. */
  public getLog(): ReadonlyArray<ToolChangeRecord> { return this.log; }

  /** Current tool index (-1 = unset). */
  public get activeTool(): number { return this.currentTool; }

  /** Current material (null = unset). */
  public get activeMaterial(): MaterialType | null { return this.currentMaterial; }

  /** Reset the switcher state (does not clear log). */
  public reset(): void {
    this.currentTool     = -1;
    this.currentMaterial = null;
    this.purgeTowerZ     = 0;
  }

  /** Clear the change log. */
  public clearLog(): void { this.log.length = 0; }
}

// ---------------------------------------------------------------------------
// Convenience helpers
// ---------------------------------------------------------------------------

/**
 * Calculate the estimated purge tower volume (mm³) given a set of tool changes.
 * Purge tower cross-section is approximated as a rectangle:
 *   width = wipeLength, depth = 5 mm (one line width), height = purge bead height
 */
export function estimatePurgeTowerVolume_mm3(
  toolChanges:   ToolChangeRecord[],
  wipeLength_mm: number = 15,
  lineWidth_mm:  number = 0.4,
  beadHeight_mm: number = 0.4,
): number {
  const totalExtrusion = toolChanges.reduce((s, tc) => s + tc.purgeLength_mm, 0);
  // Approximate: extrusion length × cross-sectional area of a 0.4 mm line
  const filamentArea = Math.PI * (1.75 / 2) ** 2; // 1.75 mm filament radius
  const volume       = totalExtrusion * filamentArea;
  return volume; // mm³
}

/**
 * Returns the recommended minimum nozzle size for a given material.
 * Abrasive filaments (carbon fibre, metal fills) require a hardened
 * or larger nozzle to prevent wear.
 */
export function recommendedNozzleDiameter_mm(material: MaterialType): number {
  switch (material) {
    case MaterialType.CARBON_FIBRE:
    case MaterialType.METAL_FILL:
      return 0.6; // Larger, hardened nozzle
    case MaterialType.TPU:
      return 0.8; // Flexible filament benefits from larger orifice
    default:
      return 0.4; // Standard
  }
}
