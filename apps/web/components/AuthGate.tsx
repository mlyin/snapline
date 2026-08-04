"use client";

import { useEffect, useRef } from "react";
import { useSessionSigners } from "@privy-io/react-auth";
import { useSnaplineWallet } from "@/lib/wallet";
import { LoginScreen } from "@/components/LoginScreen";
import { Game } from "@/components/Game";

const PRIVY_ON = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;
const SIGNER_ID = process.env.NEXT_PUBLIC_PRIVY_SIGNER_ID;

/**
 * Gates the game behind Privy when configured. Provisions Solana embedded wallet on login
 * and optionally attaches a session signer so on-chain actions can skip wallet prompts.
 */
export function AuthGate() {
  const { privyConfigured, ready, authenticated, address, user } = useSnaplineWallet();
  const { addSessionSigners } = useSessionSigners();
  const signedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!PRIVY_ON || !authenticated || !address || !SIGNER_ID) return;
    if (signedRef.current === address) return;
    signedRef.current = address;
    void addSessionSigners({
      address,
      signers: [{ signerId: SIGNER_ID, policyIds: [] }],
    }).catch((err) => {
      console.warn("[privy] session signer attach failed", err);
      signedRef.current = null;
    });
  }, [authenticated, address, addSessionSigners]);

  if (!privyConfigured) {
    return <Game />;
  }

  if (!ready) {
    return (
      <div className="login-screen">
        <div className="login-brand">
          SNAPLINE<span className="dot">●</span>
        </div>
        <p className="login-tag">Loading…</p>
      </div>
    );
  }

  if (!authenticated) {
    return <LoginScreen />;
  }

  if (!address) {
    return (
      <div className="login-screen">
        <div className="login-brand">
          SNAPLINE<span className="dot">●</span>
        </div>
        <p className="login-tag">Provisioning Solana wallet…</p>
      </div>
    );
  }

  return <Game privyUserId={user?.id} walletAddress={address} />;
}
