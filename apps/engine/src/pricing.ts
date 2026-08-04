/** Verified pricing engine — port of reference/blip.html math (quadrature + BGK correction). */

export const MON = 0.1;

export function erf(x: number): number {
  const s = x < 0 ? -1 : 1;
  x = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-x * x));
  return s * y;
}

export const ncdf = (x: number): number => 0.5 * (1 + erf(x / Math.SQRT2));

export function startWindowProb(
  x: number,
  sigma: number,
  dur: number,
  a: number,
  b: number,
): number {
  if (x >= a && x <= b) return 1;
  const c = Math.min(0.35 * sigma, 0.5826 * sigma * Math.sqrt(MON));
  const a2 = a + c;
  const b2 = b - c;
  const sd = sigma * Math.sqrt(Math.max(dur, 1e-9));
  const d = x > b2 ? x - b2 : a2 - x;
  return Math.min(1, 2 * ncdf(-Math.max(d, 0) / sd));
}

export function touchProb(
  S: number,
  sigma: number,
  T1: number,
  T2: number,
  a: number,
  b: number,
): number {
  if (T2 <= 0) return 0;
  T1 = Math.max(T1, 0);
  const dur = T2 - T1;
  if (T1 < 1e-9) {
    return Math.min(0.9999, Math.max(1e-4, startWindowProb(S, sigma, dur, a, b)));
  }
  const sd1 = sigma * Math.sqrt(T1);
  let p = 0;
  let ws = 0;
  for (let i = 0; i < 41; i++) {
    const z = -4 + (8 * i) / 40;
    const w = Math.exp(-0.5 * z * z);
    ws += w;
    p += w * startWindowProb(S + sd1 * z, sigma, dur, a, b);
  }
  return Math.min(0.9999, Math.max(1e-4, p / ws));
}

export interface SurvivalCurveResult {
  surv: number[];
  dtS: number;
}

export function survivalCurve(
  sigma: number,
  Hh: number,
  maxT: number,
  dtS: number,
): SurvivalCurveResult {
  const M = 81;
  const h = (2 * Hh) / (M - 1);
  const d = new Array<number>(M).fill(0);
  d[(M - 1) / 2] = 1;
  const sd = sigma * Math.sqrt(dtS);
  const span = Math.max(1, Math.ceil((4 * sd) / h));
  const K: number[] = [];
  let ks = 0;
  for (let k = -span; k <= span; k++) {
    const v = Math.exp(-0.5 * Math.pow((k * h) / sd, 2));
    K.push(v);
    ks += v;
  }
  for (let i = 0; i < K.length; i++) K[i] /= ks;
  const steps = Math.ceil(maxT / dtS);
  const surv = [1];
  for (let s = 1; s <= steps; s++) {
    const nd = new Array<number>(M).fill(0);
    for (let j = 0; j < M; j++) {
      const dj = d[j];
      if (dj < 1e-12) continue;
      for (let k = -span; k <= span; k++) {
        const i = j + k;
        if (i >= 0 && i < M) nd[i] += dj * K[k + span];
      }
    }
    d.splice(0, d.length, ...nd);
    surv.push(d.reduce((x, y) => x + y, 0));
  }
  return { surv, dtS };
}

export function offered(p: number, edge = 0.045, maxMult = 12): number {
  return Math.max(1.01, Math.min(maxMult, (1 - edge) / p));
}

export const NICE = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 500];

export function niceStep(x: number): number {
  for (const n of NICE) if (n >= x) return n;
  return 1000;
}

export function sigPS(p0: number, ann: number): number {
  return (p0 * ann) / 5615;
}

export function gauss(): number {
  let u = 0;
  let v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/** Monte Carlo range-touch for test verification. */
export function mcTouchProb(
  S: number,
  sigma: number,
  T1: number,
  T2: number,
  a: number,
  b: number,
  paths = 60_000,
): number {
  const dur = T2 - T1;
  if (dur <= 0) return 0;
  const dt = MON;
  const steps = Math.ceil(dur / dt);
  let hits = 0;
  for (let n = 0; n < paths; n++) {
    let x = S;
    if (T1 > 1e-9) {
      const steps1 = Math.ceil(T1 / dt);
      for (let s = 0; s < steps1; s++) {
        x += sigma * Math.sqrt(dt) * gauss();
      }
    }
    let hit = x >= a && x <= b;
    for (let s = 0; s < steps && !hit; s++) {
      x += sigma * Math.sqrt(dt) * gauss();
      if (x >= a && x <= b) hit = true;
    }
    if (hit) hits++;
  }
  return hits / paths;
}

/** Monte Carlo corridor survival at time t — single-pass O(paths × steps). */
export function mcSurvival(
  sigma: number,
  Hh: number,
  maxT: number,
  dtS: number,
  paths = 20_000,
): number[] {
  const steps = Math.ceil(maxT / dtS);
  const alive = new Array<number>(steps + 1).fill(0);
  alive[0] = paths;

  for (let n = 0; n < paths; n++) {
    let x = 0;
    let ok = true;
    for (let s = 1; s <= steps; s++) {
      if (ok) {
        x += sigma * Math.sqrt(dtS) * gauss();
        if (Math.abs(x) > Hh) ok = false;
      }
      if (ok) alive[s]++;
    }
  }

  return alive.map((c) => c / paths);
}
