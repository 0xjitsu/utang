import { describe, expect, it } from "vitest";
import { friendlyError } from "./errors";
import { makeRules } from "./mock/contract";
import { pairCreditFromLoans } from "./rules";
import type { Loan } from "./types";

const loan = (id: number, lender: string, borrower: string, counted: boolean): Loan => ({
  id, lender, borrower, amount: "1000", days: 3, status: "Repaid", requested_at: "1", approved_at: "2",
  due_at: "3", closed_at: "4", bonus_paid: "0", counted, past_due: false,
});

describe("pair credit fallback (when pair_credit is not deployed)", () => {
  it("counts counted repayments between the unordered pair", () => {
    const rules = makeRules();
    const loans = [loan(0, "a", "b", false), loan(1, "a", "b", true), loan(2, "b", "a", true), loan(3, "a", "c", true)];
    expect(pairCreditFromLoans("a", "b", loans, rules)).toEqual({ counted_repayments: 2, cap: "3000" });
    expect(pairCreditFromLoans("a", "z", loans, rules)).toEqual({ counted_repayments: 0, cap: "1000" });
  });
});

describe("friendly errors", () => {
  it("keeps the credit amount from the contract panic", () => {
    expect(friendlyError(new Error("Smart contract panicked: Credit between you two is at most 20.00 right now"))).toBe(
      "Credit between you two is up to 20.00 right now. Each counted repayment between you adds 10.00 more.",
    );
    expect(friendlyError(new Error("Smart contract panicked: Bayad muna: you have an overdue loan"))).toMatch(/^Bayad muna/);
  });
});

import { fmtRelative, fmtSpan, fmtSpanHint, shortName } from "./format";

describe("names and time labels", () => {
  it("short names: suffix stripped, sub-accounts keep their first label", () => {
    expect(shortName("ana.testnet")).toBe("ana");
    expect(shortName("ben.utang-game.testnet")).toBe("ben");
    expect(shortName("aling-nena.testnet")).toBe("aling-nena");
    expect(shortName("someone.near")).toBe("someone");
  });

  it("demo builds lead with real time only; the game-day equivalent is a hint", () => {
    const demo = { day_ns: "60000000000", demo_time: true };
    const real = { day_ns: "86400000000000", demo_time: false };
    const ns = 179_000_000_000n; // 2m 59s
    expect(fmtSpan(ns, demo)).toBe("2m 59s");
    expect(fmtSpanHint(ns, demo)).toMatch(/≈ 2d 23h of game time/);
    expect(fmtSpanHint(ns, real)).toBe("");
    expect(fmtSpan(2n * 86_400_000_000_000n, real)).toBe("2d");
    expect(fmtRelative(ns, 0n, demo)).toBe("in 2m 59s");
    expect(fmtRelative(1n, 0n, demo)).toBe("any moment now");
  });
});
