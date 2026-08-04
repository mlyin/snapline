export type Asset = "SPY" | "QQQ" | "AAPL";

export type GameMode = "grid" | "corr";

export type BetState = "open" | "won" | "lost" | "cashed_out";

export type FeedKind = "finnhub" | "sim";

export interface AssetConfig {
  /** Finnhub trade symbol */
  finnhub: string;
  p0: number;
  ann: number;
  dec: number;
  label: string;
}

/** Equities via Finnhub free WS. SPY ≈ S&P 500 exposure (ES/SPX index/futures are not on free Finnhub). */
export const ASSETS: Record<Asset, AssetConfig> = {
  SPY: { finnhub: "SPY", p0: 770, ann: 0.16, dec: 2, label: "S&P 500 ETF" },
  QQQ: { finnhub: "QQQ", p0: 520, ann: 0.22, dec: 2, label: "Nasdaq 100 ETF" },
  AAPL: { finnhub: "AAPL", p0: 230, ann: 0.28, dec: 2, label: "Apple" },
};

export const CFG = {
  colSec: 5,
  futureSec: 50,
  pastSec: 55,
  edge: 0.045,
  corrEdge: 0.04,
  lockout: 0.8,
  /** Hide / reject cell bubbles at or above this — far OTM longshots (90x+) are noise */
  maxMult: 12,
  tickMs: 100,
  repriceMs: 400,
  commitDelayMs: 150,
} as const;

export interface QuoteCell {
  key: string;
  t1: number;
  t2: number;
  a: number;
  b: number;
  p: number;
  mult: number;
  quoteId: string;
}

export interface PriceSnapshot {
  price: number;
  sigma: number;
  now: number;
  feedMode: "live" | "sim";
  feedSrc?: string;
  oracleTs: number;
}

export interface QuoteMessage {
  type: "quote";
  asset: Asset;
  now: number;
  price: number;
  prev: number;
  sigma: number;
  volPct: number;
  rowPts: number;
  feedMode: "live" | "sim";
  feedSrc?: string;
  hist: Array<{ t: number; p: number }>;
  cells: QuoteCell[];
  killSwitch: boolean;
}

export interface BetRecord {
  id: string;
  type: "cell" | "corridor";
  asset: Asset;
  a: number;
  b: number;
  t1: number;
  t2: number;
  stake: number;
  mult: number;
  p: number;
  sigmaAt: number;
  state: BetState;
  quoteId: string;
  priceAtTap: number;
  oracleTsAtTap: number;
  settledAt?: number;
  settlePrice?: number;
  receiptHash?: string;
  createdAt: number;
}

export interface CorridorState {
  t0: number;
  p0: number;
  lo: number;
  hi: number;
  stake: number;
  mult: number;
  betId: string;
}

export interface SettlementReceipt {
  betId: string;
  structure: string;
  band: string;
  impliedProb: number;
  fairMultiple: number;
  offeredMultiple: number;
  disclosedEdge: number;
  settlePrice: number;
  oracleTs: number;
  feedSource: string;
  receiptHash: string;
  status: BetState;
}

export interface VaultState {
  balance: number;
  pnl: number;
  inPlay: number;
  house: number;
}

export type ClientMessage =
  | { type: "subscribe"; asset: Asset; walletId?: string; privyUserId?: string }
  | {
      type: "tap";
      quoteId: string;
      cellKey: string;
      stake: number;
      clientTs: number;
      walletId?: string;
      privyUserId?: string;
    }
  | {
      type: "start_corridor";
      stake: number;
      clientTs: number;
      walletId?: string;
      privyUserId?: string;
    }
  | { type: "cash_out"; clientTs: number; walletId?: string; privyUserId?: string }
  | { type: "deposit"; amount: number }
  | {
      type: "deposit_onchain";
      signature: string;
      amount: number;
      wallet: string;
      privyUserId?: string;
    }
  | { type: "withdraw_all" };

export type ServerMessage =
  | QuoteMessage
  | { type: "bet_accepted"; bet: BetRecord }
  | { type: "bet_settled"; bet: BetRecord; receipt: SettlementReceipt }
  | { type: "corridor"; corridor: CorridorState | null }
  | { type: "vault"; vault: VaultState }
  | { type: "error"; message: string }
  | { type: "receipt"; receipt: SettlementReceipt }
  | { type: "deposit_confirmed"; amount: number; signature: string; vault: VaultState };
