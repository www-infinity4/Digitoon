/**
 * Machinist Mario Engine — Ripple Shader Algebra
 *
 * Implements the damped travelling-wave surface-displacement equation for
 * use in canvas-based renderers (Canvitar) and WebGL/GLSL preview exports.
 * All math is pure TypeScript — no GPU required.
 *
 * ── Wave equation ────────────────────────────────────────────────────────────
 *
 *   H(d, t) = A · cos(k · d − ω · t) · e^(−λ · d)
 *
 *   A  (amplitude)       — peak displacement; controls visual "energy" intensity
 *   k  (wave number)     — 2π / λ_wave; sets ring density
 *   ω  (angular freq.)   — 2π · f; animation speed
 *   λ  (falloff)         — exponential decay; keeps energy inside the disc
 *   d  (radial distance) — from UV centre to current fragment
 *   t  (time)            — seconds since start
 *
 * This is a cylindrically-symmetric, outward-propagating wave with exponential
 * spatial decay — the "Sombrero" profile at t = 0.  It is used in:
 *
 *   • Cartoon animation overlays (energy auras, magic circles)
 *   • CNC surface-quality previews (simulate milling vibration patterns)
 *   • Physics visualisers (Huygens wavefronts, acoustic pressure maps)
 *
 * ── Chromatic aberration ─────────────────────────────────────────────────────
 * At high charge levels the three colour channels (R, G, B) are sampled at
 * slightly different radii, producing the prismatic "EM surge" look seen in
 * high-voltage photography.
 *
 * ── GLSL export ──────────────────────────────────────────────────────────────
 * `RippleShader.toGLSL()` returns a self-contained GLSL fragment shader
 * string (WebGL 1 / GLSL ES 1.00) that can be dropped directly into a
 * THREE.ShaderMaterial or a raw WebGL program.
 *
 * Usage:
 *   import { RippleShader, RippleCompositor } from './ripple-shader';
 *
 *   const shader = new RippleShader({ frequency_Hz: 7.83, amplitude: 0.08 });
 *   const h = shader.displacement({ x: 0.6, y: 0.4 }, 1.5);
 *
 *   const comp  = new RippleCompositor(shader);
 *   const frame = comp.renderFrame(128, 128, 2.0);  // 128×128 pixel grid at t=2s
 */

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Normalised 2-D UV coordinate (each axis typically 0–1). */
export interface UV { x: number; y: number }

/** Configuration for the ripple wave. */
export interface RippleConfig {
  /** Wave frequency (Hz). Controls animation speed. Default: 7.83 Hz. */
  frequency_Hz?:  number;
  /** Peak displacement amplitude (normalised, 0–1). Default: 0.05. */
  amplitude?:     number;
  /** Wave-ring density: higher = more concentric rings. Default: 40. */
  waveDensity?:   number;
  /** Exponential spatial falloff exponent λ. Default: 5. */
  falloff?:       number;
  /**
   * Chromatic aberration strength (UV offset between R/G/B channels, 0–1).
   * 0 = monochrome, 1 = maximum fringing. Default: 0.
   */
  chromaticAberration?: number;
  /** Disc clip radius (normalised 0–1). Displacement beyond this radius = 0. */
  clipRadius?:    number;
}

/** Per-pixel displacement value and derived colour channels. */
export interface RipplePixel {
  /** Radial distance from UV centre (0–0.707 for full unit square). */
  dist:        number;
  /** Total wave displacement H(d, t). */
  displacement: number;
  /** Displacement for the R channel (chromatically offset). */
  r:            number;
  /** Displacement for the G channel. */
  g:            number;
  /** Displacement for the B channel (chromatically offset in other direction). */
  b:            number;
  /** CSS rgba() colour string for direct canvas use. */
  color:        string;
}

/** A full rendered frame as a flat Float32Array (width × height × 4 channels). */
export interface RippleFrame {
  width:  number;
  height: number;
  /** RGBA values in [0, 1], row-major. */
  data:   Float32Array;
}

// ---------------------------------------------------------------------------
// RippleShader
// ---------------------------------------------------------------------------

/**
 * RippleShader
 *
 * Evaluates the damped travelling-wave equation at arbitrary UV coordinates
 * and simulation times.  All methods are pure (no state mutation).
 */
export class RippleShader {
  private readonly cfg: Required<RippleConfig>;
  /** Angular frequency ω = 2π · f */
  private readonly omega: number;
  /** Pre-computed wave number k = 2π · waveDensity / (2π) = waveDensity */
  private readonly k: number;

  constructor(cfg: RippleConfig = {}) {
    this.cfg = {
      frequency_Hz:         cfg.frequency_Hz         ?? 7.83,
      amplitude:            cfg.amplitude             ?? 0.05,
      waveDensity:          cfg.waveDensity           ?? 40,
      falloff:              cfg.falloff               ?? 5,
      chromaticAberration:  cfg.chromaticAberration   ?? 0,
      clipRadius:           cfg.clipRadius             ?? 0.5,
    };
    this.omega = 2 * Math.PI * this.cfg.frequency_Hz;
    this.k     = this.cfg.waveDensity;
  }

  // ── Core equation ──────────────────────────────────────────────────────────

  /**
   * H(d, t) = A · cos(k · d − ω · t) · e^(−λ · d)
   *
   * @param d    Radial distance from wave origin (normalised, 0–1).
   * @param t    Simulation time (seconds).
   * @param amp  Amplitude override (uses config default when omitted).
   */
  public waveHeight(d: number, t: number, amp?: number): number {
    const A       = amp ?? this.cfg.amplitude;
    const phase   = this.k * d - this.omega * t;
    const falloff = Math.exp(-this.cfg.falloff * d);
    return A * Math.cos(phase) * falloff;
  }

  /**
   * Evaluate the ripple at a UV coordinate at simulation time t.
   * Returns a full `RipplePixel` including chromatic channel splits and CSS colour.
   *
   * @param uv  Normalised UV coordinate.
   * @param t   Simulation time (seconds).
   */
  public displacement(uv: UV, t: number): RipplePixel {
    const cx = uv.x - 0.5;
    const cy = uv.y - 0.5;
    const d  = Math.sqrt(cx * cx + cy * cy);

    // Clip outside disc
    if (d > this.cfg.clipRadius) {
      return { dist: d, displacement: 0, r: 0, g: 0, b: 0, color: 'rgba(0,0,0,0)' };
    }

    const ca  = this.cfg.chromaticAberration * 0.02;
    const h   = this.waveHeight(d, t);
    const hR  = this.waveHeight(Math.max(0, d - ca), t);
    const hG  = h;
    const hB  = this.waveHeight(d + ca, t);

    const color = RippleShader.toColor(h, hG, hB, this.cfg.amplitude);

    return { dist: d, displacement: h, r: hR, g: hG, b: hB, color };
  }

  // ── Batch evaluation ───────────────────────────────────────────────────────

  /**
   * Evaluate the ripple on a regular 2-D grid.
   * Returns a `RippleFrame` suitable for canvas ImageData.
   *
   * @param width   Pixel columns.
   * @param height  Pixel rows.
   * @param t       Simulation time (seconds).
   * @param baseColor  Optional base RGB tint [r, g, b] in [0, 255].
   */
  public renderFrame(
    width:  number,
    height: number,
    t:      number,
    baseColor: [number, number, number] = [0, 220, 200],
  ): RippleFrame {
    const data = new Float32Array(width * height * 4);
    for (let py = 0; py < height; py++) {
      for (let px = 0; px < width; px++) {
        const uv: UV = { x: px / (width - 1), y: py / (height - 1) };
        const px_ = this.displacement(uv, t);
        const idx = (py * width + px) * 4;

        // Map displacement to brightness boost
        const brightness = (px_.displacement + this.cfg.amplitude) /
                           (2 * this.cfg.amplitude);          // [0, 1]

        data[idx    ] = (baseColor[0] / 255) * brightness;   // R
        data[idx + 1] = (baseColor[1] / 255) * brightness;   // G
        data[idx + 2] = (baseColor[2] / 255) * brightness;   // B
        data[idx + 3] = brightness;                           // A
      }
    }
    return { width, height, data };
  }

  /**
   * Produce an animation sequence of `frameCount` frames over `duration_s` seconds.
   * Each frame is a `RippleFrame`.  Returns an array of frames.
   */
  public renderAnimation(
    width: number, height: number,
    duration_s: number, frameCount: number,
    baseColor?: [number, number, number],
  ): RippleFrame[] {
    const frames: RippleFrame[] = [];
    for (let i = 0; i < frameCount; i++) {
      const t = (i / Math.max(frameCount - 1, 1)) * duration_s;
      frames.push(this.renderFrame(width, height, t, baseColor));
    }
    return frames;
  }

  // ── Parameter accessors ────────────────────────────────────────────────────

  /** Period of one complete wave oscillation (seconds). */
  public get period_s(): number { return 1 / this.cfg.frequency_Hz; }

  /** Wavelength in UV space (normalised units). */
  public get wavelength_uv(): number { return (2 * Math.PI) / this.k; }

  /** Angular frequency ω (rad/s). */
  public get angularFrequency(): number { return this.omega; }

  /** Returns a copy of the resolved config. */
  public getConfig(): Readonly<Required<RippleConfig>> { return { ...this.cfg }; }

  // ── GLSL export ────────────────────────────────────────────────────────────

  /**
   * Returns a self-contained GLSL ES 1.00 fragment shader implementing
   * the same ripple equation.  Drop this into a WebGL ShaderMaterial.
   *
   * Uniforms:
   *   uniform float u_time;       // seconds since start
   *   uniform float u_charge;     // [0, 1] — scales amplitude
   *   uniform sampler2D u_texture; // optional base texture
   *
   * Varyings (must be set by vertex shader):
   *   varying vec2 v_uv;          // normalised UV [0, 1]
   */
  public toGLSL(): string {
    const { frequency_Hz, amplitude, waveDensity, falloff, clipRadius } = this.cfg;
    const omega = (2 * Math.PI * frequency_Hz).toFixed(6);
    const k     = waveDensity.toFixed(4);
    const A     = amplitude.toFixed(6);
    const lam   = falloff.toFixed(4);
    const clip  = clipRadius.toFixed(4);

    return `
precision mediump float;

uniform float u_time;
uniform float u_charge;
varying vec2  v_uv;

// Damped travelling-wave: H(d,t) = A * cos(k*d - omega*t) * exp(-lambda*d)
float ripple(float d, float t, float amp) {
  float phase   = ${k} * d - ${omega} * t;
  float falloff = exp(-${lam} * d);
  return amp * cos(phase) * falloff;
}

void main() {
  vec2  c    = v_uv - 0.5;
  float d    = length(c);

  if (d > ${clip}) {
    gl_FragColor = vec4(0.0);
    return;
  }

  float amp = ${A} * u_charge;
  float h   = ripple(d, u_time, amp);

  // Map to brightness [0,1]
  float brightness = (h + amp) / (2.0 * amp + 1e-6);

  // Cyan energy signature
  vec3 color = vec3(0.0, 0.85 + 0.15 * brightness, 0.78 * brightness);
  gl_FragColor = vec4(color * brightness, brightness);
}
`.trim();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  /**
   * Maps displacement values per channel to a CSS rgba() colour string.
   * Positive displacement → bright cyan; negative → darker blue.
   */
  private static toColor(h: number, hG: number, hB: number, amp: number): string {
    const toChannel = (v: number): number => {
      const norm = (v + amp) / (2 * amp + 1e-9); // [0, 1]
      return Math.round(Math.max(0, Math.min(255, norm * 255)));
    };
    const r = toChannel(0);          // Red channel stays low (cyan signature)
    const g = toChannel(hG * 1.0);
    const b = toChannel(hB * 0.78);
    const a = ((Math.abs(h) / (amp + 1e-9)) * 0.9 + 0.1).toFixed(2);
    return `rgba(${r},${g},${b},${a})`;
  }
}

// ---------------------------------------------------------------------------
// RippleCompositor
// ---------------------------------------------------------------------------

/**
 * RippleCompositor
 *
 * Combines multiple `RippleShader` instances (e.g. at different frequencies)
 * and composites them into a single frame via additive blending.
 * Useful for simulating complex wave interference patterns.
 */
export class RippleCompositor {
  private readonly layers: RippleShader[];

  constructor(...shaders: RippleShader[]) {
    this.layers = shaders.length > 0 ? shaders : [new RippleShader()];
  }

  /** Add another ripple layer. */
  public addLayer(shader: RippleShader): this {
    this.layers.push(shader);
    return this;
  }

  /**
   * Render the composited frame (additive blending across all layers).
   */
  public renderFrame(
    width: number, height: number, t: number,
    baseColor?: [number, number, number],
  ): RippleFrame {
    if (this.layers.length === 0) {
      return { width, height, data: new Float32Array(width * height * 4) };
    }

    // Render first layer
    const composite = this.layers[0].renderFrame(width, height, t, baseColor);

    // Additively blend remaining layers
    for (let li = 1; li < this.layers.length; li++) {
      const layer = this.layers[li].renderFrame(width, height, t, baseColor);
      for (let i = 0; i < composite.data.length; i++) {
        composite.data[i] = Math.min(1, composite.data[i] + layer.data[i]);
      }
    }

    return composite;
  }

  /**
   * Sample the total displacement at a UV point (sum of all layers).
   */
  public displacement(uv: UV, t: number): number {
    return this.layers.reduce((sum, s) => sum + s.displacement(uv, t).displacement, 0);
  }

  /** Number of active layers. */
  public get layerCount(): number { return this.layers.length; }
}

// ---------------------------------------------------------------------------
// Convenience factory functions
// ---------------------------------------------------------------------------

/**
 * Create a ripple shader locked to a specific frequency.
 * Amplitude scales with `charge` ∈ [0, 1].
 */
export function createChargedRipple(
  frequency_Hz: number,
  charge: number,
  opts?: Omit<RippleConfig, 'frequency_Hz' | 'amplitude'>,
): RippleShader {
  return new RippleShader({
    ...opts,
    frequency_Hz,
    amplitude: Math.max(0, Math.min(1, charge)) * 0.08,
  });
}

/**
 * Generate a lookup table of H(d) at a fixed time t (no animation).
 * Useful for pre-baking displacement maps.
 *
 * @param samples   Number of evenly-spaced d values in [0, clipRadius].
 */
export function buildDisplacementLUT(
  shader: RippleShader,
  t:      number,
  samples = 256,
): Float32Array {
  const cfg  = shader.getConfig();
  const lut  = new Float32Array(samples);
  for (let i = 0; i < samples; i++) {
    const d = (i / (samples - 1)) * cfg.clipRadius;
    lut[i]  = shader.waveHeight(d, t);
  }
  return lut;
}
