import pg from "pg";
import type { BetRecord, SettlementReceipt } from "@snapline/shared";

const { Pool } = pg;

type VaultRow = { balance: number; pnl: number; house: number };

export interface LedgerEvent {
  id: number;
  kind: string;
  payload: string;
  createdAt: number;
}

/**
 * Postgres-backed ledger (Supabase DATABASE_URL) with an in-memory cache
 * so the 100ms tick loop can stay synchronous.
 * If DATABASE_URL is missing, runs in-memory so the HTTP server can still boot
 * (Railway healthcheck must not die on a missing env).
 */
export class Ledger {
  private pool: pg.Pool | null = null;
  private cache = new Map<string, VaultRow>();
  private credited = new Set<string>();
  private ready: Promise<void>;

  constructor(databaseUrl = process.env.DATABASE_URL) {
    this.cache.set("default", { balance: 1000, pnl: 0, house: 250000 });
    if (!databaseUrl) {
      console.warn("[ledger] DATABASE_URL missing — in-memory vault only");
      this.ready = Promise.resolve();
      return;
    }
    this.pool = new Pool({
      connectionString: databaseUrl,
      ssl: databaseUrl.includes("localhost") ? undefined : { rejectUnauthorized: false },
      max: 5,
      connectionTimeoutMillis: 15_000,
    });
    this.ready = this.init();
  }

  private async init(): Promise<void> {
    if (!this.pool) return;
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id BIGSERIAL PRIMARY KEY,
        kind TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS vault (
        wallet_id TEXT PRIMARY KEY,
        balance DOUBLE PRECISION NOT NULL DEFAULT 0,
        pnl DOUBLE PRECISION NOT NULL DEFAULT 0,
        house DOUBLE PRECISION NOT NULL DEFAULT 250000
      );
      CREATE TABLE IF NOT EXISTS credited_sigs (
        signature TEXT PRIMARY KEY,
        wallet_id TEXT NOT NULL,
        amount DOUBLE PRECISION NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const { rows } = await this.pool.query(`SELECT wallet_id, balance, pnl, house FROM vault`);
    for (const r of rows) {
      this.cache.set(String(r.wallet_id), {
        balance: Number(r.balance),
        pnl: Number(r.pnl),
        house: Number(r.house),
      });
    }
    if (!this.cache.has("default")) {
      this.cache.set("default", { balance: 1000, pnl: 0, house: 250000 });
      await this.pool.query(
        `INSERT INTO vault (wallet_id, balance, pnl, house) VALUES ($1,$2,$3,$4)
         ON CONFLICT (wallet_id) DO NOTHING`,
        ["default", 1000, 0, 250000],
      );
    }

    const sigs = await this.pool.query(`SELECT signature FROM credited_sigs`);
    for (const r of sigs.rows) this.credited.add(String(r.signature));
    console.log(`[ledger] Postgres ready — ${this.cache.size} vaults loaded`);
  }

  async ensureReady(): Promise<void> {
    await this.ready;
  }

  ensureWallet(walletId: string, startingBalance = 0): void {
    if (this.cache.has(walletId)) return;
    const house = this.cache.get("default")?.house ?? 250000;
    this.cache.set(walletId, { balance: startingBalance, pnl: 0, house });
    if (!this.pool) return;
    void this.ready.then(() =>
      this.pool!.query(
        `INSERT INTO vault (wallet_id, balance, pnl, house) VALUES ($1,$2,0,$3)
         ON CONFLICT (wallet_id) DO NOTHING`,
        [walletId, startingBalance, house],
      ),
    );
  }

  getVault(walletId = "default"): VaultRow {
    this.ensureWallet(walletId, walletId === "default" ? 1000 : 0);
    return { ...this.cache.get(walletId)! };
  }

  updateVault(walletId: string, delta: { balance?: number; pnl?: number; house?: number }): void {
    this.ensureWallet(walletId, walletId === "default" ? 1000 : 0);
    const cur = this.cache.get(walletId)!;
    const next = {
      balance: cur.balance + (delta.balance ?? 0),
      pnl: cur.pnl + (delta.pnl ?? 0),
      house: cur.house + (delta.house ?? 0),
    };
    this.cache.set(walletId, next);
    if (!this.pool) return;
    void this.ready.then(() =>
      this.pool!.query(`UPDATE vault SET balance=$2, pnl=$3, house=$4 WHERE wallet_id=$1`, [
        walletId,
        next.balance,
        next.pnl,
        next.house,
      ]),
    );
  }

  setBalance(walletId: string, balance: number): void {
    this.ensureWallet(walletId, 0);
    const cur = this.cache.get(walletId)!;
    cur.balance = balance;
    this.cache.set(walletId, cur);
    if (!this.pool) return;
    void this.ready.then(() =>
      this.pool!.query(`UPDATE vault SET balance=$2 WHERE wallet_id=$1`, [walletId, balance]),
    );
  }

  hasCreditedSig(signature: string): boolean {
    return this.credited.has(signature);
  }

  recordCreditedSig(signature: string, walletId: string, amount: number): void {
    this.credited.add(signature);
    if (!this.pool) return;
    void this.ready.then(() =>
      this.pool!.query(
        `INSERT INTO credited_sigs (signature, wallet_id, amount) VALUES ($1,$2,$3)
         ON CONFLICT (signature) DO NOTHING`,
        [signature, walletId, amount],
      ),
    );
  }

  append(kind: string, payload: unknown): void {
    if (!this.pool) return;
    void this.ready.then(() =>
      this.pool!.query(`INSERT INTO events (kind, payload) VALUES ($1, $2::jsonb)`, [
        kind,
        JSON.stringify(payload),
      ]),
    );
  }

  recordBet(bet: BetRecord): void {
    this.append("bet_placed", bet);
  }

  recordSettlement(bet: BetRecord, receipt: SettlementReceipt): void {
    this.append("bet_settled", { bet, receipt });
  }

  async listEvents(limit = 100): Promise<LedgerEvent[]> {
    await this.ready;
    if (!this.pool) return [];
    const { rows } = await this.pool.query(
      `SELECT id, kind, payload::text AS payload,
              EXTRACT(EPOCH FROM created_at)*1000 AS "createdAt"
       FROM events ORDER BY id DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      kind: String(r.kind),
      payload: String(r.payload),
      createdAt: Number(r.createdAt),
    }));
  }
}
