# SNAPLINE — Solo Build Playbook (Cursor)
### From the MVP file to a deployed beta you can bet real (small) USDT on
*Written for you building this yourself in Cursor. Opinionated, sequenced, and honest about where the real risk is. Read §0 before you write a line of code.*

---

## 0. Read this first — the two rules that keep you out of trouble

1. **Beta with only yourself and a tiny bankroll is fine. The moment a second person deposits real money, you are operating an unlicensed derivatives/gambling venue.** For a *personal* beta — your own wallet, your own USDT, testing the loop — you're a developer testing software. That's the phase this playbook targets. Before you onboard *anyone else* with real money, you need the offshore entity + geofence + a counsel opinion (see the DD report §4). Don't skip from "I tested it myself" to "my friends are depositing" without that step.
2. **Never hold anyone else's funds custodially, ever.** The mock vault in the MVP becomes a non-custodial on-chain program. Your server signs prices and settlement; it never holds keys to user balances. This is both the trust story and your legal firebreak.

Everything below assumes: **you, solo, testing with your own money, on testnet first, then mainnet with <$100 total at risk.**

---

## 1. What you already have

- `blip.html` — the complete front-end game: canvas renderer, the verified pricing engine (quadrature touch-prob + BGK correction + survival curves), live Binance/OKX WebSocket feeds with sim fallback, tap + tunnel modes, mock vault, fair-play receipts. This is your frontend spec and ~70% of your frontend code.
- `verify_pricing.py` — the Monte Carlo test suite. Port these assertions to your backend as unit tests; if the backend pricing ever diverges from these, you have a bug that costs real money.

The build is: **split that one file into a real client + a real pricing/settlement backend + an on-chain vault, then deploy.**

---

## 2. Stack (chosen for solo speed, not theoretical perfection)

| Layer | Pick | Why |
|---|---|---|
| Frontend | **Next.js + React + TypeScript**, canvas game ported from `blip.html` as a client component | Vercel deploy in one command; you already have the game logic |
| Realtime | **WebSocket** from your pricing service (not the exchange directly — the client must trust *your* quote, not raw exchange ticks) | The whole anti-snipe model depends on the server being the source of truth |
| Backend | **Rust** (axum + tokio) *or* **Node/TypeScript** (Fastify + ws) | Rust if you're comfortable — it's the right long-term call for a pricing engine. **Node if you want to move fastest with Cursor** — port the JS engine from the MVP almost verbatim. For a solo beta, start Node, rewrite the hot path in Rust later. |
| Price feed | Exchange WebSockets (Binance `wss://stream.binance.com:9443`, OKX, Coinbase) for crypto; **later** Pyth Lazer/Hermes for signed data | Crypto spot feeds are free and public. Signed oracle data (Pyth) is what you settle against in production |
| Ledger DB | **Postgres** (Supabase or Neon free tier), append-only bet/settlement tables | Every quote, tap, and settlement is a row. This is your audit trail and your provably-fair backbone |
| Cache/bus | **Redis** (Upstash) | Pub/sub for quote fanout, rate limits, flow-scoring counters |
| Wallet/auth | **Privy** (embedded wallets + session keys) | One SDK: email/social login → embedded Solana wallet → session keys so every tap signs locally with no popup |
| Chain | **Solana devnet → mainnet** | Your instinct; 400ms slots fit the tick; cheap; best onboarding. Vault program in **Anchor (Rust)** |
| Deploy | Vercel (frontend) + **Railway/Fly.io** (backend + WS) + Supabase (DB) | All have generous free/cheap tiers; all deploy from GitHub in minutes |

**Do not** try to write the Anchor vault program on day one. Phases 1–3 below run with the *mock* vault (server-side balances in Postgres, your own account only). The on-chain vault is Phase 4, and it's the one place to slow down and get an audit before real strangers.

---

## 3. Repository structure

```
blip/
├─ apps/
│  ├─ web/                 # Next.js frontend
│  │  ├─ app/
│  │  ├─ components/Game.tsx        # canvas game (port from blip.html)
│  │  ├─ lib/ws.ts                  # connects to YOUR pricing WS
│  │  └─ lib/wallet.ts              # Privy + session keys
│  └─ engine/              # backend pricing + settlement service
│     ├─ src/pricing.ts             # port touchProb / survivalCurve / offered()
│     ├─ src/feed.ts                # exchange WS ingest + EWMA vol
│     ├─ src/quotes.ts              # 400ms grid repricer + WS fanout
│     ├─ src/bets.ts                # accept signed taps, lock, settle
│     ├─ src/risk.ts                # caps, flow scoring, kill switch
│     └─ src/ledger.ts              # Postgres writes (event-sourced)
├─ programs/
│  └─ vault/               # Anchor program (Phase 4)
├─ packages/
│  └─ shared/              # shared types: Quote, Bet, Settlement
└─ test/
   └─ pricing.test.ts      # port verify_pricing.py assertions
```

Tell Cursor: *"Port the pricing functions (`touchProb`, `startWindowProb`, `survivalCurve`, `offered`) from blip.html into apps/engine/src/pricing.ts as typed TypeScript. Then port the assertions in verify_pricing.py into test/pricing.test.ts using vitest, and make them pass."* That single prompt gets you a verified backend pricing core.

---

## 4. Build phases (each is a working, testable milestone)

### Phase 1 — Backend pricing service (no chain, no money)
- Port the engine to `apps/engine`. Feed ingest from Binance WS → EWMA vol → 400ms grid repricer → broadcast quotes over your own WS.
- **Key architectural rule the MVP already encodes:** the client renders quotes but never computes settlement. The server timestamps every quote, and a tap settles against the *server's* price snapshot at the tap timestamp + commit delay — never the client's rendered price. This is your entire anti-latency-arb defense; don't let Cursor "simplify" it away.
- Test: `pricing.test.ts` green (matches the MC suite), quotes streaming, reconnect logic solid.
- **Gate:** run it a few hours against live BTC; confirm realized edge on simulated auto-play is ~4.5% and positive (reuse the MVP's settlement logic in a headless loop).

### Phase 2 — Frontend on real backend
- Port the canvas game to `Game.tsx`. It connects to your WS, renders quotes, sends taps as messages. Keep the mock vault (Postgres balance for *your* account only).
- Add: real bet ledger (every tap → row: quote_id, price_snapshot, band, window, stake, mult, oracle_ts), settlement writes, receipt reads from the ledger.
- Deploy frontend to Vercel, backend to Railway. Play it on your phone. **This is a shareable beta of the *game* — still play money.**

### Phase 3 — Risk + fairness layer
- `risk.ts`: per-bubble aggregate cap, per-asset net-delta cap that throttles multipliers as exposure fills, a global kill switch (pause new bets on feed stall/gap), per-wallet flow score (win-rate vs feed-move-timing correlation).
- Provably-fair: publish, for each settled bet, the price + timestamp + feed source it settled against, hashed into the receipt. (Full on-chain attestation is Phase 4; here it's a signed JSON your server can't retroactively alter.)
- **Gate:** try to break your own pricing. Write a bot that taps only when BTC just moved — if it makes money, your commit delay / feed freshness is too loose. Fix until the bot can't win.

### Phase 4 — On-chain USDT vault (the careful one)
- Anchor program on Solana: user deposits USDC/USDT into a PDA-controlled account they can always withdraw from; bets escrow from their balance; settlement is a server-signed instruction the program verifies against a Pyth price at expiry (via Pyth's Solana receiver), with a dispute window.
- Server holds a **signer key in an MPC/HSM setup (Turnkey or Fireblocks), never a hot key in an env var.** Timelock program upgrades. Cap per-epoch vault outflows.
- **Do not put real strangers' money through this without two independent audits.** For your *own* mainnet beta: deploy, fund only your wallet, cap total at <$100, and treat the first weeks as adversarial testing of your own settlement path (the Ostium $18M and Drift $285M hacks were both this layer).

### Phase 5 — Beta hardening
- Telegram Mini App wrapper (this is the real distribution channel for the category — app stores will reject it). Privy session keys so taps are frictionless.
- Geofencing (`GeoComply`-grade if you can afford it, IP-block minimum) + KYC-at-threshold — **required before anyone but you touches it with real money.**
- Observability: reconciliation job (ledger vs chain must always match), alerts on feed stall / edge drift / vault drawdown.

---

## 5. The pricing engine — the one thing not to get wrong

Your edge is only real if quotes are honest and fresh. Port these exactly, and keep the tests:

- `touchProb(S, σ, T1, T2, a, b)` — range one-touch probability via 41-point Gauss-Hermite quadrature over the window-open price, with the **Broadie-Glasserman-Kou discrete-monitoring correction** (the `c = 0.5826·σ·√MON` band shrink). This correction is why the MVP's realized edge matches the quoted edge instead of overcharging 4×. If you drop it, you silently rob players and the fair-play story is a lie.
- `survivalCurve(σ, H, …)` — tunnel/knock-out via density evolution. Cash-out multiple = (1−edge)/survival.
- `offered(p) = clamp((1−edge)/p, 1.01, 99)`.
- **Vol estimation:** EWMA in the MVP is fine for beta. Upgrade path: regime-switching or a short-horizon realized-vol nowcast; shade edge up in high-uncertainty windows.

Keep `verify_pricing.py` as CI. If a change makes it fail, the change is wrong.

---

## 6. Costs (solo beta, monthly)

- Vercel / Railway / Supabase / Upstash free tiers: **$0** to start, ~$20–50/mo as you grow.
- Privy: free tier covers a beta.
- Crypto price feeds: **$0** (public exchange WS). Pyth Hermes (signed, for settlement): free tier exists; Pyth Pro only when you add equities.
- Solana: devnet free; mainnet a few dollars in rent/fees.
- Audit (before real strangers): **$15–50k** — the one unavoidable real cost, and non-negotiable for Phase 4 with other people's money.
- **Total to a personal mainnet beta: effectively your time + <$100 at risk + a domain.**

---

## 7. Cursor working style (what actually helps)

- Give Cursor `blip.html` and `verify_pricing.py` as context up front: *"This is the reference implementation and its test suite. We're splitting it into a Next.js frontend and a Node backend, preserving the exact pricing math."*
- Build the **test file first**, then implement against it. The MC assertions are your spec.
- One phase per branch. Don't let it scaffold the Anchor program while Phase 1 is unfinished.
- When it suggests "simplifying" the price-snapshot-at-tap logic or the commit delay — **stop it.** That's the anti-arb core, not boilerplate.
- Ask it to write the reconciliation job early; catching ledger/chain drift is what saves you from a silent draining bug.

---

## 8. The honest gate before you go past a personal beta

Before a single other person deposits real money, you need, in order: (1) the offshore entity + a US-person exposure opinion from crypto-derivatives counsel; (2) real geofencing + KYC-at-threshold; (3) two audits of the vault program; (4) an AML screening integration (Chainalysis/TRM). Until all four exist, keep it to yourself and your own wallet. The DD report's §4 and §10 are the checklist. Building and testing solo is smart and legal; scaling to others without that stack is the line where this stops being software development and starts being the thing that got Abra and Polymarket in trouble.

---

*Companion docs: `gridline_implementation_dd.md` (full regulatory + architecture DD), `blip.html` (reference frontend + engine), `verify_pricing.py` (pricing test suite), `blip_deck.pptx` (investor deck).*
