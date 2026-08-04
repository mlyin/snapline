"use client";

import { useCallback, useState } from "react";
import type { VaultState } from "@snapline/shared";
import { useSnaplineWallet } from "@/lib/wallet";

type Send = (msg: {
  type: "deposit_onchain";
  signature: string;
  amount: number;
  wallet: string;
} | { type: "deposit"; amount: number } | { type: "subscribe"; asset: "SPY" | "QQQ" | "AAPL"; walletId?: string }) => void;

export function VaultPanel(props: {
  open: boolean;
  onClose: () => void;
  vault: VaultState;
  asset: "SPY" | "QQQ" | "AAPL";
  send: Send;
  onToast: (msg: string, cls: "w" | "l") => void;
}) {
  const { privyConfigured, ready, authenticated, login, logout, address, sendUsdtDeposit } =
    useSnaplineWallet();
  const [busy, setBusy] = useState(false);
  const [amount, setAmount] = useState(10);

  const onDeposit = useCallback(async () => {
    if (!authenticated || !address) {
      login();
      return;
    }
    setBusy(true);
    try {
      props.onToast(`Sending ${amount} USDT…`, "w");
      const signature = await sendUsdtDeposit(amount);
      props.send({
        type: "deposit_onchain",
        signature,
        amount,
        wallet: address,
      });
      props.send({ type: "subscribe", asset: props.asset, walletId: address });
      props.onToast("Deposit submitted — verifying on-chain…", "w");
    } catch (e) {
      props.onToast(e instanceof Error ? e.message : "Deposit failed", "l");
    } finally {
      setBusy(false);
    }
  }, [authenticated, address, amount, login, sendUsdtDeposit, props]);

  if (!props.open) return null;

  return (
    <div className="panel show" id="vault">
      <button type="button" className="x" onClick={props.onClose}>
        ✕
      </button>
      <h3>USDT VAULT · SOLANA</h3>
      <div className="row">
        <span className="k">Your balance</span>
        <span className="v">{props.vault.balance.toFixed(2)} USDT</span>
      </div>
      <div className="row">
        <span className="k">In play</span>
        <span className="v">{props.vault.inPlay.toFixed(2)} USDT</span>
      </div>
      <div className="row">
        <span className="k">House bankroll</span>
        <span className="v">{Math.round(props.vault.house).toLocaleString()} USDT</span>
      </div>
      <div className="row">
        <span className="k">Wallet</span>
        <span className="v">
          {address ? `${address.slice(0, 4)}…${address.slice(-4)}` : "—"}
        </span>
      </div>
      <div className="row">
        <span className="k">Chain</span>
        <span className="v">Solana mainnet</span>
      </div>

      {!privyConfigured && (
        <div className="note">
          Set <b>NEXT_PUBLIC_PRIVY_APP_ID</b> and house wallet env vars to enable login + USDT
          deposits. Demo deposit still works below.
        </div>
      )}

      {privyConfigured && !authenticated && (
        <div className="note">
          Log in to deposit real <b>USDT</b> from your Solana wallet into the vault.
        </div>
      )}

      {authenticated && (
        <div className="note">
          Deposits send SPL USDT to the house wallet, then credit your play balance after on-chain
          verification. Withdrawals of real USDT land in a later release.
        </div>
      )}

      <div className="act" style={{ marginTop: 10, gap: 6, flexWrap: "wrap" }}>
        {[10, 25, 50, 100].map((a) => (
          <button
            key={a}
            type="button"
            className={`chip ${amount === a ? "on" : ""}`}
            style={{ pointerEvents: "auto", minWidth: 48 }}
            onClick={() => setAmount(a)}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="act">
        {privyConfigured && !authenticated && (
          <button id="depBtn" type="button" disabled={!ready} onClick={() => login()}>
            LOG IN
          </button>
        )}
        {privyConfigured && authenticated && (
          <>
            <button id="depBtn" type="button" disabled={busy || !ready} onClick={onDeposit}>
              {busy ? "SENDING…" : `DEPOSIT ${amount} USDT`}
            </button>
            <button id="wdBtn" type="button" onClick={() => logout()}>
              LOG OUT
            </button>
          </>
        )}
        {!privyConfigured && (
          <button
            id="depBtn"
            type="button"
            onClick={() => props.send({ type: "deposit", amount: 500 })}
          >
            + DEMO +500
          </button>
        )}
      </div>
    </div>
  );
}
