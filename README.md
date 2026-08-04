# SNAPLINE — Solo Build

Monorepo split from `reference/blip.html`: Next.js frontend + Node pricing/settlement engine + shared types.

## Structure

```
├─ apps/web/          Next.js canvas game (connects to your WS)
├─ apps/engine/       Pricing service (Binance/OKX feed → 400ms quotes → settlement)
├─ packages/shared/   Shared types (Quote, Bet, Settlement)
├─ test/              Vitest pricing verification (MC suite)
└─ programs/vault/    Phase 4 Anchor stub
```

## Quick start

```bash
pnpm install
pnpm --filter @snapline/shared build
pnpm test                 # pricing MC tests
pnpm dev                  # engine :8787 + web :3000
```

Open [http://localhost:3000](http://localhost:3000). Engine WebSocket: `ws://localhost:8787/ws`.

## Phases (from playbook)

| Phase | Status |
|-------|--------|
| 1 — Backend pricing service | ✅ Engine + tests |
| 2 — Frontend on real backend | ✅ Next.js + WS |
| 3 — Risk + fairness layer | ✅ risk.ts, signed receipt hashes |
| 4 — On-chain USDT vault | 📋 Stub only |
| 5 — Beta hardening | 📋 Privy/geofence later |

## Key rules

- **Client renders quotes; server settles.** Taps lock against server price snapshot + commit delay.
- **Mock vault only** — personal beta with your own play-money balance in SQLite.
- Do not onboard others with real money without legal/compliance stack (see playbook §8).

## Reference files

- `reference/blip.html` — original MVP (pre-rename)
- `verify_pricing.py` — Python MC verification companion

## Deploy

- **Web:** Vercel (`apps/web`)
- **Engine:** Railway/Fly.io (`apps/engine`, set `PORT`)
- Set `NEXT_PUBLIC_WS_URL` to your engine WS URL
