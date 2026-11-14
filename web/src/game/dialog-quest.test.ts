import { describe, expect, it } from "vitest";
import { makeRules } from "../near/mock/contract";
import type { Loan, Profile } from "../near/types";
import { amountOptions, askBlocker, askCountNote, askLimit, npcChoices, npcLine, storeChoices, type DialogCtx } from "./dialog";
import { holdsRequests, NEW_QUEST, questTarget, questView, restartedQuest, type QuestSaved } from "./quest";

const rules = makeRules(); // 1 day = 60 s
const DAY = BigInt(rules.day_ns);
const T = 1_800_000_000_000_000_000n;

function profile(id: string, over: Partial<Profile> = {}): Profile {
  return {
    account_id: id, balance: "0", trust: 0, level: 1, lending_limit: "1000", lent_out: "0", borrowed_out: "0",
    loans_repaid_on_time: 0, loans_repaid_late: 0, loans_overdue: 0, loans_made: 0, loans_made_repaid: 0,
    has_overdue: false, joined_at: "0", player_index: 0, badges: [], barangay: null, ...over,
  };
}
let seq = 0;
function loan(over: Partial<Loan>): Loan {
  return {
    id: seq++, lender: "nena", borrower: "me", amount: "1000", days: 3, status: "Requested", requested_at: T.toString(),
    approved_at: null, due_at: null, closed_at: null, bonus_paid: "0", counted: false, past_due: false, ...over,
  };
}
const ctx = (over: Partial<DialogCtx> = {}): DialogCtx => ({
  accountId: "me", me: profile("me"), otherId: "nena", other: profile("nena"), myLoans: [], rules,
  credit: { counted_repayments: 0, cap: "1000" }, ...over,
});
const ids = (c: { id: string }[]) => c.map((x) => x.id);

describe("visit dialog choices", () => {
  it("a fresh neighbour: ask, notebook, leave", () => {
    const { primary } = npcChoices(ctx());
    expect(ids(primary)).toEqual(["ask", "notebook", "leave"]);
    expect(primary[0].disabled).toBeFalsy();
    expect(npcLine(ctx())).toMatch(/Uy, kumusta|Kumusta|Magandang|pala|Kain|Mainit|Oy/);
  });

  it("not joined / no account: only leave, with a helpful line", () => {
    expect(ids(npcChoices(ctx({ me: null })).primary)).toEqual(["leave"]);
    expect(npcLine(ctx({ me: null }))).toMatch(/Join the barangay/);
  });

  it("they asked me: approve + decline, approve explains limits", () => {
    const req = loan({ lender: "me", borrower: "nena", amount: "2000" });
    const c = ctx({ myLoans: [req] });
    const { primary } = npcChoices(c);
    expect(ids(primary).slice(0, 2)).toEqual(["approve", "decline"]);
    expect(primary[0].disabled).toBe(true);
    expect(primary[0].reason).toMatch(/Over your lending limit \(you can lend 10.00\)/);
    expect(npcLine(c)).toMatch(/Pa-utang po\? 20.00 lang/);
    const overdueThem = npcChoices(ctx({ myLoans: [loan({ lender: "me", borrower: "nena", amount: "500" })], other: profile("nena", { has_overdue: true }) }));
    expect(overdueThem.primary[0].reason).toMatch(/Bayad muna/);
  });

  it("I owe them: repay (late when past due), and say so", () => {
    const debt = loan({ status: "Active", approved_at: T.toString(), due_at: (T + 3n * DAY).toString() });
    const c = ctx({ myLoans: [debt], me: profile("me", { balance: "1000" }) });
    const { primary } = npcChoices(c);
    expect(primary[0]).toMatchObject({ id: "repay", label: "Repay 10.00 ★ counts", disabled: false, kind: "good" });
    // less than a day old: say it won't count yet, and how long to wait
    const young = npcChoices({ ...c, now: T + DAY / 4n }).primary[0];
    expect(young).toMatchObject({ id: "repay", label: "Repay now (won't earn trust yet)", kind: "secondary" });
    expect(young.note).toMatch(/wait 45s/);
    // a day old: the counted option is highlighted
    expect(npcChoices({ ...c, now: T + DAY }).primary[0]).toMatchObject({ label: "Repay 10.00 ★ counts", kind: "good" });
    const late = { ...debt, past_due: true };
    const c2 = ctx({ myLoans: [late], me: profile("me", { balance: "400" }), now: T + 5n * DAY });
    const p2 = npcChoices(c2).primary[0];
    expect(p2).toMatchObject({ id: "repay", label: "Repay (late) 10.00", disabled: true });
    expect(p2.reason).toBe("You need 6.00 more $UTANG");
    expect(npcLine(c2)).toMatch(/bayad muna/i);
  });

  it("pending request to them: cancel instead of ask", () => {
    const { primary } = npcChoices(ctx({ myLoans: [loan({})] }));
    expect(ids(primary)).toEqual(["cancel", "notebook", "leave"]);
  });

  it("they owe me past due: line is kind, mark overdue sits under More", () => {
    const owed = loan({ lender: "me", borrower: "nena", status: "Active", past_due: true });
    const c = ctx({ myLoans: [owed] });
    expect(npcLine(c)).toMatch(/Pasensya na/);
    expect(ids(npcChoices(c).more)).toContain("mark_overdue");
  });

  it("ask is blocked with one-line reasons", () => {
    expect(askBlocker(ctx({ me: profile("me", { has_overdue: true }) }))).toMatch(/Bayad muna/);
    expect(askBlocker(ctx({ other: profile("nena", { lent_out: "1000" }) }))).toBe("They can't lend right now");
    const five = Array.from({ length: 5 }, () => loan({ lender: "x" }));
    expect(askBlocker(ctx({ myLoans: five }))).toMatch(/5 open loans/);
  });

  it("amount chips are limited by pair credit and their free limit", () => {
    const opts = amountOptions(ctx());
    expect(opts.map((o) => o.disabled)).toEqual([false, false, true]);
    expect(opts[2].reason).toBe("Credit between you is up to 10.00");
    const tight = amountOptions(ctx({ other: profile("nena", { lent_out: "400" }), credit: { counted_repayments: 2, cap: "3000" } }));
    expect(tight.map((o) => o.disabled)).toEqual([false, true, true]);
    expect(tight[1].reason).toBe("They can lend 6.00 right now");
    expect(askLimit(ctx({ credit: { counted_repayments: 1, cap: "2000" }, other: profile("nena", { lending_limit: "5000" }) })).max).toBe(2000n);
  });

  it("ask note says when the next counted repayment with this pair can happen", () => {
    const counted = loan({ status: "Repaid", counted: true, approved_at: T.toString(), closed_at: (T + DAY).toString() });
    const note = askCountNote(ctx({ myLoans: [counted] }), T + 2n * DAY);
    expect(note).toMatch(/^Next counted repayment with nena: in 6m 0s\. /);
    expect(askCountNote(ctx({ myLoans: [counted] }), T + 8n * DAY)).toBeNull();
  });

  it("own store choices count requests and debts", () => {
    const c = storeChoices({ accountId: "me", myLoans: [loan({ lender: "me", borrower: "x" }), loan({ status: "Active" })] });
    expect(c.map((x) => x.label)).toEqual(["At your window (1)", "Your utang (1)", "Leave"]);
  });
});

describe("first-time quest", () => {
  const me = profile("me", { barangay: "Plainview" });
  const run = (myLoans: Loan[], now = T, saved: QuestSaved = NEW_QUEST, meP = me) =>
    questView({ accountId: "me", me: meP, myLoans, target: "nena", rules, now, saved });

  it("step 0: choose a barangay first (only when the contract has barangays)", () => {
    const none = profile("me", { barangay: null });
    const { view } = run([], T, NEW_QUEST, none);
    expect(view).toMatchObject({ stage: "barangay", step: 0, title: "Choose your barangay" });
    expect(view.detail).toMatch(/never an address/);
  });

  it("step 1 tells you to ride the jeepney when the target lives elsewhere", () => {
    const r = questView({ accountId: "me", me, myLoans: [], target: "nena", targetBarangay: "Hulo", rules, now: T, saved: NEW_QUEST });
    expect(r.view.detail).toMatch(/lives in Hulo\. Ride the jeepney/);
  });

  it("step 1: ask, with an arrow on the target's house", () => {
    const { view } = run([]);
    expect(view).toMatchObject({ stage: "ask", step: 1, arrow: { kind: "house", id: "nena" } });
    expect(view.title).toBe("Visit nena and ask for 10.00");
  });

  it("step 2: waiting for approval, then a countdown until the loan is a day old", () => {
    const req = loan({ status: "Requested" });
    expect(run([req]).view).toMatchObject({ stage: "wait", step: 2, title: "Wait for a yes" });
    const active = { ...req, status: "Active" as const, approved_at: T.toString(), due_at: (T + 3n * DAY).toString() };
    const r = run([active], T + DAY / 4n);
    expect(r.view.stage).toBe("wait");
    expect(r.view.waitLeftNs).toBe((DAY * 3n) / 4n);
    expect(r.saved.loanId).toBe(active.id);
  });

  it("step 3: repay once a day old (or overdue)", () => {
    const active = loan({ status: "Active", approved_at: T.toString(), due_at: (T + 3n * DAY).toString() });
    expect(run([active], T + DAY).view).toMatchObject({ stage: "repay", step: 3 });
    expect(run([{ ...active, status: "Overdue", past_due: true }], T + 5n * DAY).view.title).toMatch(/late/);
  });

  it("reward once repaid (counted), then the lending card, then 'You're set!', then done", () => {
    const repaid = loan({ status: "Repaid", counted: true, approved_at: T.toString(), closed_at: (T + DAY).toString() });
    const r = run([repaid], T + 2n * DAY);
    expect(r.view).toMatchObject({ stage: "reward", title: "Quest complete!", counted: true });
    const lend = run([repaid], T, { ...r.saved, rewarded: true });
    expect(lend.view).toMatchObject({ stage: "lend", arrow: { kind: "store" } });
    expect(lend.saved.lendBase).toBe(0);
    const set = run([repaid], T, lend.saved, profile("me", { barangay: "Plainview", loans_made: 1 }));
    expect(set.view).toMatchObject({ stage: "set", title: "You're set!" });
    expect(set.view.goals[0]).toMatch(/Reach Level 2/);
    expect(run([repaid], T, { ...set.saved, finished: true }).view.stage).toBe("done");
  });

  it("an uncounted (too early) repay loops back to step 1 instead of advancing", () => {
    const early = loan({ status: "Repaid", counted: false, approved_at: T.toString(), closed_at: (T + DAY / 4n).toString() });
    const r = run([early]);
    expect(r.view).toMatchObject({ stage: "ask", step: 1, title: "That didn't count yet. Ask again" });
    expect(r.view.detail).toMatch(/wait a full day/);
    expect(r.saved).toMatchObject({ ignoreUpTo: early.id, retry: true, rewarded: false });
    // the next ask is tracked normally
    const again = loan({ status: "Requested" });
    expect(run([again, early], T, r.saved).view).toMatchObject({ stage: "wait", step: 2 });
    // a late repay also doesn't complete the quest
    const late = loan({ status: "RepaidLate", counted: false });
    expect(run([late]).view.stage).toBe("ask");
  });

  it("restart really restarts: old loans and old lending are ignored", () => {
    const repaid = loan({ status: "Repaid", counted: true });
    const saved = restartedQuest([repaid]);
    const v = run([repaid], T, saved, profile("me", { barangay: "Plainview", loans_made: 3 }));
    expect(v.view).toMatchObject({ stage: "ask", step: 1 }); // not reward, not done
    expect(saved.ignoreUpTo).toBe(repaid.id);
  });

  it("quest text knows which street you're on", () => {
    const base = { accountId: "me", me, myLoans: [], target: "nena", targetBarangay: "Hulo", rules, now: T, saved: NEW_QUEST };
    expect(questView({ ...base, currentBarangay: "Hulo" }).view).toMatchObject({ targetAway: false, arrow: { kind: "house", id: "nena" } });
    expect(questView({ ...base, currentBarangay: "Hulo" }).view.detail).toMatch(/^Walk to nena's house/);
    expect(questView({ ...base, currentBarangay: "Plainview" }).view.detail).toMatch(/lives in Hulo\. Ride the jeepney/);
  });

  it("neighbours hold their requests to a newcomer until 'Now try lending'", () => {
    expect(holdsRequests("ask")).toBe(true);
    expect(holdsRequests("reward")).toBe(true);
    expect(holdsRequests("lend")).toBe(false);
    expect(holdsRequests("done")).toBe(false);
  });

  it("a declined ask sends you back to step 1; dismissing hides it", () => {
    const declined = loan({ status: "Declined" });
    expect(run([declined], T, { ...NEW_QUEST, loanId: declined.id }).view.stage).toBe("ask");
    expect(run([declined], T, { ...NEW_QUEST, loanId: declined.id }).view.title).toMatch(/^Visit/);
    expect(run([], T, { ...NEW_QUEST, dismissed: true }).view.stage).toBe("done");
  });



  it("target: Aling Nena in preview, first other player live", () => {
    const players = [profile("me"), profile("ana"), profile("aling-nena.testnet")];
    expect(questTarget("preview", "me", players, "aling-nena.testnet")).toBe("aling-nena.testnet");
    expect(questTarget("live", "me", players, "aling-nena.testnet")).toBe("ana");
  });
});
