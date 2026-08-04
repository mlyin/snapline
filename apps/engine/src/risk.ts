import type { BetRecord } from "@snapline/shared";
import { CFG } from "@snapline/shared";

export interface RiskConfig {
  perBubbleCap: number;
  perAssetNetDeltaCap: number;
  globalKillSwitch: boolean;
}

export const DEFAULT_RISK: RiskConfig = {
  perBubbleCap: 500,
  perAssetNetDeltaCap: 5000,
  globalKillSwitch: false,
};

export interface FlowScore {
  walletId: string;
  wins: number;
  bets: number;
  suspicious: boolean;
}

export class RiskManager {
  private bubbleExposure = new Map<string, number>();
  private assetDelta = new Map<string, number>();
  private flowScores = new Map<string, FlowScore>();
  killSwitch = false;

  setKillSwitch(on: boolean): void {
    this.killSwitch = on;
  }

  isPaused(): boolean {
    return this.killSwitch || DEFAULT_RISK.globalKillSwitch;
  }

  bubbleKey(t1: number, a: number, b: number): string {
    return `${t1}:${a}:${b}`;
  }

  canAcceptBubble(stake: number, t1: number, a: number, b: number): boolean {
    const key = this.bubbleKey(t1, a, b);
    const cur = this.bubbleExposure.get(key) ?? 0;
    return cur + stake <= DEFAULT_RISK.perBubbleCap;
  }

  recordBubble(stake: number, mult: number, t1: number, a: number, b: number, price: number): void {
    const key = this.bubbleKey(t1, a, b);
    this.bubbleExposure.set(key, (this.bubbleExposure.get(key) ?? 0) + stake);
    const mid = (a + b) / 2;
    const sign = Math.sign(mid - price);
    const assetKey = "default";
    this.assetDelta.set(assetKey, (this.assetDelta.get(assetKey) ?? 0) + stake * mult * sign);
  }

  releaseBubble(stake: number, t1: number, a: number, b: number): void {
    const key = this.bubbleKey(t1, a, b);
    const cur = this.bubbleExposure.get(key) ?? 0;
    this.bubbleExposure.set(key, Math.max(0, cur - stake));
  }

  exposureMultiplier(assetKey = "default"): number {
    const delta = Math.abs(this.assetDelta.get(assetKey) ?? 0);
    const fill = Math.min(1, delta / DEFAULT_RISK.perAssetNetDeltaCap);
    return Math.max(0.5, 1 - fill * 0.5);
  }

  recordOutcome(walletId: string, won: boolean): void {
    const s = this.flowScores.get(walletId) ?? { walletId, wins: 0, bets: 0, suspicious: false };
    s.bets++;
    if (won) s.wins++;
    s.suspicious = s.bets >= 20 && s.wins / s.bets > 0.65;
    this.flowScores.set(walletId, s);
  }

  isSuspicious(walletId: string): boolean {
    return this.flowScores.get(walletId)?.suspicious ?? false;
  }

  onFeedStall(stalled: boolean): void {
    if (stalled) this.killSwitch = true;
    else if (this.killSwitch) this.killSwitch = false;
  }

  throttleMult(mult: number): number {
    return Math.max(1.01, mult * this.exposureMultiplier());
  }
}

export function aggregateOpenDelta(bets: BetRecord[], price: number): number {
  let delta = 0;
  for (const b of bets) {
    if (b.state !== "open") continue;
    delta += b.stake * b.mult * Math.sign((b.a + b.b) / 2 - price);
  }
  return delta;
}
