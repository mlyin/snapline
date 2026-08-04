"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useSolanaWallets } from "@privy-io/react-auth/solana";
import { useCallback, useMemo } from "react";
import { depositUsdt } from "./solana";

export function useSnaplineWallet() {
  const privyReady = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets } = useSolanaWallets();

  const solanaWallet = useMemo(() => {
    return wallets.find((w) => w.walletClientType === "privy") ?? wallets[0] ?? null;
  }, [wallets]);

  const address = solanaWallet?.address ?? null;

  const sendUsdtDeposit = useCallback(
    async (amountUsdt: number) => {
      if (!solanaWallet) throw new Error("No Solana wallet — log in first");
      return depositUsdt({
        amountUsdt,
        wallet: {
          address: solanaWallet.address,
          sendTransaction: async (tx, connection) => {
            const sig = await solanaWallet.sendTransaction(tx, connection);
            return typeof sig === "string" ? sig : String(sig);
          },
        },
      });
    },
    [solanaWallet],
  );

  return {
    privyConfigured: privyReady,
    ready: privyReady ? ready : true,
    authenticated: privyReady ? authenticated : false,
    login,
    logout,
    user,
    address,
    sendUsdtDeposit,
  };
}
