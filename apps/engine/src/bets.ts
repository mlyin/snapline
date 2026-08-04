import { createHash, randomUUID } from "node:crypto";
import type { Asset, BetRecord, BetState, SettlementReceipt } from "@snapline/shared";
import { ASSETS, CFG } from "@snapline/shared";
import type { PriceSnapshot } from "@snapline/shared";

export function makeBetId(): string {
  return randomUUID().slice(0, 8);
}

export function makeQuoteId(): string {
  return randomUUID();
}

export function buildReceipt(
  bet: BetRecord,
  snapshot: PriceSnapshot,
  status: BetState,
): SettlementReceipt {
  const receipt: SettlementReceipt = {
    betId: bet.id,
    structure: bet.type === "cell" ? "Range one-touch" : "Tunnel knock-out",
    band: `$${bet.a.toFixed(ASSETS[bet.asset].dec)} – $${bet.b.toFixed(ASSETS[bet.asset].dec)}`,
    impliedProb: bet.p,
    fairMultiple: 1 / bet.p,
    offeredMultiple: bet.mult,
    disclosedEdge: 1 - bet.mult * bet.p,
    settlePrice: bet.settlePrice ?? snapshot.price,
    oracleTs: snapshot.oracleTs,
    feedSource: snapshot.feedSrc ?? snapshot.feedMode,
    receiptHash: "",
    status,
  };
  receipt.receiptHash = createHash("sha256")
    .update(JSON.stringify({ ...receipt, receiptHash: undefined }))
    .digest("hex");
  return receipt;
}

export interface TapRequest {
  quoteId: string;
  cellKey: string;
  stake: number;
  clientTs: number;
}

export function validateTap(
  now: number,
  cell: { t1: number; t2: number; mult: number; quoteId: string },
  stake: number,
  balance: number,
  killSwitch: boolean,
): string | null {
  if (killSwitch) return "BETTING PAUSED — feed stall or risk limit";
  if (balance < stake) return "INSUFFICIENT VAULT BALANCE";
  if (cell.t1 - now < CFG.lockout) return "LOCKED · 0.8s ANTI-SNIPE WINDOW";
  if (cell.mult <= 1.02 || cell.mult >= CFG.maxMult) return "CELL NOT PLAYABLE";
  if (stake <= 0) return "INVALID STAKE";
  return null;
}

/** Settlement uses server price history — anti-latency-arb core. */
export function shouldSettleCellWin(
  now: number,
  price: number,
  bet: BetRecord,
): boolean {
  return now >= bet.t1 && now <= bet.t2 && price >= bet.a && price <= bet.b;
}

export function shouldSettleCellLoss(now: number, bet: BetRecord): boolean {
  return now > bet.t2;
}

export function payout(stake: number, mult: number): number {
  return stake * mult;
}
