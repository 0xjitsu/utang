import { describe, expect, it } from "vitest";
import { decodeOutcome } from "./outcome";

const b64 = (s: string) => Buffer.from(s).toString("base64");

describe("decodeOutcome", () => {
  it("decodes a JSON return value (ask -> loan id)", () => {
    expect(decodeOutcome({ status: { SuccessValue: b64("42") }, receipts_outcome: [] })).toBe(42);
  });
  it("returns undefined for empty results and redirect wallets", () => {
    expect(decodeOutcome({ status: { SuccessValue: "" } })).toBeUndefined();
    expect(decodeOutcome(undefined)).toBeUndefined();
  });
  it("throws the panic message from a failed receipt", () => {
    const failure = {
      ActionError: { kind: { FunctionCallError: { ExecutionError: "Smart contract panicked: Bayad muna: you have an overdue loan" } } },
    };
    expect(() =>
      decodeOutcome({ status: { SuccessValue: "" }, receipts_outcome: [{ outcome: { status: { Failure: failure } } }] }),
    ).toThrow(/Bayad muna/);
    expect(() => decodeOutcome({ status: { Failure: failure } })).toThrow(/Bayad muna/);
  });
});
