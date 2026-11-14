import { ContractError } from "./transport";

/** Reads the function's return value from a FinalExecutionOutcome; throws on failure. */
export function decodeOutcome<T>(outcome: unknown): T | undefined {
  if (!outcome || typeof outcome !== "object") return undefined; // redirect wallets return nothing
  const status = (outcome as any).status;
  if (status && typeof status === "object" && "Failure" in status) {
    throw new ContractError(failureText(status.Failure));
  }
  // Surface a panic in any receipt (e.g. the contract call itself).
  for (const r of (outcome as any).receipts_outcome ?? []) {
    const st = r?.outcome?.status;
    if (st && typeof st === "object" && "Failure" in st) throw new ContractError(failureText(st.Failure));
  }
  const b64 = status?.SuccessValue;
  if (typeof b64 !== "string" || b64 === "") return undefined;
  try {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return undefined;
  }
}

function failureText(f: any): string {
  const exec = f?.ActionError?.kind?.FunctionCallError?.ExecutionError;
  if (typeof exec === "string") return exec;
  return JSON.stringify(f);
}
