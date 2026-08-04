"use client";

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";

/** Solana mainnet USDT */
export const USDT_MINT = new PublicKey("Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB");
export const USDT_DECIMALS = 6;

export function getBrowserConnection(): Connection {
  const rpc =
    process.env.NEXT_PUBLIC_HELIUS_RPC ??
    process.env.NEXT_PUBLIC_SOLANA_RPC ??
    "https://api.mainnet-beta.solana.com";
  return new Connection(rpc, "confirmed");
}

export function houseWalletPubkey(): PublicKey {
  const w = process.env.NEXT_PUBLIC_HOUSE_WALLET_ADDRESS;
  if (!w) throw new Error("NEXT_PUBLIC_HOUSE_WALLET_ADDRESS is not set");
  return new PublicKey(w);
}

export type SolanaSigner = {
  address: string;
  sendTransaction: (tx: Transaction, connection: Connection) => Promise<string>;
};

export async function depositUsdt(opts: {
  wallet: SolanaSigner;
  amountUsdt: number;
}): Promise<string> {
  if (!(opts.amountUsdt > 0)) throw new Error("Amount must be positive");
  const connection = getBrowserConnection();
  const from = new PublicKey(opts.wallet.address);
  const house = houseWalletPubkey();
  const mint = USDT_MINT;

  const fromAta = getAssociatedTokenAddressSync(mint, from);
  const toAta = getAssociatedTokenAddressSync(mint, house);
  const raw = BigInt(Math.round(opts.amountUsdt * 10 ** USDT_DECIMALS));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({
    feePayer: from,
    blockhash,
    lastValidBlockHeight,
  });

  tx.add(
    createAssociatedTokenAccountIdempotentInstruction(from, toAta, house, mint),
    createTransferCheckedInstruction(fromAta, mint, toAta, from, raw, USDT_DECIMALS),
  );

  const sig = await opts.wallet.sendTransaction(tx, connection);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
  return sig;
}
