/**
 * Cartoon Prompt Engine — Clockwork Mechanism Simulator
 *
 * Simulates a complete clockwork mechanism from first principles:
 *   PowerSpring    — mainspring energy storage and torque curve
 *   EscapeWheel    — the notched wheel that controls energy release
 *   PalletFork     — oscillating lever that locks/unlocks the escape wheel
 *   Oscillator     — balance wheel or pendulum providing the time reference
 *   GearTrain      — power transmission from mainspring to escape wheel
 *   Clockwork      — top-level assembly that ties all components together
 *
 * ── How a clockwork works (for the AI to understand, not just mimic) ─────────
 *
 * 1. The MAINSPRING stores potential energy in a coiled steel band.
 *    As it unwinds, it releases torque: τ(θ) = k·θ  (torsional spring law)
 *    where k is the spring stiffness and θ is the remaining wind angle.
 *
 * 2. The GEAR TRAIN steps up the torque from the slow mainspring to the
 *    fast escape wheel, trading speed for torque via the involute gear math
 *    in gear-physics.ts.
 *
 * 3. The ESCAPEMENT (escape wheel + pallet fork) converts continuous
 *    rotational motion into discrete steps.  Each oscillation of the
 *    balance wheel allows the escape wheel to advance by exactly ONE tooth.
 *
 * 4. The OSCILLATOR (balance wheel/pendulum) provides the isochronous
 *    time reference.  Its frequency f = (1/2π)·sqrt(k_s/I) where k_s is
 *    the hairspring stiffness and I is the moment of inertia.
 *
 * 5. The HANDS are driven at fixed fractions of the escape wheel rate via
 *    additional gear stages (minutes = escape_rate / 60, hours = / 720).
 *
 * Usage:
 *   import { Clockwork, PowerSpring, Oscillator } from './clockwork';
 *
 *   const spring = new PowerSpring({ stiffness_Nm_per_rad: 0.005, maxWindAngle_rad: 40 });
 *   const osc    = new Oscillator({ momentOfInertia_kg_m2: 1e-6, springRate_Nm_per_rad: 1e-4 });
 *   const clock  = new Clockwork({ spring, oscillator: osc, escapeTeeth: 15, totalRatio: 3600 });
 *
 *   // Simulate 1 hour
 *   const result = clock.simulate({ durationSeconds: 3600, windLevel: 1.0 });
 *   console.log(result.elapsedTicks);      // tick count
 *   console.log(result.timingError_ppm);   // parts-per-million accuracy
 */

import { InvoluteGear, GearTrain, GearStage } from './gear-physics';

// ---------------------------------------------------------------------------
// Physical constants
// ---------------------------------------------------------------------------

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Power Spring (mainspring)
// ---------------------------------------------------------------------------

/** Configuration for a coiled mainspring. */
export interface PowerSpringConfig {
  /**
   * Torsional stiffness k (N·m / radian).
   * Typical watch mainspring: 0.001–0.01 N·m/rad.
   * Typical clockwork mechanism: 0.05–0.5 N·m/rad.
   */
  stiffness_Nm_per_rad: number;
  /**
   * Maximum wind angle θ_max (radians).
   * Typical watch: 25–40 rad (≈ 4–6.5 full turns).
   * Typical mantel clock: 50–100 rad.
   */
  maxWindAngle_rad: number;
  /**
   * Minimum useful wind angle θ_min (radians).
   * Below this angle the spring torque drops too low to drive the mechanism.
   * Typically 10–20 % of maxWindAngle.
   */
  minWindAngle_rad?: number;
}

/**
 * PowerSpring
 *
 * Models a coiled steel mainspring using Hooke's torsional spring law:
 *   τ(θ) = k · θ
 *
 * where τ is the output torque, k is the stiffness, and θ is the current
 * wind angle (remaining unwound from full wind).
 *
 * The torque is not perfectly linear in real springs (due to the barrel
 * and Maltese cross mechanism), but the linear model is accurate to ±15 %
 * and is the standard engineering approximation.
 */
export class PowerSpring {
  readonly config: Required<PowerSpringConfig>;
  private _currentWind_rad: number;

  constructor(config: PowerSpringConfig) {
    if (config.stiffness_Nm_per_rad <= 0) {
      throw new RangeError('PowerSpring: stiffness must be > 0');
    }
    if (config.maxWindAngle_rad <= 0) {
      throw new RangeError('PowerSpring: maxWindAngle_rad must be > 0');
    }
    this.config = {
      stiffness_Nm_per_rad: config.stiffness_Nm_per_rad,
      maxWindAngle_rad:     config.maxWindAngle_rad,
      minWindAngle_rad:     config.minWindAngle_rad ?? config.maxWindAngle_rad * 0.15,
    };
    this._currentWind_rad = this.config.maxWindAngle_rad;
  }

  /** Wind the spring to full tension (θ = θ_max). */
  wind(): void {
    this._currentWind_rad = this.config.maxWindAngle_rad;
  }

  /**
   * Wind to a fractional level (0 = empty, 1 = full).
   * @param fraction  0.0 to 1.0
   */
  windTo(fraction: number): void {
    const f = Math.max(0, Math.min(1, fraction));
    this._currentWind_rad = f * this.config.maxWindAngle_rad;
  }

  /**
   * Release energy — unwind by dθ radians.
   * Returns the torque at the mid-point of the release.
   * @param delta_rad  Angle to unwind (> 0).
   */
  release(delta_rad: number): number {
    const θ_before = this._currentWind_rad;
    this._currentWind_rad = Math.max(0, θ_before - delta_rad);
    const θ_mid = (θ_before + this._currentWind_rad) / 2;
    return this.torque_Nm(θ_mid);
  }

  /** Current output torque (N·m). */
  torque_Nm(windAngle_rad = this._currentWind_rad): number {
    return this.config.stiffness_Nm_per_rad * windAngle_rad;
  }

  /** Remaining wind fraction (0 = empty, 1 = full). */
  get windFraction(): number {
    return this._currentWind_rad / this.config.maxWindAngle_rad;
  }

  /** True if the spring has enough tension to drive the mechanism. */
  get hasPower(): boolean {
    return this._currentWind_rad > this.config.minWindAngle_rad;
  }

  /**
   * storedEnergy_J
   *
   * Total energy stored in the spring at the current wind level.
   *   E = (1/2) · k · θ²
   */
  get storedEnergy_J(): number {
    return 0.5 * this.config.stiffness_Nm_per_rad * this._currentWind_rad ** 2;
  }

  /**
   * maxRuntime_s
   *
   * Estimates how long the mechanism can run before the spring power drops
   * below minimum, given the power drawn per second.
   *
   * @param powerDraw_W  Average power consumption of the mechanism (Watts).
   */
  maxRuntime_s(powerDraw_W: number): number {
    if (powerDraw_W <= 0) return Infinity;
    const usableEnergy = this.storedEnergy_J -
      0.5 * this.config.stiffness_Nm_per_rad * this.config.minWindAngle_rad ** 2;
    return Math.max(0, usableEnergy / powerDraw_W);
  }
}

// ---------------------------------------------------------------------------
// Oscillator (balance wheel / pendulum)
// ---------------------------------------------------------------------------

/** Configuration for a harmonic oscillator (balance wheel or pendulum). */
export interface OscillatorConfig {
  /**
   * Moment of inertia I (kg·m²).
   * Watch balance wheel: ≈ 1e-8 to 1e-6 kg·m².
   * Pendulum clock (1 kg, 0.25 m):  ≈ 0.0625 kg·m².
   */
  momentOfInertia_kg_m2: number;
  /**
   * Restoring spring rate k_s (N·m / radian).
   * Balance wheel hairspring: ≈ 1e-5 to 1e-3 N·m/rad.
   * Pendulum: effective k_s = m·g·L where L = pendulum length.
   */
  springRate_Nm_per_rad: number;
  /**
   * Damping coefficient c (N·m·s / radian).
   * In a well-made escapement, damping is very low (Q ≈ 100–300).
   * Default: 0 (ideal, no damping).
   */
  damping_Nm_s_per_rad?: number;
  /**
   * Amplitude of oscillation (radians).
   * Watch balance wheel typical amplitude: π/6 to π/2 rad (30°–90°).
   * Default: π/4 rad (45°).
   */
  amplitude_rad?: number;
}

/**
 * Oscillator
 *
 * A simple harmonic oscillator providing the isochronous time reference
 * for the clockwork mechanism.
 *
 * Natural frequency:  ω₀ = sqrt(k_s / I)    (rad/s)
 * Period:             T  = 2π / ω₀           (seconds)
 * Frequency:          f  = ω₀ / 2π           (Hz)
 * Quality factor:     Q  = ω₀ · I / c
 *
 * For a pendulum: ω₀ = sqrt(g / L)  (small angle approximation, g = 9.81 m/s²)
 */
export class Oscillator {
  readonly config: Required<OscillatorConfig>;
  private _phase_rad = 0;
  private _elapsedTime_s = 0;

  constructor(config: OscillatorConfig) {
    this.config = {
      momentOfInertia_kg_m2:    config.momentOfInertia_kg_m2,
      springRate_Nm_per_rad:    config.springRate_Nm_per_rad,
      damping_Nm_s_per_rad:     config.damping_Nm_s_per_rad  ?? 0,
      amplitude_rad:            config.amplitude_rad         ?? Math.PI / 4,
    };
  }

  /** Natural angular frequency ω₀ = sqrt(k_s / I)  (rad/s). */
  get naturalFrequency_rad_s(): number {
    return Math.sqrt(this.config.springRate_Nm_per_rad / this.config.momentOfInertia_kg_m2);
  }

  /** Natural period T = 2π / ω₀  (seconds). */
  get period_s(): number {
    return TWO_PI / this.naturalFrequency_rad_s;
  }

  /** Oscillation frequency f = 1/T  (Hz, i.e., complete cycles per second). */
  get frequency_Hz(): number {
    return 1 / this.period_s;
  }

  /**
   * Beat frequency (ticks per second).
   * Each beat = one half-oscillation (one lock/release of the escapement).
   */
  get beatFrequency_Hz(): number {
    return this.frequency_Hz * 2;
  }

  /**
   * Quality factor Q = ω₀ · I / c
   * Higher Q = less energy dissipated per cycle = longer runtime.
   * Q < 10 : heavily damped.  Q > 100 : precision timekeeper.
   */
  get qualityFactor(): number {
    const c = this.config.damping_Nm_s_per_rad;
    if (c === 0) return Infinity;
    return (this.naturalFrequency_rad_s * this.config.momentOfInertia_kg_m2) / c;
  }

  /**
   * position_rad
   *
   * Returns the angular position of the oscillator at time t (seconds):
   *   θ(t) = A · exp(−γt) · cos(ω_d · t + φ₀)
   *
   * where γ = c/(2I) and ω_d = sqrt(ω₀² − γ²)  (damped natural frequency).
   *
   * @param t  Absolute time in seconds.
   */
  position_rad(t: number): number {
    const I  = this.config.momentOfInertia_kg_m2;
    const c  = this.config.damping_Nm_s_per_rad;
    const ω₀ = this.naturalFrequency_rad_s;
    const A  = this.config.amplitude_rad;

    const γ  = c / (2 * I);
    const ω_d = Math.sqrt(Math.max(0, ω₀ ** 2 - γ ** 2));

    return A * Math.exp(-γ * t) * Math.cos(ω_d * t);
  }

  /**
   * ticksInInterval
   *
   * Counts how many zero-crossings (beats) occur in a given time interval.
   * Each zero-crossing = one escapement tick.
   *
   * @param startTime_s  Interval start (seconds from t=0).
   * @param duration_s   Interval duration (seconds).
   */
  ticksInInterval(startTime_s: number, duration_s: number): number {
    // Each beat is T/2, so ticks = duration / (T/2) = duration × 2f
    return Math.floor(duration_s * this.beatFrequency_Hz);
  }

  /** Advance the internal time counter by dt seconds. */
  advance(dt_s: number): void {
    this._elapsedTime_s += dt_s;
  }

  /** Current oscillator position (rad) based on internal elapsed time. */
  get currentPosition_rad(): number {
    return this.position_rad(this._elapsedTime_s);
  }
}

// ---------------------------------------------------------------------------
// Escape wheel
// ---------------------------------------------------------------------------

/** Configuration for the escape wheel. */
export interface EscapeWheelConfig {
  /** Number of teeth on the escape wheel. */
  teeth: number;
  /**
   * The module of the escape wheel's involute tooth profile (mm).
   * Smaller = finer, more delicate escapement.
   */
  module_mm: number;
  /** Pressure angle (degrees). Default: 15° (escape wheels use shallower angles). */
  pressureAngle_deg?: number;
  /**
   * Recoil angle (degrees) — the small backward rotation of the escape wheel
   * during the locking phase of a recoil anchor escapement.
   * 0° = detent/dead-beat escapement; 2°–5° = recoil anchor.
   */
  recoilAngle_deg?: number;
}

/**
 * EscapeWheel
 *
 * The escape wheel is the final gear in the clockwork train.  Its teeth
 * interact with the pallet fork to control the release of energy.
 *
 * Each "tick" advances the escape wheel by exactly one tooth.
 * One full revolution = `teeth` ticks.
 */
export class EscapeWheel {
  readonly gear: InvoluteGear;
  readonly recoilAngle_rad: number;
  private _position_rad = 0;      // current angular position
  private _totalTicks   = 0;

  constructor(config: EscapeWheelConfig) {
    this.gear = new InvoluteGear({
      teeth:             config.teeth,
      module:            config.module_mm,
      pressureAngle_deg: config.pressureAngle_deg ?? 15,
    });
    this.recoilAngle_rad = ((config.recoilAngle_deg ?? 3) * Math.PI) / 180;
  }

  /** Angle advanced per tick (one tooth pitch) in radians. */
  get anglePerTick_rad(): number {
    return TWO_PI / this.gear.geometry.teeth;
  }

  /**
   * tick
   *
   * Advance the escape wheel by one tooth (one tick).
   * Returns the net angular advance in radians.
   *
   * In a recoil escapement, the wheel first advances by (anglePerTick + recoilAngle)
   * during the impulse phase, then recoils by recoilAngle during locking.
   * Net advance = exactly one tooth pitch.
   */
  tick(): number {
    const advance = this.anglePerTick_rad;
    this._position_rad += advance;
    this._totalTicks++;
    return advance;
  }

  /** Total accumulated ticks (tooth advances). */
  get totalTicks(): number { return this._totalTicks; }

  /** Current angular position (radians, cumulative). */
  get position_rad(): number { return this._position_rad; }

  /** Number of complete revolutions. */
  get revolutions(): number {
    return this._totalTicks / this.gear.geometry.teeth;
  }

  reset(): void {
    this._position_rad = 0;
    this._totalTicks   = 0;
  }
}

// ---------------------------------------------------------------------------
// Pallet fork
// ---------------------------------------------------------------------------

/** Configuration for the pallet fork (anchor). */
export interface PalletForkConfig {
  /**
   * Entry and exit pallet angles (degrees) — the angular span of each pallet
   * stone measured from the fork pivot.
   */
  entryPalletAngle_deg: number;
  exitPalletAngle_deg:  number;
  /**
   * Lock face angle (degrees) — the angle of the locking face relative to
   * the escape wheel radius.  Determines the draw and lock.
   */
  lockAngle_deg: number;
  /**
   * Impulse face angle (degrees) — the angle of the impulse face.
   * Determines how efficiently impulse is delivered to the oscillator.
   */
  impulseAngle_deg: number;
}

/** State of the pallet fork at a given instant. */
export type ForkState = 'entry_locked' | 'exit_locked' | 'in_motion';

/**
 * PalletFork
 *
 * The pallet fork alternately locks and releases the escape wheel in response
 * to the oscillator's beat.  In one full oscillation of the balance wheel:
 *   1. Entry pallet releases → escape wheel advances half-tooth
 *   2. Exit pallet locks     → escape wheel stops
 *   3. Exit pallet releases  → escape wheel advances half-tooth
 *   4. Entry pallet locks    → escape wheel stops
 *
 * The fork also delivers a small impulse to the balance wheel at each beat,
 * compensating for energy lost to friction.
 */
export class PalletFork {
  readonly config: PalletForkConfig;
  private _state: ForkState = 'entry_locked';
  private _beatCount = 0;

  constructor(config: PalletForkConfig) {
    this.config = config;
  }

  get state(): ForkState { return this._state; }
  get beatCount(): number { return this._beatCount; }

  /**
   * beat
   *
   * Processes one beat from the oscillator.
   * Returns the impulse torque delivered to the oscillator (N·m).
   *
   * @param escapeWheel  The escape wheel to advance on unlock.
   * @param impulse_Nm   Available impulse torque from the spring (via gear train).
   */
  beat(escapeWheel: EscapeWheel, impulse_Nm: number): number {
    this._beatCount++;

    switch (this._state) {
      case 'entry_locked':
        escapeWheel.tick();           // unlock: advance one full tooth
        this._state = 'exit_locked';
        break;
      case 'exit_locked':
        escapeWheel.tick();
        this._state = 'entry_locked';
        break;
      case 'in_motion':
        this._state = 'entry_locked';
        break;
    }

    // Return a fraction of impulse (impulse face efficiency ≈ 0.85–0.95)
    const impulseEfficiency =
      Math.sin((this.config.impulseAngle_deg * Math.PI) / 180);
    return impulse_Nm * impulseEfficiency * 0.90;
  }
}

// ---------------------------------------------------------------------------
// Clockwork assembly
// ---------------------------------------------------------------------------

/** Configuration for the complete clockwork mechanism. */
export interface ClockworkConfig {
  spring:        PowerSpring;
  oscillator:    Oscillator;
  /** Number of teeth on the escape wheel. */
  escapeTeeth:   number;
  /**
   * Total gear ratio from mainspring barrel to escape wheel.
   * Typical clock: 3000–7000:1 (a 1 rpm barrel → ~60 rpm escape wheel at 60 teeth
   * = 60 ticks/revolution × 1 rev/s = 60 ticks/s for 30 BPH).
   * Typical watch: 10,000–50,000:1.
   */
  totalRatio:    number;
  /**
   * Barrel module (mm) — gear size at the mainspring output.
   * Used to compute the actual gear train stages.
   */
  barrelModule_mm?: number;
  /**
   * Recoil angle of the escapement (degrees).
   * Default: 3° (standard English lever escapement recoil).
   */
  recoilAngle_deg?: number;
}

/** Result of simulating the clockwork for a given duration. */
export interface ClockworkSimResult {
  /** Duration simulated (seconds). */
  duration_s: number;
  /** Total escapement ticks (individual tooth advances). */
  elapsedTicks: number;
  /** Elapsed real-clock time implied by the oscillator (seconds). */
  impliedTime_s: number;
  /** Timing error (seconds — positive = fast, negative = slow). */
  timingError_s: number;
  /**
   * Timing error in parts per million (ppm).
   * < 100 ppm: reasonable consumer clock
   * < 10 ppm:  good mechanical clock
   * < 1 ppm:   precision-grade (COSC chronometer standard is ±4 ppm)
   */
  timingError_ppm: number;
  /** Remaining spring wind fraction (0 = empty, 1 = full). */
  remainingWindFraction: number;
  /** Average power draw (Watts). */
  avgPowerDraw_W: number;
  /** Beat frequency actually achieved (Hz). */
  achievedBeatFrequency_Hz: number;
  /** Whether the mechanism ran out of power during the simulation. */
  ranOutOfPower: boolean;
}

/**
 * Clockwork
 *
 * Top-level clockwork mechanism assembly.  Ties together:
 *   PowerSpring → GearTrain → EscapeWheel ↔ PalletFork ← Oscillator
 *
 * The simulate() method steps through time tick-by-tick, computing the
 * energy balance, timing accuracy, and mechanism state.
 */
export class Clockwork {
  readonly spring:      PowerSpring;
  readonly oscillator:  Oscillator;
  readonly escapeWheel: EscapeWheel;
  readonly palletFork:  PalletFork;
  readonly gearTrain:   GearTrain;

  constructor(config: ClockworkConfig) {
    this.spring      = config.spring;
    this.oscillator  = config.oscillator;

    this.escapeWheel = new EscapeWheel({
      teeth:             config.escapeTeeth,
      module_mm:         config.barrelModule_mm ?? 0.3,
      recoilAngle_deg:   config.recoilAngle_deg ?? 3,
    });

    this.palletFork = new PalletFork({
      entryPalletAngle_deg: 10,
      exitPalletAngle_deg:  10,
      lockAngle_deg:        4,
      impulseAngle_deg:     45,
    });

    // Build a representative 3-stage gear train to achieve the total ratio.
    // Distribute ratio as cube root per stage (≈ equal stages).
    this.gearTrain = Clockwork._buildTrain(config.totalRatio, config.barrelModule_mm ?? 1.0);
  }

  /** Build an approximately equal 3-stage gear train for the given ratio. */
  private static _buildTrain(totalRatio: number, barrelModule_mm: number): GearTrain {
    const stageRatio = Math.cbrt(totalRatio);
    const stages: GearStage[] = [];

    for (let s = 0; s < 3; s++) {
      const N_driver = Math.max(8, Math.round(12));
      const N_driven = Math.max(8, Math.round(N_driver * stageRatio));
      const m        = barrelModule_mm / (s + 1);   // shrink module each stage

      stages.push({
        driver: new InvoluteGear({ teeth: N_driver, module: Math.max(0.3, m) }),
        driven: new InvoluteGear({ teeth: N_driven, module: Math.max(0.3, m) }),
        efficiency: 0.98,
      });
    }
    return new GearTrain(stages);
  }

  /**
   * simulate
   *
   * Runs a discrete-event simulation of the clockwork for a given duration.
   * Each simulation step corresponds to one oscillator beat (half-period).
   *
   * @param params.durationSeconds  How long to simulate (seconds).
   * @param params.windLevel        Initial spring wind level (0–1, default 1.0 = full).
   */
  simulate(params: { durationSeconds: number; windLevel?: number }): ClockworkSimResult {
    const { durationSeconds, windLevel = 1.0 } = params;

    this.spring.windTo(windLevel);
    this.escapeWheel.reset();
    this.oscillator.advance(0);

    const beatPeriod_s    = this.oscillator.period_s / 2;
    const totalBeats      = Math.floor(durationSeconds / beatPeriod_s);
    const anglePerRelease = this.escapeWheel.anglePerTick_rad;

    let totalTicks = 0;
    let totalEnergy_J = 0;
    let ranOutOfPower = false;

    // Energy released per tick: the gear train delivers torque to escape wheel.
    // Power = τ_spring × ω_barrel.  Per tick, energy = τ × angle_per_tick / ratio.
    const { total_ratio, overall_efficiency } = this.gearTrain.analyze(1, 1);

    for (let beat = 0; beat < totalBeats; beat++) {
      if (!this.spring.hasPower) {
        ranOutOfPower = true;
        break;
      }

      // Spring unwinds by one tooth's worth of barrel rotation per tick
      const barrelAngle_per_tick = anglePerRelease / total_ratio;
      const τ = this.spring.release(barrelAngle_per_tick);

      // Energy delivered to oscillator
      const energy_J = τ * barrelAngle_per_tick * overall_efficiency;
      totalEnergy_J += energy_J;

      // Advance escape wheel via pallet fork
      this.palletFork.beat(this.escapeWheel, τ * overall_efficiency);
      totalTicks++;
    }

    const impliedTime_s   = totalTicks * beatPeriod_s;
    const timingError_s   = impliedTime_s - durationSeconds;
    const timingError_ppm = durationSeconds > 0
      ? (timingError_s / durationSeconds) * 1e6
      : 0;
    const avgPowerDraw_W = durationSeconds > 0 ? totalEnergy_J / durationSeconds : 0;

    return {
      duration_s:               durationSeconds,
      elapsedTicks:             totalTicks,
      impliedTime_s,
      timingError_s,
      timingError_ppm,
      remainingWindFraction:    this.spring.windFraction,
      avgPowerDraw_W,
      achievedBeatFrequency_Hz: totalTicks / durationSeconds,
      ranOutOfPower,
    };
  }

  /**
   * handAngles
   *
   * Returns the angular positions of the second, minute, and hour hands
   * for a given elapsed tick count.
   *
   * The second hand advances once per two ticks (one full oscillation).
   * Minute and hour hands are computed from gear ratios:
   *   seconds hand : 1 tick = 1/2 oscillation = 1 second
   *   minutes hand : 1/60 of seconds hand speed
   *   hours hand   : 1/720 of seconds hand speed
   *
   * @param ticks  Total accumulated ticks from escapeWheel.totalTicks.
   * @returns      Angles in radians (0 = 12-o'clock position).
   */
  handAngles(ticks: number): { seconds: number; minutes: number; hours: number } {
    const beatFreq = this.oscillator.beatFrequency_Hz;
    const totalSeconds = ticks / beatFreq;

    return {
      seconds: ((totalSeconds % 60)   / 60)    * TWO_PI,
      minutes: ((totalSeconds % 3600) / 3600)  * TWO_PI,
      hours:   ((totalSeconds % 43200)/ 43200) * TWO_PI,
    };
  }

  /**
   * promptDescriptor
   *
   * Returns a ComfyUI-ready prompt fragment describing the clockwork mechanism's
   * visual appearance for use in animation frame prompts.
   */
  promptDescriptor(): string {
    const N = this.escapeWheel.gear.geometry.teeth;
    const T = this.oscillator.period_s.toFixed(3);
    const Q = this.oscillator.qualityFactor.toFixed(0);
    const stages = this.gearTrain.stages.length;

    return (
      `intricate mechanical clockwork, ${N}-tooth escape wheel, ${stages}-stage gear train, ` +
      `oscillating balance wheel period ${T}s Q-factor ${Q}, ` +
      `polished brass gears with involute tooth profiles, ` +
      `mainspring barrel visible, jewelled pivot bearings, ` +
      `precision-engraved steel, studio macro lighting`
    );
  }
}

// ---------------------------------------------------------------------------
// Clockwork preset configurations
// ---------------------------------------------------------------------------

/** Factory: create a standard mantel clock mechanism. */
export function createMantelClock(): Clockwork {
  return new Clockwork({
    spring:      new PowerSpring({ stiffness_Nm_per_rad: 0.05, maxWindAngle_rad: 60 }),
    oscillator:  new Oscillator({
      momentOfInertia_kg_m2: 0.001,
      springRate_Nm_per_rad:  0.001,
      amplitude_rad:          Math.PI / 6,
    }),
    escapeTeeth:      30,
    totalRatio:       3600,
    barrelModule_mm:  2.0,
    recoilAngle_deg:  3,
  });
}

/** Factory: create a precision pocket-watch mechanism. */
export function createPocketWatch(): Clockwork {
  return new Clockwork({
    spring:      new PowerSpring({ stiffness_Nm_per_rad: 0.002, maxWindAngle_rad: 35 }),
    oscillator:  new Oscillator({
      momentOfInertia_kg_m2: 2e-7,
      springRate_Nm_per_rad:  2e-5,
      damping_Nm_s_per_rad:   5e-9,
      amplitude_rad:          Math.PI / 3,
    }),
    escapeTeeth:      15,
    totalRatio:       14400,
    barrelModule_mm:  0.15,
    recoilAngle_deg:  2,
  });
}

/** Factory: create a giant cartoon "grandfather clock" mechanism. */
export function createGrandFatherClock(): Clockwork {
  // Pendulum equivalent: T = 2π√(L/g) → L = (T/2π)²·g
  // For T = 2s: L = (2/2π)² × 9.81 ≈ 0.993 m (the "one-second" pendulum)
  const g = 9.81;
  const T_pendulum = 2.0;         // 2-second period (ticks every second)
  const L = ((T_pendulum / TWO_PI) ** 2) * g;
  const m_pendulum = 2.0;         // 2 kg bob
  const I_pendulum = m_pendulum * L ** 2;
  const k_s        = m_pendulum * g * L;   // effective spring rate

  return new Clockwork({
    spring:      new PowerSpring({ stiffness_Nm_per_rad: 0.5, maxWindAngle_rad: 120 }),
    oscillator:  new Oscillator({
      momentOfInertia_kg_m2: I_pendulum,
      springRate_Nm_per_rad:  k_s,
      amplitude_rad:          0.10,   // ≈ 5.7° — small-angle for accuracy
    }),
    escapeTeeth:      30,
    totalRatio:       7200,
    barrelModule_mm:  3.0,
    recoilAngle_deg:  4,
  });
}
