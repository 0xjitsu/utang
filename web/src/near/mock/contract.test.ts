import { describe, expect, it, beforeEach } from "vitest";
import { MockUtangContract, makeRules, MockPanic } from "./contract";

const DAY = 60_000_000_000n;
const JOIN = 10_000_000_000_000_000_000_000n;
const T0 = 1_800_000_000_000_000_000n;
const at = (days: number) => T0 + BigInt(Math.round(days * 1000)) * (DAY / 1000n);

let c: MockUtangContract;
const prof = (a: string, t = at(0)) => c.profile(a, t)!;

beforeEach(() => {
  c = new MockUtangContract(makeRules(DAY, true));
  for (const a of ["ana.testnet", "ben.testnet", "cy.testnet"]) c.storageDeposit(a, a, JOIN, T0);
});

describe("join (storage_deposit)", () => {
  it("requires 0.01 NEAR and starts with trust 0, limit 10.00", () => {
    expect(() => c.storageDeposit("x.testnet", "x.testnet", JOIN - 1n, T0)).toThrow(MockPanic);
    c.storageDeposit("x.testnet", "x.testnet", JOIN, T0);
    const p = prof("x.testnet");
    expect(p.trust).toBe(0);
    expect(p.level).toBe(1);
    expect(p.lending_limit).toBe("1000");
    expect(p.player_index).toBe(3);
    expect(p.badges).toEqual(["founding_neighbour"]);
    // re-register is a no-op
    c.storageDeposit("x.testnet", "x.testnet", JOIN, T0);
    expect(c.stats(T0).players).toBe(4);
  });
  it("leaving is not supported", () => {
    expect(() => c.call("ana.testnet", "storage_unregister", {}, 1n, T0)).toThrow(/Leaving the neighbourhood/);
  });
});

describe("ask / approve / decline / cancel", () => {
  it("validates ask", () => {
    expect(() => c.ask("ben.testnet", "ben.testnet", 1000n, 3, T0)).toThrow(/borrow from yourself/);
    expect(() => c.ask("ben.testnet", "nobody.testnet", 1000n, 3, T0)).toThrow(/not registered/);
    expect(() => c.ask("ben.testnet", "ana.testnet", 99n, 3, T0)).toThrow(/Amount must be between/);
    expect(() => c.ask("ben.testnet", "ana.testnet", 100001n, 3, T0)).toThrow(/Amount must be between/);
    expect(() => c.ask("ben.testnet", "ana.testnet", 1000n, 0, T0)).toThrow(/Days/);
    // min_days is 2: a 1-day loan could never count (a repayment counts once the loan is a day old)
    expect(() => c.ask("ben.testnet", "ana.testnet", 1000n, 1, T0)).toThrow("Days must be between 2 and 30");
    const ok = c.ask("ben.testnet", "ana.testnet", 1000n, 2, T0);
    c.cancel("ben.testnet", ok, T0);
    expect(() => c.ask("ben.testnet", "ana.testnet", 1000n, 31, T0)).toThrow(/Days/);
    expect(() => c.ask("zed.testnet", "ana.testnet", 1000n, 3, T0)).toThrow(/not registered: call storage_deposit/);
    for (let i = 0; i < 5; i++) c.ask("ben.testnet", "ana.testnet", 100n, 3, T0);
    expect(() => c.ask("ben.testnet", "ana.testnet", 100n, 3, T0)).toThrow(/Too many open loans/);
  });

  it("approve mints to the borrower and respects the lending limit", () => {
    const id = c.ask("ben.testnet", "ana.testnet", 1000n, 3, T0);
    expect(c.getLoan(id, T0)!.status).toBe("Requested");
    expect(() => c.approve("ben.testnet", id, T0)).toThrow(/Only the lender can do this/);
    c.approve("ana.testnet", id, at(0.1));
    const loan = c.getLoan(id, at(0.1))!;
    expect(loan.status).toBe("Active");
    expect(BigInt(loan.due_at!)).toBe(at(0.1) + 3n * DAY);
    expect(prof("ben.testnet").balance).toBe("1000");
    expect(prof("ben.testnet").borrowed_out).toBe("1000");
    expect(prof("ana.testnet").lent_out).toBe("1000");
    expect(prof("ana.testnet").loans_made).toBe(1);
    expect(c.stats(at(0.1)).total_supply).toBe("1000");
    // limit 10.00 is used up
    const id2 = c.ask("cy.testnet", "ana.testnet", 100n, 3, T0);
    expect(() => c.approve("ana.testnet", id2, T0)).toThrow(/lending limit/);
    expect(() => c.approve("ana.testnet", id, T0)).toThrow(/not a pending request/);
  });

  it("decline and cancel close requests", () => {
    const a = c.ask("ben.testnet", "ana.testnet", 500n, 2, T0);
    const b = c.ask("ben.testnet", "ana.testnet", 500n, 2, T0);
    expect(() => c.decline("ben.testnet", a, T0)).toThrow(/Only the lender can do this/);
    c.decline("ana.testnet", a, at(1));
    expect(() => c.cancel("ana.testnet", b, T0)).toThrow(/Only the borrower can do this/);
    c.cancel("ben.testnet", b, at(1));
    expect(c.getLoan(a, at(1))!.status).toBe("Declined");
    expect(c.getLoan(b, at(1))!.status).toBe("Cancelled");
    expect(c.getLoan(b, at(1))!.closed_at).toBe(at(1).toString());
    expect(c.stats(at(1)).requested_loans).toBe(0);
  });
});

describe("repay on time", () => {
  it("burns, grows trust and limit, pays 10% bonus split 50/50 after 1 day", () => {
    const id = c.ask("ben.testnet", "ana.testnet", 1000n, 3, T0);
    c.approve("ana.testnet", id, T0);
    c.repay("ben.testnet", id, at(1.5));
    const loan = c.getLoan(id, at(2))!;
    expect(loan.status).toBe("Repaid");
    expect(loan.bonus_paid).toBe("100");
    const ben = prof("ben.testnet", at(2));
    const ana = prof("ana.testnet", at(2));
    expect(ben.balance).toBe("50"); // 10.00 burned, +0.50 bonus
    expect(ana.balance).toBe("50");
    expect(ben.trust).toBe(10);
    expect(ana.trust).toBe(5);
    expect(ana.lending_limit).toBe("2000");
    expect(ana.lent_out).toBe("0");
    expect(ana.loans_made_repaid).toBe(1);
    expect(ben.loans_repaid_on_time).toBe(1);
    expect(ben.badges).toContain("first_repay");
    const s = c.stats(at(2));
    expect(s.total_supply).toBe("100");
    expect(s.bonus_minted).toBe("100");
    expect(s.bonus_pool_left).toBe("9999900");
    expect(s.total_repaid_on_time).toBe("1000");
    expect(s.trust_index_bps).toBe(10000);
  });

  it("no bonus before 1 day; pair cooldown 7 days (unordered pair)", () => {
    const a = c.ask("ben.testnet", "ana.testnet", 1000n, 3, T0);
    c.approve("ana.testnet", a, T0);
    c.repay("ben.testnet", a, at(0.5));
    expect(c.getLoan(a, at(1))!.bonus_paid).toBe("0");
    // eligible bonus
    const b = c.ask("ben.testnet", "ana.testnet", 1000n, 3, at(1));
    c.approve("ana.testnet", b, at(1));
    c.repay("ben.testnet", b, at(2.5));
    expect(c.getLoan(b, at(3))!.bonus_paid).toBe("100");
    // reversed roles, same pair, within 7 days: no bonus
    const d = c.ask("ana.testnet", "ben.testnet", 500n, 3, at(3));
    c.approve("ben.testnet", d, at(3));
    c.repay("ana.testnet", d, at(5));
    expect(c.getLoan(d, at(5))!.bonus_paid).toBe("0");
    // after cooldown
    const e = c.ask("ben.testnet", "ana.testnet", 1000n, 3, at(9));
    c.approve("ana.testnet", e, at(9));
    c.repay("ben.testnet", e, at(10.6));
    expect(c.getLoan(e, at(11))!.bonus_paid).toBe("100");
  });

  it("odd centavo of the bonus goes to the borrower", () => {
    const id = c.ask("ben.testnet", "ana.testnet", 150n, 3, T0); // bonus 15
    c.approve("ana.testnet", id, T0);
    c.repay("ben.testnet", id, at(1.2));
    expect(prof("ben.testnet").balance).toBe("8");
    expect(prof("ana.testnet").balance).toBe("7");
  });

  it("caps the lending limit at max_limit", () => {
    // grow ana's limit quickly
    let limit = 1000n;
    let t = 0;
    while (limit < 100000n) {
      const credit = c.pairCreditCap("ben.testnet", "ana.testnet");
      const amt = limit < credit ? limit : credit;
      const id = c.ask("ben.testnet", "ana.testnet", amt, 3, at(t));
      c.approve("ana.testnet", id, at(t));
      c.repay("ben.testnet", id, at(t + 1.1));
      limit = BigInt(prof("ana.testnet", at(t + 2)).lending_limit);
      t += 8; // pair cooldown
    }
    expect(limit).toBe(100000n);
  });
});

describe("counted repayments", () => {
  it("a repayment younger than 1 day closes the loan but does not count", () => {
    const id = c.ask("ben.testnet", "ana.testnet", 1000n, 3, T0);
    c.approve("ana.testnet", id, T0);
    expect(c.countBlocker(id, at(0.5))).toBe("too_young");
    c.repay("ben.testnet", id, at(0.5));
    const loan = c.getLoan(id, at(1))!;
    expect(loan.status).toBe("Repaid");
    expect(loan.counted).toBe(false);
    expect(loan.bonus_paid).toBe("0");
    const ben = prof("ben.testnet", at(1));
    const ana = prof("ana.testnet", at(1));
    expect(ben.trust).toBe(0);
    expect(ben.loans_repaid_on_time).toBe(0);
    expect(ben.badges).not.toContain("first_repay");
    expect(ana.lending_limit).toBe("1000");
    expect(ana.lent_out).toBe("0");
    expect(ana.loans_made_repaid).toBe(0);
    // still an on-time repayment for the trust index
    expect(c.stats(at(1)).total_repaid_on_time).toBe("1000");
  });

  it("bonus is computed on at most 10.00 (max 1.00 per loan)", () => {
    c.storageDeposit("big.testnet", "big.testnet", JOIN, T0);
    // grow big's limit first
    const g = c.ask("ana.testnet", "big.testnet", 1000n, 3, T0);
    c.approve("big.testnet", g, T0);
    c.repay("ana.testnet", g, at(1.1));
    // the pair has a counted repayment now, so a 20.00 loan is allowed; wait out the pair cooldown
    const id = c.ask("ana.testnet", "big.testnet", 2000n, 10, at(2));
    c.approve("big.testnet", id, at(2));
    c.repay("ana.testnet", id, at(8.2));
    const loan = c.getLoan(id, at(9))!;
    expect(loan.counted).toBe(true);
    expect(loan.bonus_paid).toBe("100");
    expect(prof("big.testnet", at(9)).lending_limit).toBe("4000");
  });

  it("a borrower gets at most one counted repayment per day", () => {
    const a = c.ask("ben.testnet", "ana.testnet", 500n, 5, T0);
    const b = c.ask("ben.testnet", "cy.testnet", 500n, 5, T0);
    c.approve("ana.testnet", a, T0);
    c.approve("cy.testnet", b, T0);
    c.repay("ben.testnet", a, at(1.2));
    expect(c.countBlocker(b, at(1.5))).toBe("borrower_cooldown");
    c.repay("ben.testnet", b, at(1.5));
    expect(c.getLoan(a, at(2))!.counted).toBe(true);
    expect(c.getLoan(b, at(2))!.counted).toBe(false);
    expect(prof("ben.testnet", at(2)).trust).toBe(10);
    expect(prof("cy.testnet", at(2)).trust).toBe(0);
    expect(prof("cy.testnet", at(2)).lending_limit).toBe("1000");
  });

  it("when the pool is empty a repayment still counts for trust and limit", () => {
    c = new MockUtangContract({ ...makeRules(DAY, true), bonus_pool_cap: "150" });
    for (const a of ["ana.testnet", "ben.testnet", "cy.testnet"]) c.storageDeposit(a, a, JOIN, T0);
    const a = c.ask("ben.testnet", "ana.testnet", 1000n, 5, T0);
    c.approve("ana.testnet", a, T0);
    c.repay("ben.testnet", a, at(1.1));
    expect(c.getLoan(a, at(2))!.bonus_paid).toBe("100");
    const b = c.ask("cy.testnet", "ana.testnet", 1000n, 5, at(2));
    c.approve("ana.testnet", b, at(2));
    c.repay("cy.testnet", b, at(3.1));
    expect(c.getLoan(b, at(4))!.bonus_paid).toBe("50"); // capped at what is left
    const d = c.ask("ben.testnet", "cy.testnet", 1000n, 5, at(4));
    c.approve("cy.testnet", d, at(4));
    c.repay("ben.testnet", d, at(5.2));
    const loan = c.getLoan(d, at(6))!;
    expect(loan.counted).toBe(true);
    expect(loan.bonus_paid).toBe("0");
    expect(prof("cy.testnet", at(6)).lending_limit).toBe("2000");
    expect(c.stats(at(6)).bonus_pool_left).toBe("0");
  });
});

describe("barangays", () => {
  it("set_barangay validates the exact name, needs registration, takes no deposit, can change", () => {
    expect(prof("ana.testnet").barangay).toBeNull();
    expect(() => c.call("ana.testnet", "set_barangay", { barangay: "hulo" }, 0n, T0)).toThrow("Unknown barangay");
    expect(() => c.call("ana.testnet", "set_barangay", { barangay: "New Zaniga" }, 0n, T0)).toThrow("Unknown barangay");
    expect(() => c.call("zed.testnet", "set_barangay", { barangay: "Hulo" }, 0n, T0)).toThrow(/not registered/);
    expect(() => c.call("ana.testnet", "set_barangay", { barangay: "Hulo" }, 1n, T0)).toThrow(/doesn't accept deposit/);
    c.call("ana.testnet", "set_barangay", { barangay: "New Zañiga" }, 0n, T0);
    expect(prof("ana.testnet").barangay).toBe("New Zañiga");
    c.call("ana.testnet", "set_barangay", { barangay: "Hulo" }, 0n, T0);
    expect(prof("ana.testnet").barangay).toBe("Hulo");
    expect(c.events.at(-1)).toMatchObject({ event: "barangay_set", data: { account_id: "ana.testnet", barangay: "Hulo" } });
  });

  it("players_in is join order with paging; unknown names give []; counts only list non-empty barangays", () => {
    c.setBarangay("cy.testnet", "Hulo", T0);
    c.setBarangay("ana.testnet", "Hulo", T0);
    c.setBarangay("ben.testnet", "New Zañiga", T0);
    expect((c.view("players_in", { barangay: "Hulo" }, T0) as any[]).map((p) => p.account_id)).toEqual(["ana.testnet", "cy.testnet"]);
    expect((c.view("players_in", { barangay: "Hulo", from_index: 1, limit: 5 }, T0) as any[]).map((p) => p.account_id)).toEqual(["cy.testnet"]);
    expect(c.view("players_in", { barangay: "Atlantis" }, T0)).toEqual([]);
    expect(c.view("players_in", { barangay: "Burol" }, T0)).toEqual([]);
    expect(c.view("barangay_counts", {}, T0)).toEqual({ Hulo: 2, "New Zañiga": 1 });
    c.setBarangay("cy.testnet", "Burol", T0); // moving updates both counts
    expect(c.view("barangay_counts", {}, T0)).toEqual({ Burol: 1, Hulo: 1, "New Zañiga": 1 });
    expect(Object.keys(c.view("barangay_counts", {}, T0) as object)).toEqual(["Burol", "Hulo", "New Zañiga"]);
    const rules = c.view("rules", {}, T0) as any;
    expect(rules.barangays).toHaveLength(27);
    expect(rules.barangays).toContain("Old Zañiga");
    const copy = MockUtangContract.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    expect(copy.barangayCounts()).toEqual(c.barangayCounts());
  });
});

describe("pair credit", () => {
  it("credit between a pair grows 10.00 per counted repayment", () => {
    c.storageDeposit("big.testnet", "big.testnet", JOIN, T0);
    expect(c.view("pair_credit", { a: "ana.testnet", b: "ben.testnet" }, T0)).toEqual({ counted_repayments: 0, cap: "1000" });
    expect(() => c.ask("ben.testnet", "ana.testnet", 1001n, 3, T0)).toThrow("Credit between you two is at most 10.00 right now");
    // an uncounted repayment does not lift it
    const q = c.ask("ben.testnet", "ana.testnet", 1000n, 3, T0);
    c.approve("ana.testnet", q, T0);
    c.repay("ben.testnet", q, at(0.2));
    expect(c.pairCountedRepayments("ana.testnet", "ben.testnet")).toBe(0);
    expect(() => c.ask("ben.testnet", "ana.testnet", 1500n, 3, at(0.3))).toThrow(/at most 10.00 right now/);
    // a counted one does, in both directions
    const a = c.ask("ben.testnet", "ana.testnet", 1000n, 3, at(0.3));
    c.approve("ana.testnet", a, at(0.3));
    c.repay("ben.testnet", a, at(1.4));
    expect(c.getLoan(a, at(1.4))!.counted).toBe(true);
    expect(c.view("pair_credit", { a: "ben.testnet", b: "ana.testnet" }, at(1.4))).toEqual({ counted_repayments: 1, cap: "2000" });
    // grows in both directions: ana may now ask ben for up to 20.00
    expect(() => c.ask("ana.testnet", "ben.testnet", 2001n, 3, at(1.5))).toThrow("Credit between you two is at most 20.00 right now");
    const b = c.ask("ana.testnet", "ben.testnet", 1000n, 10, at(1.5));
    c.approve("ben.testnet", b, at(1.5));
    c.repay("ana.testnet", b, at(8.5)); // after the 7-day pair cooldown: counts
    expect(c.getLoan(b, at(9))!.counted).toBe(true);
    expect(c.pairCreditCap("ana.testnet", "ben.testnet")).toBe(3000n);
    // persisted
    const copy = MockUtangContract.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    expect(copy.pairCreditCap("ben.testnet", "ana.testnet")).toBe(3000n);
  });
});

describe("time boundaries are inclusive (contract/NOTES.md #13)", () => {
  it("on time at exactly due_at; counts at exactly +1 day; pair counts again at exactly +7 days", () => {
    const a = c.ask("ben.testnet", "ana.testnet", 500n, 2, T0);
    c.approve("ana.testnet", a, T0);
    expect(() => c.markOverdue(a, T0 + 2n * DAY)).toThrow(/not past its due date/);
    expect(c.countBlocker(a, T0 + DAY - 1n)).toBe("too_young");
    c.repay("ben.testnet", a, T0 + DAY); // exactly 1 day old
    const la = c.getLoan(a, T0 + DAY)!;
    expect(la.status).toBe("Repaid");
    expect(la.counted).toBe(true);
    const b = c.ask("ben.testnet", "ana.testnet", 500n, 10, T0 + DAY);
    c.approve("ana.testnet", b, T0 + DAY);
    expect(c.countBlocker(b, T0 + 8n * DAY - 1n)).toBe("pair_cooldown");
    c.repay("ben.testnet", b, T0 + 8n * DAY);
    expect(c.getLoan(b, T0 + 8n * DAY)!.counted).toBe(true);
  });
});

describe("overdue", () => {
  function overdueLoan() {
    const id = c.ask("ben.testnet", "ana.testnet", 1000n, 2, T0);
    c.approve("ana.testnet", id, T0);
    return id;
  }

  it("past_due is computed before marking; mark only after due date", () => {
    const id = overdueLoan();
    expect(() => c.markOverdue(id, at(2))).toThrow(/not past its due date/);
    const l = c.getLoan(id, at(2.1))!;
    expect(l.status).toBe("Active");
    expect(l.past_due).toBe(true);
    expect(prof("ben.testnet", at(2.1)).has_overdue).toBe(true);
    expect(c.overdue(at(2.1)).map((x) => x.id)).toEqual([id]);
    expect(c.stats(at(2.1)).overdue_outstanding).toBe("1000");
  });

  it("mark_overdue penalises both sides and halves the lender limit", () => {
    const id = overdueLoan();
    c.markOverdue(id, at(2.5)); // anyone, even unregistered (no caller check)
    expect(() => c.markOverdue(id, at(2.6))).toThrow(/Loan is not Active/);
    const ben = prof("ben.testnet", at(3));
    const ana = prof("ana.testnet", at(3));
    expect(c.getLoan(id, at(3))!.status).toBe("Overdue");
    expect(ben.trust).toBe(0); // never below 0
    expect(ben.loans_overdue).toBe(1);
    expect(ana.trust).toBe(0);
    expect(ana.lending_limit).toBe("500");
    expect(ana.lent_out).toBe("0");
  });

  it("Bayad muna: overdue borrower cannot transfer or borrow but can receive and repay", () => {
    const id = overdueLoan();
    const t = at(3);
    expect(() => c.ftTransfer("ben.testnet", "cy.testnet", 100n, t)).toThrow(/Bayad muna/);
    expect(() => c.ask("ben.testnet", "cy.testnet", 100n, 2, t)).toThrow(/Bayad muna/);
    // a request made before going overdue cannot be approved now
    const early = c.ask("ben.testnet", "cy.testnet", 100n, 2, at(1));
    expect(() => c.approve("cy.testnet", early, t)).toThrow(/Bayad muna/);
    // can receive
    c.storageDeposit("dee.testnet", "dee.testnet", JOIN, t);
    const r = c.ask("cy.testnet", "dee.testnet", 500n, 5, t);
    c.approve("dee.testnet", r, t);
    c.ftTransfer("cy.testnet", "ben.testnet", 200n, t);
    expect(prof("ben.testnet", t).balance).toBe("1200");
    // late repay without explicit mark: penalty applied first, then late rewards, no bonus
    c.repay("ben.testnet", id, t);
    const loan = c.getLoan(id, t)!;
    expect(loan.status).toBe("RepaidLate");
    expect(loan.bonus_paid).toBe("0");
    const ben = prof("ben.testnet", t);
    const ana = prof("ana.testnet", t);
    expect(ben.trust).toBe(5); // 0 -> (−20 floored at 0) -> +5
    expect(ben.loans_overdue).toBe(1);
    expect(ben.loans_repaid_late).toBe(1);
    expect(ben.has_overdue).toBe(false);
    expect(ana.trust).toBe(2);
    expect(ana.lending_limit).toBe("500");
    expect(ana.lent_out).toBe("0"); // released by the overdue penalty
    expect(c.ftTransfer("ben.testnet", "cy.testnet", 100n, t)).toBeUndefined();
    const s = c.stats(t);
    expect(s.total_repaid_late).toBe("1000");
    expect(s.trust_index_bps).toBe(0);
  });

  it("repaying a marked overdue loan does not double-penalise", () => {
    const id = overdueLoan();
    c.markOverdue(id, at(2.5));
    const before = prof("ana.testnet", at(2.5));
    c.repay("ben.testnet", id, at(4));
    const after = prof("ana.testnet", at(4));
    expect(after.lending_limit).toBe(before.lending_limit);
    expect(after.lent_out).toBe("0");
    expect(prof("ben.testnet", at(4)).loans_overdue).toBe(1);
  });

  it("min_limit floor after halving", () => {
    for (let i = 0; i < 5; i++) {
      const id = c.ask("ben.testnet", "ana.testnet", 100n, 2, at(i * 10));
      c.approve("ana.testnet", id, at(i * 10));
      c.markOverdue(id, at(i * 10 + 3));
      c.repay("ben.testnet", id, at(i * 10 + 4));
    }
    expect(prof("ana.testnet", at(100)).lending_limit).toBe("100");
  });

  it("trust index = on_time / (on_time + late + overdue_outstanding)", () => {
    const a = c.ask("ben.testnet", "ana.testnet", 600n, 3, T0);
    c.approve("ana.testnet", a, T0);
    c.repay("ben.testnet", a, at(1));
    const b = c.ask("cy.testnet", "ana.testnet", 400n, 2, at(1));
    c.approve("ana.testnet", b, at(1));
    // b overdue at day 3.5: 600 / (600 + 400) = 60%
    expect(c.stats(at(3.5)).trust_index_bps).toBe(6000);
  });
});

describe("views and JSON shapes", () => {
  it("ask rejects deposits above 1 yocto; non-payable methods reject any deposit", () => {
    expect(() => c.call("ben.testnet", "ask", { lender: "ana.testnet", amount: "500", days: 2 }, 2n, T0)).toThrow(/at most 1 yoctoNEAR/);
    const id = c.call("ben.testnet", "ask", { lender: "ana.testnet", amount: "500", days: 2 }, 1n, T0) as number;
    expect(() => c.call("ana.testnet", "approve", { loan_id: id }, 1n, T0)).toThrow(/doesn't accept deposit/);
  });

  it("ft_transfer requires exactly 1 yocto via call()", () => {
    expect(() => c.call("ana.testnet", "ft_transfer", { receiver_id: "ben.testnet", amount: "1" }, 0n, T0)).toThrow(
      /1 yoctoNEAR/,
    );
  });

  it("returns strings for U128/U64 and numbers for ids", () => {
    const id = c.call("ben.testnet", "ask", { lender: "ana.testnet", amount: "500", days: 2 }, 0n, T0) as number;
    expect(typeof id).toBe("number");
    const loan = c.view("get_loan", { loan_id: id }, T0) as any;
    expect(typeof loan.amount).toBe("string");
    expect(typeof loan.requested_at).toBe("string");
    expect(loan.approved_at).toBeNull();
    const rules = c.view("rules", {}, T0) as any;
    expect(rules.day_ns).toBe("60000000000");
    expect(rules.demo_time).toBe(true);
    const page1 = c.view("listahan", { from_index: 0, limit: 1 }, T0) as any[];
    expect(page1[0].id).toBe(id);
    expect((c.view("listahan", { from_index: 1, limit: 10 }, T0) as any[]).length).toBe(0);
    expect(c.view("profile", { account_id: "zzz.testnet" }, T0)).toBeNull();
    expect(c.view("get_loan", { loan_id: 999 }, T0)).toBeNull();
  });

  it("leaderboard sorts by trust then on-time repays; badges", () => {
    const a = c.ask("ben.testnet", "ana.testnet", 100n, 3, T0);
    c.approve("ana.testnet", a, T0);
    c.repay("ben.testnet", a, at(1.5));
    const lb = c.leaderboard(undefined, at(2));
    expect(lb.map((p) => p.account_id)).toEqual(["ben.testnet", "ana.testnet", "cy.testnet"]);
  });

  it("persists and restores via JSON", () => {
    const a = c.ask("ben.testnet", "ana.testnet", 1000n, 3, T0);
    c.approve("ana.testnet", a, T0);
    const copy = MockUtangContract.fromJSON(JSON.parse(JSON.stringify(c.toJSON())));
    expect(copy.stats(at(1))).toEqual(c.stats(at(1)));
    expect(copy.profile("ana.testnet", at(1))).toEqual(c.profile("ana.testnet", at(1)));
    copy.repay("ben.testnet", a, at(1.5));
    expect(copy.getLoan(a, at(2))!.bonus_paid).toBe("100");
  });
});
