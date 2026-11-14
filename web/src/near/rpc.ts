// Read-only NEAR JSON-RPC view calls via @near-js/providers.

import { JsonRpcProvider } from "@near-js/providers";
import { CONTRACT_ID, RPC_URL } from "./config";
import { ContractError } from "./transport";

let provider: JsonRpcProvider | null = null;

function getProvider(): JsonRpcProvider {
  if (!provider) provider = new JsonRpcProvider({ url: RPC_URL });
  return provider;
}

export async function viewCall<T>(method: string, args: Record<string, unknown> = {}, contractId = CONTRACT_ID): Promise<T> {
  try {
    const result = await getProvider().callFunction(contractId, method, args);
    return (result === undefined ? null : result) as T;
  } catch (e) {
    throw new ContractError(errorText(e));
  }
}

export function errorText(e: unknown): string {
  if (!e) return "Unknown error";
  if (typeof e === "string") return e;
  const anyE = e as any;
  const msg = anyE.message ?? anyE.toString?.() ?? JSON.stringify(e);
  return String(msg);
}
