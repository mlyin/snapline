import type { Asset } from "@snapline/shared";
import { ASSETS } from "@snapline/shared";
import { gauss, sigPS } from "./pricing.js";

export interface FeedState {
  mode: "live" | "sim";
  src?: string;
  lastPrice: number | null;
  lastMsg: number;
  ws: WebSocket | null;
  pollTimer: ReturnType<typeof setInterval> | null;
  simLv: number;
}

export function createFeedState(initialPrice: number): FeedState {
  return {
    mode: "sim",
    lastPrice: initialPrice,
    lastMsg: Date.now(),
    ws: null,
    pollTimer: null,
    simLv: 0,
  };
}

function finnhubKey(): string | undefined {
  return process.env.FINNHUB_KEY ?? process.env.FINNHUB_API_KEY;
}

export function stopFeed(feed: FeedState): void {
  if (feed.ws) {
    try {
      feed.ws.close();
    } catch {
      /* ignore */
    }
    feed.ws = null;
  }
  if (feed.pollTimer) {
    clearInterval(feed.pollTimer);
    feed.pollTimer = null;
  }
}

async function fetchQuote(symbol: string, key: string): Promise<number | null> {
  try {
    const res = await fetch(
      `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`,
    );
    if (!res.ok) return null;
    const d = (await res.json()) as { c?: number };
    return d.c && d.c > 0 ? d.c : null;
  } catch {
    return null;
  }
}

/**
 * Finnhub free tier: REST quote poll (reliable) + optional WS trades.
 * SPY ≈ S&P 500 ETF. ES futures / cash SPX are not on free Finnhub.
 * 60 REST calls/min → poll active symbol ~1/sec.
 */
export function connectFeed(asset: Asset, feed: FeedState): void {
  stopFeed(feed);
  feed.mode = "sim";

  const key = finnhubKey();
  const symbol = ASSETS[asset].finnhub;
  if (!key) {
    console.warn("[feed] No FINNHUB_KEY — sim only");
    return;
  }

  const apply = (p: number, src: string) => {
    feed.mode = "live";
    feed.src = src;
    feed.lastPrice = p;
    feed.lastMsg = Date.now();
  };

  // Immediate seed so we don't sit on stale p0
  void fetchQuote(symbol, key).then((p) => {
    if (p) {
      apply(p, "FINNHUB");
      console.log(`[feed] Finnhub REST ${symbol} @ ${p}`);
    }
  });

  feed.pollTimer = setInterval(() => {
    void fetchQuote(symbol, key).then((p) => {
      if (p) apply(p, "FINNHUB");
    });
  }, 1000);

  // Best-effort WS for faster ticks when Finnhub allows it
  try {
    const ws = new WebSocket(`wss://ws.finnhub.io?token=${key}`);
    ws.onopen = () => {
      ws.send(JSON.stringify({ type: "subscribe", symbol }));
    };
    ws.onmessage = (e) => {
      try {
        const d = JSON.parse(String(e.data));
        if (d.type === "trade" && Array.isArray(d.data) && d.data.length) {
          const last = d.data[d.data.length - 1];
          const p = Number(last.p);
          if (p > 0) apply(p, "FINNHUB");
        }
      } catch {
        /* ignore */
      }
    };
    feed.ws = ws;
  } catch {
    /* REST poll is enough */
  }
}

export function simTick(feed: FeedState, asset: Asset, price: number, dt: number): number {
  feed.simLv += 0.05 * (0 - feed.simLv) * dt + 0.28 * Math.sqrt(dt) * gauss();
  feed.simLv = Math.max(-0.7, Math.min(0.9, feed.simLv));
  const sig = sigPS(price, ASSETS[asset].ann) * Math.exp(feed.simLv);
  let p = price + sig * Math.sqrt(dt) * gauss();
  if (Math.random() < dt / 35) p += (Math.random() < 0.5 ? -1 : 1) * sig * (4 + Math.random() * 8);
  return p;
}

export function updateEwmaVol(
  prevVar: number,
  price: number,
  prevPrice: number,
  dt: number,
  floor: number,
  ceiling: number,
): { ewVar: number; sigma: number } {
  const r = price - prevPrice;
  const maxMove = Math.max(price, prevPrice, 1) * 0.01;
  const clipped = Math.max(-maxMove, Math.min(maxMove, r));
  const lam = Math.pow(0.5, dt / 20);
  let ewVar = lam * prevVar + (1 - lam) * ((clipped * clipped) / Math.max(dt, 1e-6));
  ewVar = Math.max(floor * floor, Math.min(ceiling * ceiling, ewVar));
  return { ewVar, sigma: Math.sqrt(ewVar) };
}

export function isFeedStale(feed: FeedState): boolean {
  return Date.now() - feed.lastMsg > 8000;
}

/** US equities RTH: Mon–Fri 09:30–16:00 America/New_York (no holiday calendar). */
export function isUsRthOpen(now = new Date()): boolean {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(fmt.formatToParts(now).map((p) => [p.type, p.value]));
  const wd = parts.weekday;
  if (wd === "Sat" || wd === "Sun") return false;
  const mins = Number(parts.hour) * 60 + Number(parts.minute);
  return mins >= 9 * 60 + 30 && mins < 16 * 60;
}

/**
 * Quiet after-hours drift around the last exchange print so the tape stays
 * playable when SPY/QQQ/AAPL are closed (unlike 24/7 crypto).
 */
export function afterHoursTick(feed: FeedState, asset: Asset, price: number, anchor: number, dt: number): number {
  let p = simTick(feed, asset, price, dt);
  // Mean-revert toward last close so we don't wander off into fantasy land
  p += (anchor - p) * Math.min(1, 0.015 * dt * 10);
  const maxDev = Math.max(anchor * 0.004, ASSETS[asset].p0 * 0.002);
  return Math.max(anchor - maxDev, Math.min(anchor + maxDev, p));
}
