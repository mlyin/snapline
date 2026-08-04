"use client";

import type { VaultState } from "@snapline/shared";

/** Shown when Privy env is not configured — play-money only. */
export function MockVaultPanel(props: {
  open: boolean;
  onClose: () => void;
  vault: VaultState;
  onDemoDeposit: () => void;
}) {
  if (!props.open) return null;
  return (
    <div className="panel show" id="vault">
      <button type="button" className="x" onClick={props.onClose}>
        ✕
      </button>
      <h3>USDT VAULT · DEMO</h3>
      <div className="row">
        <span className="k">Your balance</span>
        <span className="v">{props.vault.balance.toFixed(2)} USDT</span>
      </div>
      <div className="row">
        <span className="k">In play</span>
        <span className="v">{props.vault.inPlay.toFixed(2)} USDT</span>
      </div>
      <div className="row">
        <span className="k">Chain</span>
        <span className="v">Demo (no chain)</span>
      </div>
      <div className="note">
        Add <b>NEXT_PUBLIC_PRIVY_APP_ID</b> + <b>NEXT_PUBLIC_HOUSE_WALLET_ADDRESS</b> to enable
        real Solana USDT deposits after login.
      </div>
      <div className="act">
        <button id="depBtn" type="button" onClick={props.onDemoDeposit}>
          + DEMO +500
        </button>
      </div>
    </div>
  );
}
