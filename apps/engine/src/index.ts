import Fastify from "fastify";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import { config as loadEnv } from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { WebSocket } from "ws";
import type {
  Asset,
  BetRecord,
  ClientMessage,
  CorridorState,
  QuoteCell,
  ServerMessage,
  VaultState,
} from "@snapline/shared";
import { ASSETS, CFG } from "@snapline/shared";
import {
  buildReceipt,
  makeBetId,
  payout,
  shouldSettleCellLoss,
  shouldSettleCellWin,
  validateTap,
} from "./bets.js";
import {
  connectFeed,
  createFeedState,
  isFeedStale,
  simTick,
  stopFeed,
  updateEwmaVol,
} from "./feed.js";
import { Ledger } from "./ledger.js";
import { MON, sigPS, survivalCurve } from "./pricing.js";
import { buildGridCells, initialRowPts, rebaselineVol, updateRowPts, volPct } from "./quotes.js";
import { RiskManager, aggregateOpenDelta } from "./risk.js";
import { verifyUsdtDeposit } from "./solana.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../.env") });

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";

interface Session {
  asset: Asset;
  walletId: string;
  ws: WebSocket;
}

interface GameState {
  asset: Asset;
  now: number;
  price: number;
  prev: number;
  hist: Array<{ t: number; p: number }>;
  ewVar: number;
  sigma: number;
  rowPts: number;
  camY: number;
  cells: QuoteCell[];
  cellsByKey: Map<string, QuoteCell>;
  quoteGeneration: number;
  bets: BetRecord[];
  corridor: CorridorState | null;
  feed: ReturnType<typeof createFeedState>;
  liveAdopted: boolean;
}

function createGameState(asset: Asset): GameState {
  const p0 = ASSETS[asset].p0;
  const sig = sigPS(p0, ASSETS[asset].ann);
  return {
    asset,
    now: 0,
    price: p0,
    prev: p0,
    hist: [],
    ewVar: sig ** 2,
    sigma: sig,
    rowPts: initialRowPts(asset),
    camY: p0,
    cells: [],
    cellsByKey: new Map(),
    quoteGeneration: 0,
    bets: [],
    corridor: null,
    feed: createFeedState(p0),
    liveAdopted: false,
  };
}

function warm(state: GameState): void {
  // Warm EWMA off-screen, then wipe hist so the tape doesn't open on sim noise
  for (let i = 0; i < 200; i++) {
    state.now += 0.1;
    const prev = state.price;
    state.price = simTick(state.feed, state.asset, state.price, 0.1);
    const fair = sigPS(state.price, ASSETS[state.asset].ann);
    const vol = updateEwmaVol(state.ewVar, state.price, prev, 0.1, fair * 0.25, fair * 4);
    state.ewVar = vol.ewVar;
    state.sigma = vol.sigma;
  }
  state.hist = [];
  state.camY = state.price;
  state.prev = state.price;
  state.rowPts = updateRowPts(state.asset, state.sigma, state.rowPts);
}

const ledger = new Ledger();
const risk = new RiskManager();
const sessions = new Set<Session>();
let state = createGameState("SPY");

function snapshot() {
  return {
    price: state.price,
    sigma: state.sigma,
    now: state.now,
    feedMode: state.feed.mode,
    feedSrc: state.feed.src,
    oracleTs: Date.now(),
  };
}

function vaultView(walletId: string): VaultState {
  ledger.ensureWallet(walletId, walletId === "default" ? 1000 : 0);
  const v = ledger.getVault(walletId);
  const inPlay =
    state.bets.filter((b) => b.state === "open").reduce((s, b) => s + b.stake, 0) +
    (state.corridor?.stake ?? 0);
  return { balance: v.balance, pnl: v.pnl, inPlay, house: v.house };
}

function broadcast(msg: ServerMessage): void {
  const raw = JSON.stringify(msg);
  for (const s of sessions) {
    if (s.ws.readyState === 1) s.ws.send(raw);
  }
}

function reprice(viewportRows = 12): void {
  state.quoteGeneration++;
  const cells = buildGridCells(
    state.asset,
    state.now,
    state.price,
    state.sigma,
    state.rowPts,
    state.camY,
    viewportRows,
  );
  for (const c of cells) {
    c.mult = risk.throttleMult(c.mult);
  }
  state.cells = cells;
  state.cellsByKey = new Map(cells.map((c) => [c.key, c]));
}

function sendQuote(): void {
  broadcast({
    type: "quote",
    asset: state.asset,
    now: state.now,
    price: state.price,
    prev: state.prev,
    sigma: state.sigma,
    volPct: volPct(state.asset, state.sigma, state.price),
    rowPts: state.rowPts,
    feedMode: state.feed.mode,
    feedSrc: state.feed.src ?? (state.feed.mode === "live" ? "EXCHANGE" : undefined),
    // Cap hist for WS bandwidth — ~6s at 100ms ticks is enough to paint the tape
    hist: state.hist.slice(-120),
    cells: state.cells,
    killSwitch: risk.isPaused(),
  });
}

function adoptPrice(p: number, opts?: { force?: boolean }): void {
  const jump = Math.abs(p - state.price) / Math.max(state.price, 1);
  // Live feed (or any meaningful gap) must not poison EWMA / leave a cliff in the tape
  // Only rebaseline on first live print or huge gaps — small Finnhub polls must not wipe the tape
  if (opts?.force || jump > 0.05) {
    const rb = rebaselineVol(state.asset, p);
    state.ewVar = rb.ewVar;
    state.sigma = rb.sigma;
    state.rowPts = rb.rowPts;
    state.hist = [];
    state.camY = p;
    state.prev = p;
  }
  state.price = p;
  state.feed.lastPrice = p;
  state.feed.lastMsg = Date.now();
}

function settleBets(walletId: string): void {
  for (const bet of state.bets) {
    if (bet.state !== "open") continue;
    const snap = snapshot();
    if (shouldSettleCellWin(state.now, state.price, bet)) {
      bet.state = "won";
      bet.settledAt = state.now;
      bet.settlePrice = state.price;
      const pay = payout(bet.stake, bet.mult);
      ledger.updateVault(walletId, {
        balance: pay,
        pnl: pay - bet.stake,
        house: -(pay - bet.stake),
      });
      risk.releaseBubble(bet.stake, bet.t1, bet.a, bet.b);
      risk.recordOutcome(walletId, true);
      const receipt = buildReceipt(bet, snap, "won");
      bet.receiptHash = receipt.receiptHash;
      ledger.recordSettlement(bet, receipt);
      broadcast({ type: "bet_settled", bet, receipt });
    } else if (shouldSettleCellLoss(state.now, bet)) {
      bet.state = "lost";
      bet.settledAt = state.now;
      bet.settlePrice = state.price;
      ledger.updateVault(walletId, { pnl: -bet.stake, house: bet.stake });
      risk.releaseBubble(bet.stake, bet.t1, bet.a, bet.b);
      risk.recordOutcome(walletId, false);
      const receipt = buildReceipt(bet, snap, "lost");
      bet.receiptHash = receipt.receiptHash;
      ledger.recordSettlement(bet, receipt);
      broadcast({ type: "bet_settled", bet, receipt });
    }
  }
  state.bets = state.bets.filter((b) => b.state === "open" || state.now - (b.settledAt ?? 0) < 2.5);
}

function corridorTick(walletId: string): void {
  const c = state.corridor;
  if (!c) return;
  if (state.price <= c.lo || state.price >= c.hi) {
    ledger.updateVault(walletId, { pnl: -c.stake, house: c.stake });
    state.corridor = null;
    broadcast({ type: "corridor", corridor: null });
    return;
  }
  const bet = state.bets.find((b) => b.id === c.betId);
  // Reuse cached survival curve on the corridor object
  let sc = (c as { _sc?: ReturnType<typeof survivalCurve> })._sc;
  if (!sc) {
    sc = survivalCurve(state.sigma, (c.hi - c.lo) / 2, 90, MON);
    (c as { _sc?: ReturnType<typeof survivalCurve> })._sc = sc;
  }
  const el = state.now - c.t0;
  const idx = Math.min(sc.surv.length - 1, Math.floor(el / sc.dtS));
  const next = Math.max(1, Math.min(500, (1 - CFG.corrEdge) / Math.max(sc.surv[idx], 1e-4)));
  if (Math.abs(next - c.mult) < 0.005) return;
  c.mult = next;
  if (bet) bet.mult = c.mult;
  broadcast({ type: "corridor", corridor: { ...c } });
}

function tick(walletId: string): void {
  const dt = CFG.tickMs / 1000;
  state.now += dt;
  state.prev = state.price;

  if (state.feed.lastPrice && (state.feed.mode === "live" || state.liveAdopted)) {
    const p = state.feed.lastPrice;
    if (!state.liveAdopted) {
      adoptPrice(p, { force: true });
      state.liveAdopted = true;
    } else if (isFeedStale(state.feed)) {
      // Hold last live print — never inject sim jitter into a live session
      state.feed.mode = "live";
    } else {
      // Live updates never wipe hist — only snap price (rebaseline reserved for first adopt)
      state.price = p;
    }
  } else {
    // Pre-live only: quiet sim so the grid can price before Finnhub seeds
    state.price = simTick(state.feed, state.asset, state.price, dt);
  }

  // Append hist when price moved, or every 500ms so the tape still scrolls
  const last = state.hist[state.hist.length - 1];
  const moved = !last || Math.abs(state.price - last.p) > 1e-9;
  const due = !last || state.now - last.t >= 0.5;
  if (moved || due) {
    state.hist.push({ t: state.now, p: state.price });
  }
  const cutoff = state.now - CFG.pastSec - 5;
  while (state.hist.length && state.hist[0].t < cutoff) state.hist.shift();

  const fair = sigPS(state.price, ASSETS[state.asset].ann);
  const floor = fair * 0.25;
  const ceiling = fair * 4;
  const vol = updateEwmaVol(state.ewVar, state.price, state.prev, dt, floor, ceiling);
  state.ewVar = vol.ewVar;
  state.sigma = vol.sigma;
  state.rowPts = updateRowPts(state.asset, state.sigma, state.rowPts);
  state.camY += (state.price - state.camY) * 0.03;

  risk.onFeedStall(state.liveAdopted && isFeedStale(state.feed));
  settleBets(walletId);
  corridorTick(walletId);
}

function switchAsset(asset: Asset, walletId: string): void {
  stopFeed(state.feed);
  state = createGameState(asset);
  warm(state);
  connectFeed(asset, state.feed);
  reprice();
  sendQuote();
  broadcast({ type: "vault", vault: vaultView(walletId) });
}

function handleClient(msg: ClientMessage, session: Session): void {
  const { walletId } = session;

  switch (msg.type) {
    case "subscribe": {
      if (msg.walletId) {
        session.walletId = msg.walletId;
        ledger.ensureWallet(msg.walletId, 0);
      }
      // Only reset the tape when the asset actually changes — reconnects used to wipe hist every few seconds
      if (msg.asset !== session.asset || msg.asset !== state.asset) {
        session.asset = msg.asset;
        switchAsset(msg.asset, session.walletId);
      } else {
        session.asset = msg.asset;
        session.ws.send(JSON.stringify({ type: "vault", vault: vaultView(session.walletId) }));
        sendQuote();
      }
      break;
    }
    case "tap": {
      if (msg.walletId) {
        session.walletId = msg.walletId;
        ledger.ensureWallet(msg.walletId, 0);
      }
      const wid = session.walletId;
      if (risk.isSuspicious(wid)) {
        session.ws.send(JSON.stringify({ type: "error", message: "FLOW SCORE LIMIT" }));
        return;
      }
      const cell = state.cellsByKey.get(msg.cellKey);
      if (!cell) {
        session.ws.send(JSON.stringify({ type: "error", message: "STALE QUOTE" }));
        return;
      }
      const vault = ledger.getVault(wid);
      const err = validateTap(state.now, cell, msg.stake, vault.balance, risk.isPaused());
      if (err) {
        session.ws.send(JSON.stringify({ type: "error", message: err }));
        return;
      }
      if (!risk.canAcceptBubble(msg.stake, cell.t1, cell.a, cell.b)) {
        session.ws.send(JSON.stringify({ type: "error", message: "BUBBLE CAP REACHED" }));
        return;
      }
      const snap = snapshot();
      ledger.updateVault(wid, { balance: -msg.stake });
      risk.recordBubble(msg.stake, cell.mult, cell.t1, cell.a, cell.b, state.price);
      const bet: BetRecord = {
        id: makeBetId(),
        type: "cell",
        asset: state.asset,
        a: cell.a,
        b: cell.b,
        t1: cell.t1,
        t2: cell.t2,
        stake: msg.stake,
        mult: cell.mult,
        p: cell.p,
        sigmaAt: state.sigma,
        state: "open",
        quoteId: cell.quoteId,
        priceAtTap: snap.price,
        oracleTsAtTap: snap.oracleTs,
        createdAt: Date.now(),
      };
      state.bets.push(bet);
      ledger.recordBet(bet);
      if (msg.privyUserId) ledger.append("bet_identity", { betId: bet.id, privyUserId: msg.privyUserId, wallet: wid });
      broadcast({ type: "bet_accepted", bet });
      broadcast({ type: "vault", vault: vaultView(wid) });
      break;
    }
    case "start_corridor": {
      if (msg.walletId) {
        session.walletId = msg.walletId;
        ledger.ensureWallet(msg.walletId, 0);
      }
      const wid = session.walletId;
      if (state.corridor) return;
      const vault = ledger.getVault(wid);
      if (vault.balance < msg.stake) {
        session.ws.send(JSON.stringify({ type: "error", message: "INSUFFICIENT VAULT BALANCE" }));
        return;
      }
      ledger.updateVault(wid, { balance: -msg.stake });
      const H = state.rowPts * 2;
      const betId = makeBetId();
      state.corridor = {
        t0: state.now,
        p0: state.price,
        lo: state.price - H,
        hi: state.price + H,
        stake: msg.stake,
        mult: 1,
        betId,
      };
      const bet: BetRecord = {
        id: betId,
        type: "corridor",
        asset: state.asset,
        a: state.price - H,
        b: state.price + H,
        t1: state.now,
        t2: state.now + 90,
        stake: msg.stake,
        mult: 1,
        p: 1,
        sigmaAt: state.sigma,
        state: "open",
        quoteId: "corridor",
        priceAtTap: state.price,
        oracleTsAtTap: Date.now(),
        createdAt: Date.now(),
      };
      state.bets.push(bet);
      ledger.recordBet(bet);
      if (msg.privyUserId) ledger.append("bet_identity", { betId: bet.id, privyUserId: msg.privyUserId, wallet: wid });
      broadcast({ type: "corridor", corridor: state.corridor });
      broadcast({ type: "vault", vault: vaultView(wid) });
      break;
    }
    case "cash_out": {
      if (msg.walletId) session.walletId = msg.walletId;
      const wid = session.walletId;
      const c = state.corridor;
      if (!c) return;
      const pay = payout(c.stake, c.mult);
      ledger.updateVault(wid, { balance: pay, pnl: pay - c.stake, house: -(pay - c.stake) });
      const bet = state.bets.find((b) => b.id === c.betId);
      if (bet) {
        bet.state = "cashed_out";
        bet.settledAt = state.now;
        bet.settlePrice = state.price;
        bet.mult = c.mult;
        const receipt = buildReceipt(bet, snapshot(), "cashed_out");
        bet.receiptHash = receipt.receiptHash;
        ledger.recordSettlement(bet, receipt);
        broadcast({ type: "bet_settled", bet, receipt });
      }
      state.corridor = null;
      broadcast({ type: "corridor", corridor: null });
      broadcast({ type: "vault", vault: vaultView(wid) });
      break;
    }
    case "deposit": {
      // Demo play-money only for the anonymous default vault
      if (walletId !== "default") {
        session.ws.send(
          JSON.stringify({
            type: "error",
            message: "Use on-chain USDT deposit while logged in",
          }),
        );
        return;
      }
      ledger.updateVault(walletId, { balance: msg.amount });
      broadcast({ type: "vault", vault: vaultView(walletId) });
      break;
    }
    case "deposit_onchain": {
      void (async () => {
        try {
          if (ledger.hasCreditedSig(msg.signature)) {
            session.ws.send(JSON.stringify({ type: "error", message: "Deposit already credited" }));
            return;
          }
          if (msg.wallet !== walletId && walletId !== "default") {
            // Prefer session wallet; allow first bind
          }
          const wid = msg.wallet;
          ledger.ensureWallet(wid, 0);
          session.walletId = wid;

          const verified = await verifyUsdtDeposit({
            signature: msg.signature,
            fromWallet: wid,
            amountUsdt: msg.amount,
          });
          if (!verified.ok) {
            session.ws.send(JSON.stringify({ type: "error", message: verified.reason }));
            return;
          }

          ledger.recordCreditedSig(msg.signature, wid, verified.amount);
          ledger.updateVault(wid, { balance: verified.amount, house: verified.amount });
          ledger.append("deposit_onchain", {
            wallet: wid,
            amount: verified.amount,
            signature: msg.signature,
          });
          const vault = vaultView(wid);
          session.ws.send(
            JSON.stringify({
              type: "deposit_confirmed",
              amount: verified.amount,
              signature: msg.signature,
              vault,
            }),
          );
          broadcast({ type: "vault", vault });
        } catch (e) {
          session.ws.send(
            JSON.stringify({
              type: "error",
              message: e instanceof Error ? e.message : "Deposit verification failed",
            }),
          );
        }
      })();
      break;
    }
    case "withdraw_all": {
      const v = ledger.getVault(walletId);
      ledger.setBalance(walletId, 0);
      ledger.append("withdraw", { walletId, amount: v.balance });
      broadcast({ type: "vault", vault: vaultView(walletId) });
      break;
    }
  }
}

async function main(): Promise<void> {
  await ledger.ensureReady();
  const app = Fastify({ logger: true });
  await app.register(cors, { origin: true });
  await app.register(websocket);

  app.get("/health", async () => ({
    ok: true,
    asset: state.asset,
    price: state.price,
    feed: state.feed.mode,
    killSwitch: risk.isPaused(),
    openBets: state.bets.filter((b) => b.state === "open").length,
    houseDelta: aggregateOpenDelta(state.bets, state.price),
  }));

  app.get("/events", async () => ledger.listEvents(50));

  app.register(async (f) => {
    f.get("/ws", { websocket: true }, (socket) => {
      const session: Session = { asset: "SPY", walletId: "default", ws: socket };
      sessions.add(session);
      socket.send(JSON.stringify({ type: "vault", vault: vaultView(session.walletId) }));
      sendQuote();

      socket.on("message", (raw) => {
        try {
          const msg = JSON.parse(String(raw)) as ClientMessage;
          handleClient(msg, session);
        } catch {
          socket.send(JSON.stringify({ type: "error", message: "INVALID MESSAGE" }));
        }
      });

      socket.on("close", () => sessions.delete(session));
    });
  });

  warm(state);
  connectFeed(state.asset, state.feed);
  reprice();

  setInterval(() => {
    tick("default");
    sendQuote();
  }, CFG.tickMs);

  setInterval(() => reprice(), CFG.repriceMs);

  await app.listen({ port: PORT, host: HOST });
  console.log(`SNAPLINE engine on ws://${HOST}:${PORT}/ws`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
