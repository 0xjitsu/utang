import { ContractError, type CallOptions, type Transport } from "../transport";
import { GAS } from "../config";
import { MockPanic } from "./contract";
import type { PreviewWorld } from "./world";

/** Transport backed by the in-memory PreviewWorld. Values are JSON round-tripped like real RPC. */
export class PreviewTransport implements Transport {
  readonly kind = "preview" as const;
  accountId: string | null = null;

  constructor(
    readonly world: PreviewWorld,
    private readonly latencyMs = 0,
  ) {}

  async view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    this.world.tick();
    try {
      const v = this.world.contract.view(method, roundtrip(args), this.world.now());
      return roundtrip(v) as T;
    } catch (e) {
      throw wrap(e);
    }
  }

  async call<T>(method: string, args: Record<string, unknown>, opts: CallOptions = {}): Promise<T | undefined> {
    if (!this.accountId) throw new ContractError("Connect a wallet first");
    if ((opts.gas ?? GAS) <= 0n) throw new ContractError("Not enough gas");
    if (this.latencyMs) await new Promise((r) => setTimeout(r, this.latencyMs));
    this.world.tick();
    try {
      const v = this.world.contract.call(this.accountId, method, roundtrip(args), opts.deposit ?? 0n, this.world.now());
      this.world.afterPlayerAction();
      return (v === undefined ? undefined : roundtrip(v)) as T | undefined;
    } catch (e) {
      throw wrap(e);
    }
  }
}

function roundtrip<T>(v: T): T {
  return v === undefined ? v : JSON.parse(JSON.stringify(v));
}

function wrap(e: unknown): Error {
  if (e instanceof MockPanic) return new ContractError(`Smart contract panicked: ${e.message}`);
  return e instanceof Error ? e : new Error(String(e));
}
