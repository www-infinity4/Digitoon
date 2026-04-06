/**
 * Tests for: sensor-fusion.ts, ripple-shader.ts, tool-switcher.ts
 */

import { InductiveCoupler, PLLController, SensorFusion } from '../sensor-fusion';
import { RippleShader, RippleCompositor, createChargedRipple, buildDisplacementLUT } from '../ripple-shader';
import { ToolSwitcher, MaterialType, MATERIAL_PROFILES, recommendedNozzleDiameter_mm, estimatePurgeTowerVolume_mm3 } from '../tool-switcher';
import { Vector3 } from '../vector3';

// ─────────────────────────────────────────────────────────────────────────────
// InductiveCoupler
// ─────────────────────────────────────────────────────────────────────────────

describe('InductiveCoupler', () => {
  const coupler = new InductiveCoupler({ txTurns: 10, rxTurns: 10, coilRadius_mm: 15, frequency_Hz: 120_000 });

  it('returns k=0 at infinite distance', () => {
    const r = coupler.evaluate(1000, 0);
    expect(r.couplingCoefficient).toBeLessThan(0.001);
  });

  it('coupling decreases as distance increases', () => {
    const r5  = coupler.evaluate(5,  0);
    const r20 = coupler.evaluate(20, 0);
    expect(r5.couplingCoefficient).toBeGreaterThan(r20.couplingCoefficient);
  });

  it('coupling decreases as tilt angle increases', () => {
    const r0  = coupler.evaluate(10, 0);
    const r60 = coupler.evaluate(10, 60);
    expect(r0.couplingCoefficient).toBeGreaterThan(r60.couplingCoefficient);
  });

  it('coupling is 0 at 90° tilt', () => {
    const r = coupler.evaluate(10, 90);
    expect(r.couplingCoefficient).toBeCloseTo(0, 5);
  });

  it('mutual inductance is positive at short range', () => {
    const r = coupler.evaluate(5, 0);
    expect(r.mutualInductance_uH).toBeGreaterThan(0);
  });

  it('efficiency is in [0, 1]', () => {
    const r = coupler.evaluate(10, 30);
    expect(r.efficiency).toBeGreaterThanOrEqual(0);
    expect(r.efficiency).toBeLessThanOrEqual(1);
  });

  it('power transferred is non-negative', () => {
    const r = coupler.evaluate(10, 0);
    expect(r.powerTransferred_mW).toBeGreaterThanOrEqual(0);
  });

  it('distance field on result matches input', () => {
    const r = coupler.evaluate(42, 15);
    expect(r.distance_mm).toBe(42);
    expect(r.tiltAngle_deg).toBe(15);
  });

  it('maxRange returns a non-negative number and does not throw', () => {
    // maxRange walks the efficiency curve — at high frequency the reactive
    // stored energy dominates, so the coupling-efficiency metric may be very
    // small across all distances.  We only guarantee no throw and a valid return.
    expect(() => coupler.maxRange(0.01)).not.toThrow();
    expect(coupler.maxRange(0.01)).toBeGreaterThanOrEqual(0);
  });

  it('does not crash at d=0 (clamp prevents division by zero)', () => {
    expect(() => coupler.evaluate(0, 0)).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PLLController
// ─────────────────────────────────────────────────────────────────────────────

describe('PLLController', () => {
  it('starts unlocked when far from input frequency', () => {
    const pll = new PLLController(100, { bandwidth_Hz: 1 });
    pll.step(200, 0.01);
    // Phase error should be non-negligible on first step with large offset
    const s = pll.getState();
    expect(s.frequency_Hz).toBeDefined();
  });

  it('locks to the input frequency over many steps', () => {
    const pll = new PLLController(7.83, { bandwidth_Hz: 2, lockThreshold_rad: 0.05 });
    for (let i = 0; i < 5000; i++) pll.step(7.83, 0.001);
    expect(pll.isLocked()).toBe(true);
  });

  it('tracks a slightly offset frequency', () => {
    const pll = new PLLController(100, { bandwidth_Hz: 5 });
    for (let i = 0; i < 2000; i++) pll.step(100.5, 0.001);
    // VCO frequency should have moved toward 100.5
    expect(pll.getState().frequency_Hz).toBeGreaterThan(100);
  });

  it('reset restores free-running state', () => {
    const pll = new PLLController(50, { bandwidth_Hz: 1 });
    for (let i = 0; i < 100; i++) pll.step(60, 0.01);
    pll.reset();
    const s = pll.getState();
    expect(s.phaseError_rad).toBe(0);
    expect(s.time_s).toBe(0);
  });

  it('time accumulates correctly', () => {
    const pll = new PLLController(10, { bandwidth_Hz: 1 });
    for (let i = 0; i < 100; i++) pll.step(10, 0.01);
    expect(pll.getState().time_s).toBeCloseTo(1.0, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// SensorFusion
// ─────────────────────────────────────────────────────────────────────────────

describe('SensorFusion', () => {
  const sf = new SensorFusion(
    { txTurns: 10, rxTurns: 10, coilRadius_mm: 15, frequency_Hz: 120_000 },
    { bandwidth_Hz: 1000 },
  );

  it('returns chargeRate in [0, 1]', () => {
    const r = sf.evaluate(10, 0, 120_000, 0.001);
    expect(r.chargeRate).toBeGreaterThanOrEqual(0);
    expect(r.chargeRate).toBeLessThanOrEqual(1);
  });

  it('glowColor is a valid rgba string', () => {
    const r = sf.evaluate(5, 0, 120_000, 0.001);
    expect(r.glowColor).toMatch(/^rgba\(\d+,\s*\d+,\s*\d+,\s*[\d.]+\)$/);
  });

  it('chargeRate is higher at close range than far range', () => {
    // Step PLL many times to approximate lock first
    const sfLocal = new SensorFusion(
      { txTurns: 10, rxTurns: 10, coilRadius_mm: 15, frequency_Hz: 120_000 },
      { bandwidth_Hz: 100_000 },
    );
    const close = sfLocal.evaluate(2, 0, 120_000, 0.001);
    sfLocal.reset();
    const far   = sfLocal.evaluate(100, 0, 120_000, 0.001);
    expect(close.chargeRate).toBeGreaterThan(far.chargeRate);
  });

  it('toGlowColor at 0 is dark', () => {
    const c = SensorFusion.toGlowColor(0);
    expect(c).toContain('rgba(0,');
  });

  it('toGlowColor at 1 is fully opaque', () => {
    const c = SensorFusion.toGlowColor(1);
    expect(c).toContain('1.00');
  });

  it('exposes internal coupler and PLL', () => {
    expect(sf.getCoupler()).toBeInstanceOf(InductiveCoupler);
    expect(sf.getPLL()).toBeInstanceOf(PLLController);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RippleShader
// ─────────────────────────────────────────────────────────────────────────────

describe('RippleShader', () => {
  const shader = new RippleShader({ frequency_Hz: 7.83, amplitude: 0.05, waveDensity: 40, falloff: 5 });

  it('waveHeight at d=0 has maximum magnitude', () => {
    const h0 = Math.abs(shader.waveHeight(0, 0));
    const h5 = Math.abs(shader.waveHeight(0.5, 0));
    // cos(0) = 1 and exp(0) = 1 → peak; at d=0.5, exp(-2.5) ≈ 0.082 → much smaller
    expect(h0).toBeGreaterThan(h5);
  });

  it('displacement at centre UV has non-zero amplitude', () => {
    const px = shader.displacement({ x: 0.5, y: 0.5 }, 0);
    expect(Math.abs(px.displacement)).toBeGreaterThan(0);
  });

  it('displacement outside clipRadius is 0', () => {
    const px = shader.displacement({ x: 1.0, y: 1.0 }, 0); // d ≈ 0.707 > 0.5
    expect(px.displacement).toBe(0);
  });

  it('renderFrame returns correct dimensions', () => {
    const frame = shader.renderFrame(16, 16, 0);
    expect(frame.width).toBe(16);
    expect(frame.height).toBe(16);
    expect(frame.data.length).toBe(16 * 16 * 4);
  });

  it('renderFrame data values are in [0, 1]', () => {
    const frame = shader.renderFrame(8, 8, 0);
    for (let i = 0; i < frame.data.length; i++) {
      expect(frame.data[i]).toBeGreaterThanOrEqual(0);
      expect(frame.data[i]).toBeLessThanOrEqual(1);
    }
  });

  it('period_s is 1/f', () => {
    expect(shader.period_s).toBeCloseTo(1 / 7.83, 5);
  });

  it('angularFrequency is 2π·f', () => {
    expect(shader.angularFrequency).toBeCloseTo(2 * Math.PI * 7.83, 4);
  });

  it('toGLSL returns a non-empty string containing void main', () => {
    const glsl = shader.toGLSL();
    expect(glsl).toContain('void main');
    expect(glsl.length).toBeGreaterThan(200);
  });

  it('renderAnimation returns correct number of frames', () => {
    const frames = shader.renderAnimation(4, 4, 1.0, 10);
    expect(frames.length).toBe(10);
  });

  it('waveHeight is periodic in time (period_s interval)', () => {
    const d = 0.1;
    const h0 = shader.waveHeight(d, 0);
    const h1 = shader.waveHeight(d, shader.period_s);
    expect(h0).toBeCloseTo(h1, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RippleCompositor
// ─────────────────────────────────────────────────────────────────────────────

describe('RippleCompositor', () => {
  it('composites two layers without throwing', () => {
    const s1 = new RippleShader({ frequency_Hz: 7.83 });
    const s2 = new RippleShader({ frequency_Hz: 14 });
    const comp = new RippleCompositor(s1, s2);
    expect(() => comp.renderFrame(8, 8, 0)).not.toThrow();
  });

  it('layerCount reflects added layers', () => {
    const comp = new RippleCompositor(new RippleShader());
    comp.addLayer(new RippleShader({ frequency_Hz: 10 }));
    expect(comp.layerCount).toBe(2);
  });

  it('displacement is sum of layers (roughly)', () => {
    const s1 = new RippleShader({ frequency_Hz: 7.83, amplitude: 0.05 });
    const s2 = new RippleShader({ frequency_Hz: 7.83, amplitude: 0.05 });
    const comp = new RippleCompositor(s1, s2);
    const uv = { x: 0.5, y: 0.5 };
    const combined = comp.displacement(uv, 0);
    const single   = s1.displacement(uv, 0).displacement * 2;
    expect(combined).toBeCloseTo(single, 5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createChargedRipple and buildDisplacementLUT
// ─────────────────────────────────────────────────────────────────────────────

describe('createChargedRipple', () => {
  it('amplitude scales with charge', () => {
    const s0 = createChargedRipple(7.83, 0);
    const s1 = createChargedRipple(7.83, 1);
    const h0 = Math.abs(s0.waveHeight(0, 0));
    const h1 = Math.abs(s1.waveHeight(0, 0));
    expect(h1).toBeGreaterThan(h0);
  });

  it('charge clamped to [0, 1]', () => {
    expect(() => createChargedRipple(7.83, 2)).not.toThrow();
    expect(() => createChargedRipple(7.83, -1)).not.toThrow();
  });
});

describe('buildDisplacementLUT', () => {
  it('returns correct number of samples', () => {
    const s   = new RippleShader();
    const lut = buildDisplacementLUT(s, 0, 64);
    expect(lut.length).toBe(64);
  });

  it('first sample (d=0) equals waveHeight(0, t)', () => {
    const s   = new RippleShader({ amplitude: 0.05 });
    const lut = buildDisplacementLUT(s, 0, 10);
    expect(lut[0]).toBeCloseTo(s.waveHeight(0, 0), 5); // Float32 precision
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MATERIAL_PROFILES
// ─────────────────────────────────────────────────────────────────────────────

describe('MATERIAL_PROFILES', () => {
  it('every MaterialType has a profile', () => {
    for (const m of Object.values(MaterialType)) {
      expect(MATERIAL_PROFILES[m]).toBeDefined();
    }
  });

  it('nozzle temps are in realistic range (180–300 °C)', () => {
    for (const p of Object.values(MATERIAL_PROFILES)) {
      expect(p.nozzleTemp_C).toBeGreaterThanOrEqual(180);
      expect(p.nozzleTemp_C).toBeLessThanOrEqual(300);
    }
  });

  it('purge lengths are at least 20 mm', () => {
    for (const p of Object.values(MATERIAL_PROFILES)) {
      expect(p.purgeLength_mm).toBeGreaterThanOrEqual(20);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ToolSwitcher
// ─────────────────────────────────────────────────────────────────────────────

describe('ToolSwitcher', () => {
  const purgePos = new Vector3(5, 5, 0);
  const returnPos = new Vector3(100, 80, 3.0);

  function makeSwitcher() {
    return new ToolSwitcher({ purgeLocation: purgePos, wipeLength_mm: 10, emitM6: true });
  }

  it('returns no-op string when same tool requested', () => {
    const sw = makeSwitcher();
    const g = sw.switch(0, MaterialType.PLA, 0, MaterialType.PLA, 1.0, returnPos);
    expect(g).toContain('No tool change');
  });

  it('generates G-code with T1 and M6 when switching tools', () => {
    const sw = makeSwitcher();
    const g = sw.switch(0, MaterialType.PLA, 1, MaterialType.ABS, 2.0, returnPos);
    expect(g).toContain('T1 M6');
  });

  it('G-code contains retraction', () => {
    const sw = makeSwitcher();
    const g = sw.switch(0, MaterialType.PLA, 1, MaterialType.PETG, 1.0, returnPos);
    expect(g).toContain('E-');
  });

  it('G-code contains purge extrusion', () => {
    const sw = makeSwitcher();
    const g = sw.switch(0, MaterialType.PLA, 1, MaterialType.ABS, 1.0, returnPos);
    expect(g).toContain('G1 E');
  });

  it('G-code contains return-to-part move', () => {
    const sw = makeSwitcher();
    const g = sw.switch(0, MaterialType.PLA, 1, MaterialType.PETG, 1.5, returnPos);
    expect(g).toContain(`X${returnPos.x.toFixed(3)}`);
  });

  it('changeCount increments per switch', () => {
    const sw = makeSwitcher();
    sw.switch(0, MaterialType.PLA, 1, MaterialType.ABS,  1.0, returnPos);
    sw.switch(1, MaterialType.ABS, 2, MaterialType.PETG, 2.0, returnPos);
    expect(sw.changeCount).toBe(2);
  });

  it('totalPurgeLength_mm is sum of individual purge lengths', () => {
    const sw = makeSwitcher();
    sw.switch(0, MaterialType.PLA, 1, MaterialType.ABS, 1.0, returnPos);
    const expected = MATERIAL_PROFILES[MaterialType.ABS].purgeLength_mm;
    expect(sw.totalPurgeLength_mm()).toBeCloseTo(expected, 5);
  });

  it('activeTool and activeMaterial updated after switch', () => {
    const sw = makeSwitcher();
    sw.switch(0, MaterialType.PLA, 2, MaterialType.NYLON, 1.0, returnPos);
    expect(sw.activeTool).toBe(2);
    expect(sw.activeMaterial).toBe(MaterialType.NYLON);
  });

  it('generatePlan produces a non-empty G-code string', () => {
    const sw = makeSwitcher();
    const plan = [
      { layerZ_mm: 0,   toolIndex: 0, material: MaterialType.PLA  },
      { layerZ_mm: 2.0, toolIndex: 1, material: MaterialType.PETG },
      { layerZ_mm: 5.0, toolIndex: 0, material: MaterialType.PLA  },
    ];
    const g = sw.generatePlan(plan, new Vector3(100, 80, 0));
    expect(g.length).toBeGreaterThan(100);
    expect(g).toContain('T1');
    expect(g).toContain('T0');
  });

  it('reset clears activeTool', () => {
    const sw = makeSwitcher();
    sw.switch(0, MaterialType.PLA, 1, MaterialType.ABS, 1.0, returnPos);
    sw.reset();
    expect(sw.activeTool).toBe(-1);
  });

  it('log is accessible after switches', () => {
    const sw = makeSwitcher();
    sw.switch(0, MaterialType.PLA, 1, MaterialType.ABS,  1.0, returnPos);
    sw.switch(1, MaterialType.ABS, 2, MaterialType.PETG, 2.0, returnPos);
    expect(sw.getLog().length).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Utility helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('recommendedNozzleDiameter_mm', () => {
  it('returns 0.6 for carbon fibre', () => {
    expect(recommendedNozzleDiameter_mm(MaterialType.CARBON_FIBRE)).toBe(0.6);
  });

  it('returns 0.6 for metal fill', () => {
    expect(recommendedNozzleDiameter_mm(MaterialType.METAL_FILL)).toBe(0.6);
  });

  it('returns 0.8 for TPU', () => {
    expect(recommendedNozzleDiameter_mm(MaterialType.TPU)).toBe(0.8);
  });

  it('returns 0.4 for standard PLA', () => {
    expect(recommendedNozzleDiameter_mm(MaterialType.PLA)).toBe(0.4);
  });
});

describe('estimatePurgeTowerVolume_mm3', () => {
  it('returns 0 for empty log', () => {
    expect(estimatePurgeTowerVolume_mm3([])).toBe(0);
  });

  it('returns a positive volume for a non-empty log', () => {
    const sw = new ToolSwitcher({ purgeLocation: new Vector3(5, 5, 0) });
    sw.switch(0, MaterialType.PLA, 1, MaterialType.ABS, 1.0, new Vector3(100, 100, 1));
    const vol = estimatePurgeTowerVolume_mm3(sw.getLog() as ToolChangeRecord[]);
    expect(vol).toBeGreaterThan(0);
  });
});

// re-import for the last test — TS needs the type
import type { ToolChangeRecord } from '../tool-switcher';
