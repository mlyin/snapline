import type { Asset, QuoteCell } from "@snapline/shared";
import { ASSETS, CFG } from "@snapline/shared";
import { niceStep, offered, sigPS, touchProb } from "./pricing.js";
import { makeQuoteId } from "./bets.js";

export function buildGridCells(
  asset: Asset,
  now: number,
  price: number,
  sigma: number,
  rowPts: number,
  camY: number,
  viewportRows: number,
): QuoteCell[] {
  const cells: QuoteCell[] = [];
  const c0 = Math.ceil(now / CFG.colSec);
  const kMid = Math.round(camY / rowPts);

  for (let j = 0; j < CFG.futureSec / CFG.colSec; j++) {
    const t1 = (c0 + j) * CFG.colSec;
    const t2 = t1 + CFG.colSec;
    if (t2 - now <= 0.3) continue;

    for (let k = kMid - viewportRows; k <= kMid + viewportRows; k++) {
      const a = k * rowPts;
      const b = a + rowPts;
      const p = touchProb(price, sigma, t1 - now, t2 - now, a, b);
      const mult = offered(p, CFG.edge, CFG.maxMult);
      cells.push({
        key: `${t1}:${k}`,
        t1,
        t2,
        a,
        b,
        p,
        mult,
        quoteId: makeQuoteId(),
      });
    }
  }
  return cells;
}

export function updateRowPts(asset: Asset, sigma: number, current: number): number {
  const target = niceStep(sigma * 2.2);
  if (target !== current && (target > current * 1.9 || target < current * 0.55)) {
    return target;
  }
  return current;
}

export function initialRowPts(asset: Asset): number {
  const s = sigPS(ASSETS[asset].p0, ASSETS[asset].ann);
  return niceStep(s * 2.2);
}

export function volPct(asset: Asset, sigma: number, price?: number): number {
  const px = price && price > 0 ? price : ASSETS[asset].p0;
  const raw = ((sigma * 5615) / px) * 100;
  // Display clamp — estimator is also capped, this is belt-and-suspenders
  return Math.max(1, Math.min(raw, 250));
}

/** Reset vol/grid when price gaps (e.g. sim warmup → live feed). */
export function rebaselineVol(asset: Asset, price: number): {
  ewVar: number;
  sigma: number;
  rowPts: number;
} {
  const sigma = sigPS(price, ASSETS[asset].ann);
  return { ewVar: sigma ** 2, sigma, rowPts: niceStep(sigma * 2.2) };
}
