// Live NEAR backend. Isolated so a Preview production build can drop this
// chunk (and the wallet selector) instead of modulepreloading it.
import { UtangClient } from "./contract";
import type { Backend } from "./index";

export async function createLiveBackend(): Promise<Backend> {
  const { initWallet } = await import("./wallet");
  const handle = await initWallet();
  const client = new UtangClient(handle.transport);
  return {
    mode: "live",
    client,
    getAccountId: handle.getAccountId,
    onAccountChange: handle.onAccountChange,
    signIn: handle.signIn,
    signOut: handle.signOut,
    now: () => BigInt(Date.now()) * 1_000_000n,
    onChange: () => () => {},
  };
}
