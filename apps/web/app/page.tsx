"use client";

import { Game } from "@/components/Game";
import { AuthGate } from "@/components/AuthGate";

const PRIVY_ON = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export default function Home() {
  // AuthGate uses Privy hooks — only mount when Providers wraps with PrivyProvider
  return PRIVY_ON ? <AuthGate /> : <Game />;
}
