// A transport is how the typed client reaches "the contract": either NEAR JSON-RPC + a wallet,
// or the in-memory preview mock. Both speak the same method names and JSON shapes.

export interface CallOptions {
  /** Attached deposit in yoctoNEAR. */
  deposit?: bigint;
  /** Gas in gas units. Defaults to 50 Tgas. */
  gas?: bigint;
}

export interface Transport {
  readonly kind: "live" | "preview";
  view<T>(method: string, args?: Record<string, unknown>): Promise<T>;
  /**
   * Sends a change call signed by the current account. Resolves with the decoded return value,
   * or `undefined` when the wallet redirected away / did not return an outcome.
   */
  call<T>(method: string, args: Record<string, unknown>, opts?: CallOptions): Promise<T | undefined>;
}

export class ContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractError";
  }
}
