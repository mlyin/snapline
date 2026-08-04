import { Connection, PublicKey } from "@solana/web3.js";

/** Solana mainnet USDT (Tether) SPL mint */
export const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
export const USDT_DECIMALS = 6;

export function getConnection(): Connection {
  const rpc = process.env.HELIUS_RPC ?? process.env.SOLANA_RPC ?? "https://api.mainnet-beta.solana.com";
  return new Connection(rpc, "confirmed");
}

export function houseWallet(): string {
  const w = process.env.HOUSE_WALLET_ADDRESS;
  if (!w) throw new Error("HOUSE_WALLET_ADDRESS not set");
  return w;
}

/**
 * Verify a Solana tx transferred `amount` USDT from `fromWallet` to the house wallet.
 * Credits are in whole USDT (UI units), on-chain amount uses 6 decimals.
 */
export async function verifyUsdtDeposit(opts: {
  signature: string;
  fromWallet: string;
  amountUsdt: number;
}): Promise<{ ok: true; amount: number } | { ok: false; reason: string }> {
  const house = houseWallet();
  const connection = getConnection();
  const expectedRaw = Math.round(opts.amountUsdt * 10 ** USDT_DECIMALS);

  let tx = await connection.getParsedTransaction(opts.signature, {
    maxSupportedTransactionVersion: 0,
    commitment: "confirmed",
  });

  for (let i = 0; i < 8 && !tx; i++) {
    await new Promise((r) => setTimeout(r, 500));
    tx = await connection.getParsedTransaction(opts.signature, {
      maxSupportedTransactionVersion: 0,
      commitment: "confirmed",
    });
  }

  if (!tx) return { ok: false, reason: "Transaction not found on-chain yet" };
  if (tx.meta?.err) return { ok: false, reason: "Transaction failed on-chain" };

  try {
    new PublicKey(opts.fromWallet);
    new PublicKey(house);
  } catch {
    return { ok: false, reason: "Invalid wallet address" };
  }

  const mint = USDT_MINT;
  const pre = tx.meta?.preTokenBalances ?? [];
  const post = tx.meta?.postTokenBalances ?? [];

  const deltaFor = (owner: string) => {
    const preBal = pre.find((b) => b.mint === mint && b.owner === owner);
    const postBal = post.find((b) => b.mint === mint && b.owner === owner);
    const a = Number(preBal?.uiTokenAmount?.amount ?? 0);
    const b = Number(postBal?.uiTokenAmount?.amount ?? 0);
    return b - a;
  };

  const houseDelta = deltaFor(house);
  const userDelta = deltaFor(opts.fromWallet);

  if (houseDelta <= 0) return { ok: false, reason: "No USDT received by house wallet" };
  if (userDelta >= 0) return { ok: false, reason: "No USDT sent from your wallet" };

  if (houseDelta + 1 < expectedRaw) {
    return {
      ok: false,
      reason: `On-chain amount too low (got ${houseDelta / 10 ** USDT_DECIMALS} USDT)`,
    };
  }

  return { ok: true, amount: houseDelta / 10 ** USDT_DECIMALS };
}
