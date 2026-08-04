import { Game } from "@/components/Game";
import { AuthGate } from "@/components/AuthGate";

const PRIVY_ON = !!process.env.NEXT_PUBLIC_PRIVY_APP_ID;

export default function Home() {
  return PRIVY_ON ? <AuthGate /> : <Game />;
}
