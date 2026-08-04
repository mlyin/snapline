/**
 * Monte Carlo pricing verification — port of verify_pricing.py assertions.
 * Quadrature touch-prob vs 60k-path MC; survival density vs MC; edge sanity.
 */
import { describe, expect, it } from "vitest";
import {
  mcSurvival,
  mcTouchProb,
  offered,
  startWindowProb,
  survivalCurve,
  touchProb,
  MON,
} from "../apps/engine/src/pricing.js";

describe("startWindowProb", () => {
  it("returns 1 when price is inside band", () => {
    expect(startWindowProb(100, 0.5, 5, 99, 101)).toBe(1);
  });

  it("returns lower prob when price is far from band", () => {
    const near = startWindowProb(100, 0.5, 5, 99, 101);
    const far = startWindowProb(120, 0.5, 5, 99, 101);
    expect(far).toBeLessThan(near);
  });
});

describe("touchProb quadrature vs Monte Carlo", () => {
  const cases = [
    { S: 100, sigma: 0.4, T1: 0, T2: 5, a: 98, b: 102 },
    { S: 100, sigma: 0.4, T1: 2, T2: 7, a: 97, b: 103 },
    { S: 105, sigma: 0.6, T1: 1, T2: 6, a: 100, b: 110 },
    { S: 95, sigma: 0.3, T1: 0, T2: 10, a: 94, b: 96 },
    { S: 100, sigma: 0.8, T1: 3, T2: 8, a: 99, b: 101 },
  ];

  for (const c of cases) {
    it(`matches MC within 0.005 for S=${c.S} σ=${c.sigma}`, () => {
      const q = touchProb(c.S, c.sigma, c.T1, c.T2, c.a, c.b);
      const mc = mcTouchProb(c.S, c.sigma, c.T1, c.T2, c.a, c.b, 60_000);
      expect(Math.abs(q - mc)).toBeLessThan(0.005);
    });
  }

  it("probabilities are bounded", () => {
    const p = touchProb(100, 0.5, 0, 5, 99, 101);
    expect(p).toBeGreaterThanOrEqual(1e-4);
    expect(p).toBeLessThanOrEqual(0.9999);
  });

  // Bands sit ABOVE spot so none contain S; widening must raise touch prob.
  it("increases monotonically as band widens", () => {
    const p1 = touchProb(100, 0.5, 1, 6, 102, 103);
    const p2 = touchProb(100, 0.5, 1, 6, 101, 104);
    const p3 = touchProb(100, 0.5, 1, 6, 100.5, 105);
    expect(p2).toBeGreaterThan(p1);
    expect(p3).toBeGreaterThan(p2);
  });
});

describe("survivalCurve vs Monte Carlo", () => {
  it(
    "matches MC within 0.015 at sampled times",
    () => {
      const sigma = 0.5;
      const Hh = 2;
      const maxT = 30;
      const { surv } = survivalCurve(sigma, Hh, maxT, MON);
      const mc = mcSurvival(sigma, Hh, maxT, MON, 15_000);
      const samples = [0, 5, 10, 20, surv.length - 1];
      for (const idx of samples) {
        expect(Math.abs(surv[idx] - mc[idx])).toBeLessThan(0.015);
      }
    },
    30_000,
  );

  it("survival is non-increasing", () => {
    const { surv } = survivalCurve(0.4, 1.5, 60, MON);
    for (let i = 1; i < surv.length; i++) {
      expect(surv[i]).toBeLessThanOrEqual(surv[i - 1] + 1e-9);
    }
  });
});

describe("offered", () => {
  it("applies fixed edge", () => {
    expect(offered(0.5)).toBeCloseTo(1.91, 2);
    expect(offered(0.1)).toBeCloseTo(9.55, 2);
  });

  it("clamps to [1.01, 12]", () => {
    expect(offered(0.99)).toBe(1.01);
    expect(offered(0.001)).toBe(12);
  });
});

describe("realized dealer edge simulation", () => {
  it("realized edge is positive and near quoted 4.5%", () => {
    const edge = 0.045;
    let totalStake = 0;
    let expectedPayout = 0;
    let playable = 0;

    // Offset bands away from spot so touch probs land in the playable mult range.
    for (let i = 0; i < 5000; i++) {
      const S = 100;
      const sigma = 0.35 + (i % 30) * 0.01;
      const offset = 1 + (i % 4);
      const width = 1 + (i % 2);
      const a = S + offset;
      const b = a + width;
      const p = touchProb(S, sigma, 0, 5, a, b);
      const mult = offered(p, edge);
      if (mult <= 1.02 || mult >= 12) continue;
      playable++;
      const stake = 1;
      totalStake += stake;
      // E[payout] = stake * mult * p — avoids Bernoulli noise in CI
      expectedPayout += stake * mult * p;
    }

    expect(playable).toBeGreaterThan(1000);
    const realizedEdge = 1 - expectedPayout / totalStake;
    expect(realizedEdge).toBeGreaterThan(0.03);
    expect(realizedEdge).toBeLessThan(0.06);
  });
});
