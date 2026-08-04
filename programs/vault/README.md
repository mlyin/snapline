# SNAPLINE On-Chain Vault (Phase 4)

Anchor program placeholder. **Do not implement until Phases 1–3 are stable.**

Per the build playbook:

- Non-custodial Solana vault: users deposit USDC/USDT into a PDA they control
- Bets escrow from user balance; settlement verifies Pyth price at expiry
- Server signer in MPC/HSM (Turnkey/Fireblocks) — never a hot env key
- Timelock upgrades; per-epoch outflow caps
- Two independent audits before real strangers' money

Until then, the mock vault in `apps/engine/src/ledger.ts` (SQLite) handles solo beta balances.
