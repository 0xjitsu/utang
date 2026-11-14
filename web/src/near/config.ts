// Build-time configuration (Vite env vars).
//   VITE_NETWORK      testnet (default) | mainnet
//   VITE_CONTRACT_ID  the deployed $UTANG contract. Empty => PREVIEW mode (in-memory mock).
//   VITE_RPC_URL      optional JSON-RPC override

export type NetworkId = "testnet" | "mainnet";

const env = import.meta.env ?? {};

export const NETWORK: NetworkId = env.VITE_NETWORK === "mainnet" ? "mainnet" : "testnet";

export const CONTRACT_ID: string = String(env.VITE_CONTRACT_ID ?? "").trim();

/** No contract configured: run against the in-browser mock. */
export const PREVIEW: boolean = CONTRACT_ID === "";

export const RPC_URL: string =
  String(env.VITE_RPC_URL ?? "").trim() ||
  (NETWORK === "mainnet" ? "https://free.rpc.fastnear.com" : "https://test.rpc.fastnear.com");

export const EXPLORER_URL =
  NETWORK === "mainnet" ? "https://nearblocks.io" : "https://testnet.nearblocks.io";

/** ~50 Tgas for every change call. */
export const GAS = 50_000_000_000_000n;

/** NEP-141 transfers require exactly 1 yoctoNEAR. */
export const ONE_YOCTO = 1n;

/** 0.01 NEAR in yoctoNEAR, the NEP-145 join deposit (also returned by rules().join_deposit). */
export const JOIN_DEPOSIT_YOCTO = 10_000_000_000_000_000_000_000n;
