import type { Asset, ClientMessage, ServerMessage } from "@snapline/shared";

export type MessageHandler = (msg: ServerMessage) => void;

function resolveWsUrl(): string {
  if (typeof window === "undefined") return "ws://localhost:8787/ws";
  return (
    process.env.NEXT_PUBLIC_ENGINE_WS ??
    process.env.NEXT_PUBLIC_WS_URL ??
    "ws://localhost:8787/ws"
  );
}

export class SnaplineSocket {
  private ws: WebSocket | null = null;
  private handler: MessageHandler | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private asset: Asset = "SPY";
  private walletId: string | undefined;
  private privyUserId: string | undefined;
  private intentionalClose = false;

  setIdentity(opts: { walletId?: string | null; privyUserId?: string | null }): void {
    this.walletId = opts.walletId ?? undefined;
    this.privyUserId = opts.privyUserId ?? undefined;
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.sendSubscribe();
    }
  }

  connect(onMessage: MessageHandler): void {
    this.handler = onMessage;
    this.intentionalClose = false;
    this.open();
  }

  private open(): void {
    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
      return;
    }
    this.ws = new WebSocket(resolveWsUrl());
    this.ws.onopen = () => this.sendSubscribe();
    this.ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(String(e.data)) as ServerMessage;
        this.handler?.(msg);
      } catch {
        /* ignore */
      }
    };
    this.ws.onclose = () => {
      this.ws = null;
      if (this.intentionalClose) return;
      this.reconnectTimer = setTimeout(() => this.open(), 1500);
    };
  }

  private sendSubscribe(): void {
    this.send({
      type: "subscribe",
      asset: this.asset,
      walletId: this.walletId,
      privyUserId: this.privyUserId,
    });
  }

  send(msg: ClientMessage): void {
    const withId: ClientMessage =
      "walletId" in msg || msg.type === "deposit" || msg.type === "deposit_onchain"
        ? msg
        : ({
            ...msg,
            walletId: this.walletId,
            privyUserId: this.privyUserId,
          } as ClientMessage);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(withId));
    }
  }

  setAsset(asset: Asset): void {
    this.asset = asset;
    this.sendSubscribe();
  }

  disconnect(): void {
    this.intentionalClose = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
  }
}
