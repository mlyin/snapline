"use client";

import { useLogin } from "@privy-io/react-auth";

export function LoginScreen() {
  const { login } = useLogin();

  return (
    <div className="login-screen">
      <div className="login-glow" aria-hidden />
      <div className="login-card">
        <div className="login-brand">
          SNAPLINE<span className="dot">●</span>
        </div>
        <p className="login-tag">Tap the tape. Edge disclosed.</p>
        <p className="login-sub">
          Sign in to get a Solana embedded wallet and enter the game. Deposits use USDT on Solana —
          taps never prompt your wallet.
        </p>
        <button type="button" className="login-cta" onClick={() => login()}>
          Continue with email or Google
        </button>
        <p className="login-fine">Personal beta · lime on black · 4.5% disclosed edge</p>
      </div>
    </div>
  );
}
