// Picks the backend: live NEAR (VITE_CONTRACT_ID set) or the PREVIEW mock.

import { PREVIEW } from "./config";
import { UtangClient } from "./contract";
import { PreviewTransport } from "./mock/transport";
import { PreviewWorld } from "./mock/world";

export * from "./types";
export * from "./config";
export { UtangClient } from "./contract";

export interface PreviewControls {
  world: PreviewWorld;
  /** Pretend to be any account (sign in) or null (sign out). */
  setAccount(accountId: string | null): void;
  skipDays(days: number): void;
  reset(): void;
}

export interface Backend {
  mode: "preview" | "live";
  client: UtangClient;
  getAccountId(): string | null;
  onAccountChange(fn: (accountId: string | null) => void): () => void;
  /** Live: opens the wallet selector modal. Preview: the UI shows its own account picker instead. */
  signIn(): void;
  signOut(): Promise<void>;
  /** Current contract time in ns (preview time can be skipped ahead). */
  now(): bigint;
  /** Subscribe to background changes (preview neighbours acting). */
  onChange(fn: () => void): () => void;
  preview?: PreviewControls;
}

const PREVIEW_ACCOUNT_KEY = "utang-preview-account";

export function createPreviewBackend(opts: { world?: PreviewWorld; latencyMs?: number; persistAccount?: boolean } = {}): Backend {
  let world = opts.world ?? PreviewWorld.load() ?? PreviewWorld.create();
  world.tick();
  world.save();
  const transport = new PreviewTransport(world, opts.latencyMs ?? 0);
  // Mutable so reset() can swap the world in place.
  const state = { transport, client: new UtangClient(transport) };
  const accountListeners = new Set<(id: string | null) => void>();
  const changeListeners = new Set<() => void>();
  let unsubWorld = world.subscribe(() => changeListeners.forEach((f) => f()));
  const persist = opts.persistAccount ?? true;
  if (persist) {
    try {
      state.transport.accountId = globalThis.localStorage?.getItem(PREVIEW_ACCOUNT_KEY) ?? null;
    } catch {
      /* ignore */
    }
  }
  const setAccount = (id: string | null) => {
    state.transport.accountId = id;
    if (persist) {
      try {
        if (id) globalThis.localStorage?.setItem(PREVIEW_ACCOUNT_KEY, id);
        else globalThis.localStorage?.removeItem(PREVIEW_ACCOUNT_KEY);
      } catch {
        /* ignore */
      }
    }
    accountListeners.forEach((f) => f(id));
  };
  const backend: Backend = {
    mode: "preview",
    get client() {
      return state.client;
    },
    getAccountId: () => state.transport.accountId,
    onAccountChange(fn) {
      accountListeners.add(fn);
      return () => accountListeners.delete(fn);
    },
    signIn() {
      /* UI-driven in preview */
    },
    async signOut() {
      setAccount(null);
    },
    now: () => world.now(),
    onChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    },
    preview: {
      get world() {
        return world;
      },
      setAccount,
      skipDays(days) {
        world.skip(days);
        changeListeners.forEach((f) => f());
      },
      reset() {
        PreviewWorld.clearSaved();
        unsubWorld();
        world = PreviewWorld.create();
        world.save();
        const t = new PreviewTransport(world, opts.latencyMs ?? 0);
        t.accountId = state.transport.accountId;
        state.transport = t;
        state.client = new UtangClient(t);
        unsubWorld = world.subscribe(() => changeListeners.forEach((f) => f()));
        changeListeners.forEach((f) => f());
      },
    },
  };
  return backend;
}

export async function createLiveBackend(): Promise<Backend> {
  // Wallet code (and its Node polyfill needs) is only loaded in live mode.
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

export function createBackend(): Promise<Backend> {
  return PREVIEW ? Promise.resolve(createPreviewBackend({ latencyMs: 350 })) : createLiveBackend();
}
