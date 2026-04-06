/**
 * Machinist Mario Engine — Inductive Sensor Fusion
 *
 * Models the real physics of near-field inductive coupling between a
 * transmitter coil (base station) and a receiver coil (target device).
 * All equations are derived from Faraday's law, the Neumann formula for
 * mutual inductance, and standard PLL (Phase-Locked Loop) theory.
 *
 * ── Physics background ───────────────────────────────────────────────────────
 *
 * Mutual Inductance (M):
 *   M = k · √(L₁ · L₂)
 *   where k ∈ [0, 1] is the coupling coefficient, L₁ and L₂ are the
 *   self-inductances of the two coils (in henries).
 *
 * Induced EMF (Faraday):
 *   ε = −M · dI/dt = −M · I_peak · ω · cos(ωt)
 *
 * Power transfer (simplified, resistive load):
 *   P_rx = ½ · (ε_peak)² / R_load
 *
 * Angular alignment loss (cosine taper):
 *   The flux linkage between two circular loops whose axes are tilted by θ
 *   is proportional to cos(θ).  At 90° tilt the coupling drops to zero.
 *
 * Distance fall-off (dipole approximation):
 *   For d >> coil radius r, the axial field of a magnetic dipole falls as 1/d³.
 *   For d ≈ r (near-field / wireless-charging regime) a more accurate model
 *   uses the Neumann integral result, approximated here as:
 *     B_axial(d) = (μ₀ · N · I · r²) / (2 · (r² + d²)^(3/2))
 *   The coupling coefficient k is then computed from B and the receiver
 *   geometry.
 *
 * Phase-Locked Loop (PLL):
 *   A PLL locks the receiver's oscillator to the transmitter frequency.
 *   The lock-in range is determined by the loop bandwidth.  We model a
 *   simple first-order PLL:
 *     dφ/dt = ω_n · sin(φ_error)          (phase detector + VCO)
 *   The PLL is "locked" when |φ_error| < lock_threshold_rad.
 *
 * Usage:
 *   import { InductiveCoupler, PLLController, SensorFusion } from './sensor-fusion';
 *
 *   const coupler = new InductiveCoupler({ txTurns: 10, rxTurns: 8, coilRadius_mm: 15 });
 *   const result  = coupler.evaluate(distanceMm: 20, tiltDeg: 15);
 *   console.log(result.powerTransferred_mW);
 *
 *   const pll = new PLLController(7.83, { bandwidth_Hz: 0.5 });
 *   pll.step(7.91, 0.01);
 *   console.log(pll.isLocked());
 */

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------

/** Permeability of free space (H/m). */
const MU0 = 4 * Math.PI * 1e-7;

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

/** Configuration for a pair of inductive coils. */
export interface CoilConfig {
  /** Number of turns on the transmitter coil. */
  txTurns:      number;
  /** Number of turns on the receiver coil. */
  rxTurns:      number;
  /** Mean coil radius (same for both coils — circular, co-axial geometry). mm. */
  coilRadius_mm: number;
  /** Self-inductance of the transmitter coil (μH). Default: estimated from geometry. */
  txInductance_uH?: number;
  /** Self-inductance of the receiver coil (μH). Default: estimated from geometry. */
  rxInductance_uH?: number;
  /** Transmitter drive current amplitude (A). Default: 0.5 A. */
  txCurrent_A?: number;
  /** Transmitter operating frequency (Hz). Default: 120 000 Hz (120 kHz Qi-like). */
  frequency_Hz?: number;
  /** Load resistance seen by the receiver (Ω). Default: 50 Ω. */
  loadResistance_Ohm?: number;
}

/** Result of an inductive coupling evaluation at a specific distance/angle. */
export interface CouplingResult {
  /** Distance between coil centres (mm). */
  distance_mm:         number;
  /** Tilt angle between coil axes (degrees). */
  tiltAngle_deg:       number;
  /** Dimensionless coupling coefficient k ∈ [0, 1]. */
  couplingCoefficient: number;
  /** Mutual inductance M (μH). */
  mutualInductance_uH: number;
  /** Peak induced EMF at the receiver (V). */
  inducedEMF_peak_V:   number;
  /** Power delivered to the load resistance (mW). */
  powerTransferred_mW: number;
  /** Efficiency η = P_rx / P_tx (0–1). */
  efficiency:          number;
}

/** Configuration for the Phase-Locked Loop. */
export interface PLLConfig {
  /** Natural loop bandwidth (Hz). Controls lock speed. Default: 1 Hz. */
  bandwidth_Hz:        number;
  /** Phase error threshold below which the PLL is considered "locked" (radians). */
  lockThreshold_rad?:  number;
  /** Damping ratio ζ. Default: 0.707 (critically damped). */
  dampingRatio?:       number;
}

/** State snapshot of a PLL at one time step. */
export interface PLLState {
  /** Current estimated frequency (Hz). */
  frequency_Hz:   number;
  /** Current phase error (radians). */
  phaseError_rad: number;
  /** Whether the loop is within the lock threshold. */
  locked:         boolean;
  /** Total simulation time elapsed (s). */
  time_s:         number;
}

/** Result of the full sensor fusion pipeline. */
export interface FusionResult {
  coupling:   CouplingResult;
  pll:        PLLState;
  /** Normalised charge rate [0, 1]. 1 = maximum coupling at zero distance and tilt. */
  chargeRate: number;
  /** CSS rgba() string for glow visualisation keyed to charge rate. */
  glowColor:  string;
}

// ---------------------------------------------------------------------------
// InductiveCoupler
// ---------------------------------------------------------------------------

/**
 * InductiveCoupler
 *
 * Computes mutual inductance and power transfer between two circular coils
 * using the Neumann formula (co-axial approximation) and cosine angular loss.
 */
export class InductiveCoupler {
  private readonly cfg: Required<CoilConfig>;

  constructor(cfg: CoilConfig) {
    const r_m = cfg.coilRadius_mm / 1000; // convert mm → m

    // Estimate single-layer air-core inductance: L ≈ μ₀ · N² · π · r² / (length)
    // We approximate coil length as r (single-layer, tightly wound).
    const estimateLuH = (N: number) =>
      (MU0 * N * N * Math.PI * r_m * r_m / r_m) * 1e6; // H → μH

    this.cfg = {
      txTurns:           cfg.txTurns,
      rxTurns:           cfg.rxTurns,
      coilRadius_mm:     cfg.coilRadius_mm,
      txInductance_uH:   cfg.txInductance_uH ?? estimateLuH(cfg.txTurns),
      rxInductance_uH:   cfg.rxInductance_uH ?? estimateLuH(cfg.rxTurns),
      txCurrent_A:       cfg.txCurrent_A       ?? 0.5,
      frequency_Hz:      cfg.frequency_Hz      ?? 120_000,
      loadResistance_Ohm: cfg.loadResistance_Ohm ?? 50,
    };
  }

  /**
   * Evaluate coupling at a given separation distance and tilt angle.
   *
   * @param distanceMm  Axial distance between coil centres (mm). Must be ≥ 0.
   * @param tiltDeg     Angle between the two coil axes (degrees). 0 = co-axial.
   */
  public evaluate(distanceMm: number, tiltDeg: number = 0): CouplingResult {
    const d  = Math.max(distanceMm, 0.01) / 1000; // mm → m (clamp to avoid /0)
    const r  = this.cfg.coilRadius_mm / 1000;      // coil radius in m
    const ω  = 2 * Math.PI * this.cfg.frequency_Hz;

    // ── Axial magnetic flux density at distance d from a circular loop ──────
    // B_axial = (μ₀ · N_tx · I · r²) / (2 · (r² + d²)^(3/2))
    const B_axial = (MU0 * this.cfg.txTurns * this.cfg.txCurrent_A * r * r) /
                    (2 * Math.pow(r * r + d * d, 1.5));

    // ── Angular loss ─────────────────────────────────────────────────────────
    const angleLoss = Math.abs(Math.cos(tiltDeg * Math.PI / 180));

    // ── Effective flux linkage through receiver ───────────────────────────────
    // Φ_rx = B_axial · cos(tilt) · (N_rx · π · r²)
    const rxArea    = this.cfg.rxTurns * Math.PI * r * r;
    const fluxLink  = B_axial * angleLoss * rxArea;

    // ── Mutual inductance M = Φ_rx / I_tx ────────────────────────────────────
    const M_H   = fluxLink / this.cfg.txCurrent_A;
    const M_uH  = M_H * 1e6;

    // ── Coupling coefficient k = M / √(L₁ · L₂) ─────────────────────────────
    const L1  = this.cfg.txInductance_uH * 1e-6;
    const L2  = this.cfg.rxInductance_uH * 1e-6;
    const k   = Math.min(M_H / Math.sqrt(L1 * L2), 1.0);

    // ── Induced peak EMF: ε = M · I_peak · ω ─────────────────────────────────
    const emf_peak = M_H * this.cfg.txCurrent_A * ω;

    // ── Power to load: P = ½ · ε² / R_load ───────────────────────────────────
    const P_rx_W  = 0.5 * emf_peak * emf_peak / this.cfg.loadResistance_Ohm;
    const P_rx_mW = P_rx_W * 1000;

    // ── Transmitter power (ideal): P_tx = ½ · L₁ · ω² · I² ─────────────────
    const P_tx_W  = 0.5 * L1 * ω * ω * this.cfg.txCurrent_A * this.cfg.txCurrent_A;
    const η       = P_tx_W > 0 ? Math.min(P_rx_W / P_tx_W, 1) : 0;

    return {
      distance_mm:         distanceMm,
      tiltAngle_deg:       tiltDeg,
      couplingCoefficient: k,
      mutualInductance_uH: M_uH,
      inducedEMF_peak_V:   emf_peak,
      powerTransferred_mW: P_rx_mW,
      efficiency:          η,
    };
  }

  /**
   * Returns the maximum usable range (mm) at which efficiency exceeds
   * the given threshold (default 10%).
   */
  public maxRange(efficiencyThreshold = 0.10, stepMm = 0.5): number {
    let d = 0.5;
    while (d < 200) {
      const r = this.evaluate(d, 0);
      if (r.efficiency < efficiencyThreshold) return d - stepMm;
      d += stepMm;
    }
    return 200;
  }
}

// ---------------------------------------------------------------------------
// PLLController
// ---------------------------------------------------------------------------

/**
 * PLLController
 *
 * First-order digital Phase-Locked Loop.
 * Tracks a time-varying input frequency and reports lock status.
 *
 * Loop equation:
 *   φ_error(t) = φ_input(t) − φ_vco(t)
 *   dφ_vco/dt  = ω_free + K_pll · φ_error      (VCO update)
 *   K_pll      = 2π · bandwidth_Hz · dampingRatio · 2
 */
export class PLLController {
  private readonly cfg:       Required<PLLConfig>;
  private readonly K_pll:     number;
  private freq_Hz:            number;   // current VCO frequency
  private phase_rad:          number;   // accumulated VCO phase
  private phaseError_rad:     number;
  private time_s:             number;

  constructor(
    /** Free-running (centre) frequency of the VCO (Hz). */
    private readonly freeFrequency_Hz: number,
    cfg: PLLConfig,
  ) {
    this.cfg = {
      bandwidth_Hz:       cfg.bandwidth_Hz,
      lockThreshold_rad:  cfg.lockThreshold_rad  ?? 0.1,
      dampingRatio:       cfg.dampingRatio        ?? 0.707,
    };
    // Loop gain
    this.K_pll        = 2 * Math.PI * this.cfg.bandwidth_Hz * this.cfg.dampingRatio * 2;
    this.freq_Hz      = freeFrequency_Hz;
    this.phase_rad    = 0;
    this.phaseError_rad = 0;
    this.time_s       = 0;
  }

  /**
   * Advance the PLL by one time step.
   *
   * @param inputFreq_Hz  Instantaneous frequency of the incoming signal (Hz).
   * @param dt_s          Time step duration (seconds).
   */
  public step(inputFreq_Hz: number, dt_s: number): PLLState {
    // Input phase increment this step
    const inputPhase = this.phase_rad + 2 * Math.PI * inputFreq_Hz * dt_s;

    // VCO phase increment (before correction)
    const vcoPhase   = this.phase_rad + 2 * Math.PI * this.freq_Hz * dt_s;

    // Phase error (phase detector output)
    this.phaseError_rad = inputPhase - vcoPhase;

    // Wrap error to [−π, π]
    while (this.phaseError_rad >  Math.PI) this.phaseError_rad -= 2 * Math.PI;
    while (this.phaseError_rad < -Math.PI) this.phaseError_rad += 2 * Math.PI;

    // VCO frequency update
    const freqCorrection = (this.K_pll * this.phaseError_rad) / (2 * Math.PI);
    this.freq_Hz  = this.freeFrequency_Hz + freqCorrection;

    // Advance VCO phase
    this.phase_rad = vcoPhase + this.K_pll * this.phaseError_rad * dt_s;
    this.time_s   += dt_s;

    return this.getState();
  }

  /** Returns true when the phase error is within the lock threshold. */
  public isLocked(): boolean {
    return Math.abs(this.phaseError_rad) < this.cfg.lockThreshold_rad;
  }

  /** Current PLL state. */
  public getState(): PLLState {
    return {
      frequency_Hz:   this.freq_Hz,
      phaseError_rad: this.phaseError_rad,
      locked:         this.isLocked(),
      time_s:         this.time_s,
    };
  }

  /** Reset PLL to free-running state. */
  public reset(): void {
    this.freq_Hz        = this.freeFrequency_Hz;
    this.phase_rad      = 0;
    this.phaseError_rad = 0;
    this.time_s         = 0;
  }
}

// ---------------------------------------------------------------------------
// SensorFusion
// ---------------------------------------------------------------------------

/**
 * SensorFusion
 *
 * Combines InductiveCoupler measurements with PLL lock status to produce
 * a unified "charge rate" signal and a visualisation colour for the
 * Canvitar renderer.
 *
 * The charge rate is the geometric mean of:
 *   • normalised coupling efficiency  (0–1)
 *   • PLL lock confidence             (1 if locked, falls off with |φ_error|)
 */
export class SensorFusion {
  private readonly coupler: InductiveCoupler;
  private readonly pll:     PLLController;

  constructor(coilCfg: CoilConfig, pllCfg?: PLLConfig) {
    this.coupler = new InductiveCoupler(coilCfg);
    this.pll     = new PLLController(
      coilCfg.frequency_Hz ?? 120_000,
      pllCfg ?? { bandwidth_Hz: 500 },
    );
  }

  /**
   * Evaluate the full sensor fusion pipeline.
   *
   * @param distanceMm    Distance between coils (mm).
   * @param tiltDeg       Tilt between coil axes (degrees).
   * @param inputFreq_Hz  Frequency being broadcast by the transmitter (Hz).
   * @param dt_s          Time step for PLL integration (s). Default 0.001.
   */
  public evaluate(
    distanceMm:   number,
    tiltDeg:      number = 0,
    inputFreq_Hz: number = 120_000,
    dt_s:         number = 0.001,
  ): FusionResult {
    const coupling = this.coupler.evaluate(distanceMm, tiltDeg);
    const pllState = this.pll.step(inputFreq_Hz, dt_s);

    // Lock confidence: 1 when locked, falls off as |φ_error| → π
    const lockConf  = Math.max(0, 1 - Math.abs(pllState.phaseError_rad) / Math.PI);
    const chargeRate = Math.sqrt(coupling.efficiency * lockConf);

    const glowColor = SensorFusion.toGlowColor(chargeRate);

    return { coupling, pll: pllState, chargeRate, glowColor };
  }

  /** Returns the internal PLL (for inspection / multi-step use). */
  public getPLL(): PLLController { return this.pll; }

  /** Returns the internal coupler (for inspection). */
  public getCoupler(): InductiveCoupler { return this.coupler; }

  /**
   * Maps a normalised charge rate [0, 1] to a CSS rgba() glow colour.
   * 0 = no glow (dark), 1 = full cyan glow (peak coupling).
   */
  public static toGlowColor(chargeRate: number): string {
    const t = Math.max(0, Math.min(1, chargeRate));
    const r = Math.round(0);
    const g = Math.round(180 + 75 * t);     // 180 → 255
    const b = Math.round(200 * t);
    const a = (0.2 + 0.8 * t).toFixed(2);   // 0.2 → 1.0
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  }

  /** Reset the PLL to its free-running state. */
  public reset(): void { this.pll.reset(); }
}
