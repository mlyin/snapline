"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  Asset,
  BetRecord,
  CorridorState,
  GameMode,
  QuoteCell,
  QuoteMessage,
  SettlementReceipt,
  VaultState,
} from "@snapline/shared";
import { ASSETS, CFG } from "@snapline/shared";
import { SnaplineSocket } from "@/lib/ws";
import { VaultPanel } from "@/components/VaultPanel";
import { MockVaultPanel } from "@/components/MockVaultPanel";

const PRIVY_ON = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

interface Toast {
  id: number;
  msg: string;
  cls: "w" | "l";
}

interface HudSnap {
  price: number;
  prev: number;
  volPct: number;
  feedMode: "live" | "sim";
  feedSrc?: string;
  killSwitch: boolean;
}

function fmt(m: number): string {
  return m < 10 ? m.toFixed(2) : m.toFixed(1);
}

export function Game(props?: { privyUserId?: string; walletAddress?: string }) {
  const cvRef = useRef<HTMLCanvasElement>(null);
  const socketRef = useRef<SnaplineSocket | null>(null);

  const [asset, setAsset] = useState<Asset>("SPY");
  const [stake, setStake] = useState(1);
  const [mode, setMode] = useState<GameMode>("grid");
  const [hud, setHud] = useState<HudSnap | null>(null);
  const [bets, setBets] = useState<BetRecord[]>([]);
  const [corridor, setCorridor] = useState<CorridorState | null>(null);
  const [vault, setVault] = useState<VaultState>({ balance: 1000, pnl: 0, inPlay: 0, house: 250000 });
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [showVault, setShowVault] = useState(false);
  const [showModal, setShowModal] = useState(true);
  const [receipt, setReceipt] = useState<{ bet: BetRecord; receipt: SettlementReceipt } | null>(null);

  const renderRef = useRef({
    quote: null as QuoteMessage | null,
    /** Local hist + prices — never drive React from feed ticks */
    hist: [] as Array<{ t: number; p: number }>,
    targetPrice: ASSETS.SPY.p0,
    displayPrice: ASSETS.SPY.p0,
    displayNow: 0,
    lastFrameMs: 0,
    bets: [] as BetRecord[],
    corridor: null as CorridorState | null,
    hover: null as QuoteCell | null,
    mode: "grid" as GameMode,
    camY: ASSETS.SPY.p0,
    W: 0,
    H: 0,
    DPR: 1,
    asset: "SPY" as Asset,
  });

  const lastHudRef = useRef(0);
  const hudSnapRef = useRef<HudSnap | null>(null);

  const toast = useCallback((msg: string, cls: "w" | "l") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, cls }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2400);
  }, []);

  useEffect(() => {
    renderRef.current.bets = bets;
    renderRef.current.corridor = corridor;
    renderRef.current.mode = mode;
    renderRef.current.asset = asset;
  }, [bets, corridor, mode, asset]);

  useEffect(() => {
    const sock = new SnaplineSocket();
    socketRef.current = sock;
    sock.setIdentity({
      walletId: props?.walletAddress,
      privyUserId: props?.privyUserId,
    });
    sock.connect((msg) => {
      switch (msg.type) {
        case "quote": {
          const r = renderRef.current;
          r.quote = msg;
          r.targetPrice = msg.price;
          if (!r.displayNow) r.displayNow = msg.now;
          // Keep hist in a ref — do not setState on every tick
          if (msg.hist?.length) {
            r.hist = msg.hist.slice();
          }
          hudSnapRef.current = {
            price: msg.price,
            prev: msg.prev,
            volPct: msg.volPct,
            feedMode: msg.feedMode,
            feedSrc: msg.feedSrc,
            killSwitch: msg.killSwitch,
          };
          // Throttle React HUD only (~5 Hz) so the canvas never janks from re-renders
          const now = performance.now();
          if (now - lastHudRef.current > 200) {
            lastHudRef.current = now;
            setHud({ ...hudSnapRef.current, price: r.displayPrice });
          }
          break;
        }
        case "bet_accepted":
          setBets((b) => [...b, msg.bet]);
          break;
        case "bet_settled":
          setBets((b) => b.map((x) => (x.id === msg.bet.id ? msg.bet : x)));
          if (msg.bet.state === "won" || msg.bet.state === "cashed_out") {
            toast(
              `${msg.bet.state === "won" ? "HIT" : "CASHED OUT"} +${(msg.bet.stake * msg.bet.mult).toFixed(2)} USDT (${msg.bet.mult.toFixed(2)}x)`,
              "w",
            );
          } else {
            toast(`MISS −${msg.bet.stake.toFixed(2)} USDT`, "l");
          }
          break;
        case "corridor":
          setCorridor(msg.corridor);
          break;
        case "vault":
          setVault(msg.vault);
          break;
        case "deposit_confirmed":
          setVault(msg.vault);
          toast(`DEPOSITED ${msg.amount.toFixed(2)} USDT`, "w");
          break;
        case "error":
          toast(msg.message, "l");
          break;
      }
    });
    return () => sock.disconnect();
  }, [toast, props?.walletAddress, props?.privyUserId]);

  useEffect(() => {
    socketRef.current?.setIdentity({
      walletId: props?.walletAddress,
      privyUserId: props?.privyUserId,
    });
  }, [props?.walletAddress, props?.privyUserId]);

  useEffect(() => {
    socketRef.current?.setAsset(asset);
    renderRef.current.camY = ASSETS[asset].p0;
    renderRef.current.targetPrice = ASSETS[asset].p0;
    renderRef.current.displayPrice = ASSETS[asset].p0;
    renderRef.current.hist = [];
  }, [asset]);

  const dec = () => ASSETS[renderRef.current.asset].dec;
  const nowX = (W: number) => W * 0.4;
  const pxPerSec = (W: number) => (W - nowX(W)) / CFG.futureSec;
  const rowPx = (H: number) => Math.min(52, Math.max(30, H / 20));

  const tToX = (t: number, W: number, now: number) => nowX(W) + (t - now) * pxPerSec(W);
  const pToY = (p: number, H: number, camY: number, rowPts: number) =>
    H / 2 - ((p - camY) / rowPts) * rowPx(H);
  const yToP = (y: number, H: number, camY: number, rowPts: number) =>
    camY + ((H / 2 - y) / rowPx(H)) * rowPts;

  const rr = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    r: number,
  ) => {
    if (!(w > 0) || !(h > 0)) return;
    r = Math.max(0, Math.min(r, h / 2, w / 2));
    ctx.beginPath();
    if (r < 0.5) {
      ctx.rect(x, y, w, h);
    } else {
      ctx.moveTo(x + r, y);
      ctx.arcTo(x + w, y, x + w, y + h, r);
      ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r);
      ctx.arcTo(x, y, x + w, y, r);
      ctx.closePath();
    }
  };

  useEffect(() => {
    const cv = cvRef.current;
    if (!cv) return;
    const cx = cv.getContext("2d");
    if (!cx) return;

    const resize = () => {
      const DPR = Math.min(devicePixelRatio || 1, 2);
      const W = innerWidth;
      const H = innerHeight;
      cv.width = W * DPR;
      cv.height = H * DPR;
      cv.style.width = `${W}px`;
      cv.style.height = `${H}px`;
      cx.setTransform(DPR, 0, 0, DPR, 0, 0);
      renderRef.current.W = W;
      renderRef.current.H = H;
      renderRef.current.DPR = DPR;
    };
    resize();
    addEventListener("resize", resize);

    let raf = 0;
    const draw = (frameMs: number) => {
      raf = requestAnimationFrame(draw);
      const r = renderRef.current;
      const { W, H } = r;
      const q = r.quote;
      if (!q || W === 0) return;

      const last = r.lastFrameMs || frameMs;
      const dtMs = Math.min(48, Math.max(0, frameMs - last));
      r.lastFrameMs = frameMs;

      // Ease displayed price toward latest feed target (~0.2 per frame at 60fps)
      r.displayPrice += (r.targetPrice - r.displayPrice) * 0.2;
      // Scroll time axis by real elapsed wall time (engine ticks ~100ms)
      r.displayNow += dtMs / 1000;
      // Soft-clamp if we drift too far behind/ahead of server clock
      if (Math.abs(r.displayNow - q.now) > 1.5) r.displayNow = q.now;
      else r.displayNow += (q.now - r.displayNow) * 0.05;

      const price = r.displayPrice;
      const nowT = r.displayNow;

      r.camY += (price - r.camY) * 0.08;
      const camY = r.camY;

      cx.clearRect(0, 0, W, H);
      cx.fillStyle = "#070a08";
      cx.fillRect(0, 0, W, H);
      const g = cx.createRadialGradient(W * 0.4, H * 0.5, 40, W * 0.4, H * 0.5, W * 0.7);
      g.addColorStop(0, "rgba(10,15,10,.9)");
      g.addColorStop(1, "rgba(7,10,8,0)");
      cx.fillStyle = g;
      cx.fillRect(0, 0, W, H);

      const rp = rowPx(H);
      cx.strokeStyle = "rgba(125,145,121,.07)";
      cx.lineWidth = 1;
      const kTop = Math.floor(yToP(-rp, H, camY, q.rowPts) / q.rowPts);
      const kBot = Math.ceil(yToP(H + rp, H, camY, q.rowPts) / q.rowPts);
      for (let k = kBot; k <= kTop; k++) {
        const y = pToY(k * q.rowPts, H, camY, q.rowPts);
        cx.beginPath();
        cx.moveTo(0, y);
        cx.lineTo(W, y);
        cx.stroke();
        if (k % 2 === 0) {
          const label = (k * q.rowPts).toFixed(dec());
          cx.font = "700 13px ui-monospace,monospace";
          const tw = cx.measureText(label).width;
          const padX = 8;
          const boxW = tw + padX * 2;
          const boxH = 20;
          const bx = W - boxW - 8;
          const by = y - boxH / 2;
          cx.fillStyle = "rgba(7,10,8,.85)";
          cx.strokeStyle = "rgba(182,255,46,.35)";
          cx.lineWidth = 1;
          rr(cx, bx, by, boxW, boxH, 6);
          cx.fill();
          cx.stroke();
          cx.fillStyle = "#e8f2e4";
          cx.textAlign = "right";
          cx.fillText(label, W - 16, y + 4);
        }
      }

      if (r.mode === "grid") {
        cx.textAlign = "center";
        for (const c of q.cells) {
          const x1 = tToX(c.t1, W, nowT);
          const x2 = tToX(c.t2, W, nowT);
          const yT = pToY(c.b, H, camY, q.rowPts);
          const yB = pToY(c.a, H, camY, q.rowPts);
          const cellW = x2 - x1;
          const cellH = yB - yT;
          if (cellW < 12 || cellH < 12) continue;
          if (x2 < nowX(W) + 2 || x1 > W || yB < 0 || yT > H) continue;
          if (!(c.mult > 1.05 && c.mult < CFG.maxMult)) continue;
          const locked = c.t1 - nowT < CFG.lockout;
          const hov = r.hover?.key === c.key;
          const cxm = (x1 + x2) / 2;
          const cym = (yT + yB) / 2;
          const rw = Math.max(8, Math.min(cellW - 10, 58));
          const rh = Math.max(8, Math.min(cellH - 8, 26));
          if (hov && !locked) {
            cx.fillStyle = "rgba(182,255,46,.16)";
            rr(cx, x1 + 2, yT + 2, cellW - 4, cellH - 4, 10);
            cx.fill();
            cx.strokeStyle = "rgba(182,255,46,.8)";
            cx.lineWidth = 1.4;
            rr(cx, x1 + 2, yT + 2, cellW - 4, cellH - 4, 10);
            cx.stroke();
          }
          rr(cx, cxm - rw / 2, cym - rh / 2, rw, rh, rh / 2);
          cx.fillStyle = locked
            ? "rgba(72,88,74,.25)"
            : hov
              ? "rgba(182,255,46,.9)"
              : "rgba(31,44,28,.85)";
          cx.fill();
          cx.font = "700 10.5px ui-monospace,monospace";
          cx.fillStyle = locked ? "rgba(72,88,74,.8)" : hov ? "#0a0f06" : "#a8c298";
          cx.fillText(`${fmt(c.mult)}x`, cxm, cym + 3.5);
        }
      }

      for (const b of r.bets) {
        const x1 = Math.max(tToX(b.t1, W, nowT), nowX(W));
        const x2 = tToX(b.t2, W, nowT);
        const yT = pToY(b.b, H, camY, q.rowPts);
        const yB = pToY(b.a, H, camY, q.rowPts);
        const bw = Math.max(0, x2 - x1);
        const bh = Math.max(0, yB - yT);
        if (bw < 8 || bh < 8) continue;
        const cxm = (x1 + x2) / 2;
        const cym = (yT + yB) / 2;
        const pillW = Math.min(68, bw - 4);
        const pillH = Math.min(30, bh - 4);
        let fill = "rgba(255,255,255,.95)";
        let ink = "#0a0d0a";
        if (b.state === "won" || b.state === "cashed_out") {
          fill = "rgba(182,255,46,.95)";
          ink = "#0a0f06";
        }
        if (b.state === "lost") {
          fill = "rgba(255,93,93,.25)";
          ink = "#ffb3b3";
        }
        rr(cx, cxm - pillW / 2, cym - pillH / 2, pillW, pillH, pillH / 2);
        cx.fillStyle = fill;
        cx.fill();
        cx.textAlign = "center";
        cx.fillStyle = ink;
        cx.font = "800 11px ui-monospace,monospace";
        cx.fillText(`${b.stake}₮`, cxm, cym - 2);
        cx.font = "700 9px ui-monospace,monospace";
        cx.fillText(`${fmt(b.mult)}x`, cxm, cym + 10);
      }

      const cor = r.corridor;
      if (cor) {
        const x0 = Math.max(0, tToX(cor.t0, W, nowT));
        const yHi = pToY(cor.hi, H, camY, q.rowPts);
        const yLo = pToY(cor.lo, H, camY, q.rowPts);
        cx.fillStyle = "rgba(143,216,255,.05)";
        cx.fillRect(x0, yHi, W - x0, yLo - yHi);
        cx.strokeStyle = "rgba(143,216,255,.85)";
        cx.lineWidth = 2;
        cx.setLineDash([2, 7]);
        cx.lineCap = "round";
        cx.beginPath();
        cx.moveTo(x0, yHi);
        cx.lineTo(W, yHi);
        cx.stroke();
        cx.beginPath();
        cx.moveTo(x0, yLo);
        cx.lineTo(W, yLo);
        cx.stroke();
        cx.setLineDash([]);
        cx.lineCap = "butt";
      }

      const hist = r.hist.length ? r.hist : q.hist;
      if (hist.length >= 2) {
        const y0 = pToY(price, H, camY, q.rowPts);
        cx.lineWidth = 2.2;
        cx.strokeStyle = "rgba(182,255,46,.9)";
        cx.lineJoin = "round";
        cx.lineCap = "round";
        cx.beginPath();
        let started = false;
        for (let i = 0; i < hist.length; i++) {
          const h = hist[i];
          const x = tToX(h.t, W, nowT);
          if (x < -10) continue;
          const y = pToY(h.p, H, camY, q.rowPts);
          if (!started) {
            cx.moveTo(x, y);
            started = true;
          } else cx.lineTo(x, y);
        }
        cx.lineTo(nowX(W), y0);
        cx.stroke();
        cx.fillStyle = "#b6ff2e";
        cx.beginPath();
        cx.arc(nowX(W), y0, 4, 0, Math.PI * 2);
        cx.fill();
      }
    };
    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      removeEventListener("resize", resize);
    };
  }, []);

  const onMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const q = renderRef.current.quote;
    if (!q || mode !== "grid") {
      renderRef.current.hover = null;
      return;
    }
    const W = renderRef.current.W || innerWidth;
    const nowT = renderRef.current.displayNow || q.now;
    const t = nowT + (e.clientX - nowX(W)) / pxPerSec(W);
    if (t <= nowT) {
      renderRef.current.hover = null;
      return;
    }
    const t1 = Math.floor(t / CFG.colSec) * CFG.colSec;
    const k = Math.floor(
      yToP(e.clientY, renderRef.current.H || innerHeight, renderRef.current.camY, q.rowPts) /
        q.rowPts,
    );
    const c = q.cells.find((cell) => cell.key === `${t1}:${k}`);
    renderRef.current.hover = c ?? null;
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (showModal) return;
    const q = renderRef.current.quote;
    if (!q) return;
    const W = renderRef.current.W || innerWidth;
    const H = renderRef.current.H || innerHeight;
    if (mode === "grid") {
      for (const b of bets) {
        if (b.state !== "open") continue;
        const x1 = tToX(b.t1, W, q.now);
        const x2 = tToX(b.t2, W, q.now);
        const yT = pToY(b.b, H, renderRef.current.camY, q.rowPts);
        const yB = pToY(b.a, H, renderRef.current.camY, q.rowPts);
        if (e.clientX >= x1 && e.clientX <= x2 && e.clientY >= yT && e.clientY <= yB) {
          setReceipt({
            bet: b,
            receipt: {
              betId: b.id,
              structure: "Range one-touch",
              band: `$${b.a.toFixed(dec())} – $${b.b.toFixed(dec())}`,
              impliedProb: b.p,
              fairMultiple: 1 / b.p,
              offeredMultiple: b.mult,
              disclosedEdge: 1 - b.mult * b.p,
              settlePrice: b.settlePrice ?? q.price,
              oracleTs: b.oracleTsAtTap,
              feedSource: q.feedSrc ?? q.feedMode,
              receiptHash: b.receiptHash ?? "",
              status: b.state,
            },
          });
          return;
        }
      }
      const hover = renderRef.current.hover;
      if (hover) {
        socketRef.current?.send({
          type: "tap",
          quoteId: hover.quoteId,
          cellKey: hover.key,
          stake,
          clientTs: Date.now(),
        });
      }
    } else if (mode === "corr" && !corridor) {
      socketRef.current?.send({ type: "start_corridor", stake, clientTs: Date.now() });
    }
  };

  const feedLabel =
    hud?.feedMode === "live" ? `LIVE · ${hud.feedSrc ?? ""}` : "SIM FEED";
  const pxClass = hud && hud.price >= hud.prev ? "up" : "dn";
  const volDisplay = hud ? Math.min(hud.volPct, 999).toFixed(0) : "—";

  return (
    <>
      <canvas
        id="cv"
        ref={cvRef}
        onMouseMove={onMouseMove}
        onClick={onClick}
        style={{ pointerEvents: showModal ? "none" : "auto" }}
      />

      <div className="hud" id="top">
        <div id="logo">
          SNAPLINE<span className="dot">●</span>
        </div>
        <span id="feedbadge" className={hud?.feedMode === "live" ? "live" : ""}>
          {hud ? feedLabel : "CONNECTING…"}
        </span>
        <div className="tabs" id="assets">
          {(["SPY", "QQQ", "AAPL"] as Asset[]).map((a) => (
            <button
              key={a}
              type="button"
              className={`tab ${asset === a ? "on" : ""}`}
              onClick={() => setAsset(a)}
              title={ASSETS[a].label}
            >
              {a}
            </button>
          ))}
        </div>
        <span id="px" className={pxClass}>
          {hud
            ? `$${hud.price.toLocaleString(undefined, {
                minimumFractionDigits: ASSETS[asset].dec,
                maximumFractionDigits: ASSETS[asset].dec,
              })}`
            : "—"}
        </span>
        <div className="st">
          <span className="v">{hud ? `${volDisplay}%` : "—"}</span>
          <span className="k">vol</span>
        </div>
        <div className="st">
          <span className="v" style={{ color: vault.pnl >= 0 ? "var(--lime)" : "var(--coral)" }}>
            {(vault.pnl >= 0 ? "+" : "−") + Math.abs(vault.pnl).toFixed(2)}
          </span>
          <span className="k">session</span>
        </div>
        <button id="vaultbtn" type="button" onClick={() => setShowVault((v) => !v)}>
          VAULT&nbsp;{" "}
          <b>{vault.balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}</b> USDT
        </button>
      </div>

      <div className="hud" id="bottom">
        {[1, 5, 25, 100].map((s) => (
          <button
            key={s}
            type="button"
            className={`chip ${stake === s ? "on" : ""}`}
            onClick={() => setStake(s)}
          >
            {s}
          </button>
        ))}
        <span style={{ width: 14 }} />
        <button
          type="button"
          className={`mbtn ${mode === "grid" ? "on" : ""}`}
          onClick={() => setMode("grid")}
        >
          TAP
        </button>
        <button
          type="button"
          className={`mbtn ${mode === "corr" ? "on" : ""}`}
          onClick={() => setMode("corr")}
        >
          TUNNEL
        </button>
        <button type="button" className="mbtn fair" onClick={() => setShowModal(true)}>
          FAIR PLAY
        </button>
      </div>

      <button
        id="cashout"
        type="button"
        className={corridor ? "show" : ""}
        onClick={() => socketRef.current?.send({ type: "cash_out", clientTs: Date.now() })}
      >
        CASH OUT <span>{corridor ? `${corridor.mult.toFixed(2)}x` : "1.00x"}</span>
      </button>

      {PRIVY_ON ? (
        <VaultPanel
          open={showVault}
          onClose={() => setShowVault(false)}
          vault={vault}
          asset={asset}
          send={(msg) => socketRef.current?.send(msg)}
          onToast={toast}
        />
      ) : (
        <MockVaultPanel
          open={showVault}
          onClose={() => setShowVault(false)}
          vault={vault}
          onDemoDeposit={() => socketRef.current?.send({ type: "deposit", amount: 500 })}
        />
      )}

      {receipt && (
        <div className="panel show" id="receipt">
          <button type="button" className="x" onClick={() => setReceipt(null)}>
            ✕
          </button>
          <h3>RECEIPT · {receipt.bet.id.toUpperCase()}</h3>
          {[
            ["Structure", receipt.receipt.structure],
            ["Band", receipt.receipt.band],
            ["Implied prob", `${(receipt.receipt.impliedProb * 100).toFixed(2)}%`],
            ["Fair multiple", `${receipt.receipt.fairMultiple.toFixed(2)}x`],
            ["Offered", `${receipt.receipt.offeredMultiple.toFixed(2)}x`],
            ["Disclosed edge", `${(receipt.receipt.disclosedEdge * 100).toFixed(1)}%`],
            ["Status", receipt.receipt.status.toUpperCase()],
            ["Receipt hash", (receipt.receipt.receiptHash || "pending").slice(0, 16) + "…"],
          ].map(([k, v]) => (
            <div className="row" key={k}>
              <span className="k">{k}</span>
              <span className="v">{v}</span>
            </div>
          ))}
        </div>
      )}

      <div id="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.cls}`}>
            {t.msg}
          </div>
        ))}
      </div>

      {showModal && (
        <div id="modal" className="show" role="dialog" aria-modal="true">
          <div className="card">
            <h2>
              SNAPLINE<span className="dot">●</span> &nbsp;TAP THE TAPE
            </h2>
            <p>
              <b>Tap a bubble.</b> If the price line touches it during its window, you win the
              multiplier. Edge is fixed and disclosed: <b>4.5%</b>.
            </p>
            <p>
              <b>TUNNEL</b> is a knock-out — stay inside the walls, cash out any time.
            </p>
            <p style={{ color: "var(--faint)", fontSize: 10.5 }}>
              Demo: play-money USDT, server-signed quotes. Personal beta only.
            </p>
            <div className="cta">
              <button type="button" onClick={() => setShowModal(false)}>
                TAP IN
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
