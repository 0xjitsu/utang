// Opt-in check of the real-mode data layer against a deployed contract (view calls only, no transactions).
//   npm run check-live                       (defaults to demo.utang-game.testnet)
//   LIVE_CONTRACT_ID=utang-game.testnet npx vitest run src/near/live.test.ts
import { describe, expect, it } from "vitest";
import { UtangClient } from "./contract";
import { MockUtangContract, makeRules } from "./mock/contract";
import { viewCall } from "./rpc";
import type { Transport } from "./transport";

const CID = process.env.LIVE_CONTRACT_ID;

function shape(v: unknown): unknown {
  if (Array.isArray(v)) return v.length ? [shape(v[0])] : [];
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().map((k) => [k, shape((v as any)[k])]));
  return v === null ? "null" : typeof v;
}

describe.skipIf(!CID)(`live contract ${CID}`, () => {
  const transport: Transport = {
    kind: "live",
    view: (m, a) => viewCall(m, a ?? {}, CID!),
    call: async () => {
      throw new Error("this check never sends transactions");
    },
  };
  const c = new UtangClient(transport);

  // A mock with one counted repayment, for shape comparison.
  const m = new MockUtangContract(makeRules());
  const T = 1_800_000_000_000_000_000n;
  const D = 60_000_000_000n;
  m.storageDeposit("a.testnet", "a.testnet", 10n ** 22n, T);
  m.storageDeposit("b.testnet", "b.testnet", 10n ** 22n, T);
  const id = m.ask("b.testnet", "a.testnet", 1000n, 3, T);
  m.approve("a.testnet", id, T);
  m.repay("b.testnet", id, T + 2n * D);
  m.setBarangay("a.testnet", "Hulo", T);

  it("every view returns the shapes the UI and the preview mock use", async () => {
    const [rules, stats, list, players, lb, od, missing, ftMeta, bounds] = await Promise.all([
      c.rules(),
      c.stats(),
      c.listahan(0, 10),
      c.allPlayers(),
      c.leaderboard(5),
      c.overdue(),
      c.profile("nobody-xyz-123.testnet"),
      c.ftMetadata(),
      c.storageBalanceBounds(),
    ]);
    expect(shape(rules)).toEqual(shape(m.view("rules", {}, T)));
    expect(shape(stats)).toEqual(shape(m.view("stats", {}, T)));
    expect(shape(bounds)).toEqual(shape(m.view("storage_balance_bounds", {}, T)));
    expect(shape(ftMeta)).toEqual(shape(m.view("ft_metadata", {}, T)));
    expect(ftMeta.decimals).toBe(2);
    expect(bounds.min).toBe(rules.join_deposit);
    expect(missing).toBeNull();
    expect(Array.isArray(od)).toBe(true);
    expect(lb.length).toBeLessThanOrEqual(5);
    if (list.length) {
      expect(shape(list[0])).toEqual(shape(m.view("get_loan", { loan_id: id }, T)));
      expect(await c.getLoan(list[0].id)).toEqual(list[0]);
      for (let i = 1; i < list.length; i++) expect(list[i - 1].id).toBeGreaterThan(list[i].id);
    }
    if (players.length) {
      const p = players[0];
      expect(shape(p)).toEqual(shape(m.view("profile", { account_id: "a.testnet" }, T)));
      expect(await c.profile(p.account_id)).toEqual(p);
      expect(await c.ftBalanceOf(p.account_id)).toBe(p.balance);
      expect(shape(await c.storageBalanceOf(p.account_id))).toEqual(
        shape(m.view("storage_balance_of", { account_id: "a.testnet" }, T)),
      );
      const mine = await c.loansOf(p.account_id);
      expect(mine.every((l) => l.lender === p.account_id || l.borrower === p.account_id)).toBe(true);
    }
    // Mandaluyong barangays: exact list, counts, and players_in agree with profiles
    expect(rules.barangays).toEqual(m.rules.barangays);
    const counts = await c.barangayCounts();
    for (const [b, n] of Object.entries(counts)) {
      expect(rules.barangays).toContain(b);
      const inB = await c.playersIn(b);
      expect(inB.length).toBe(n);
      expect(inB.every((p) => p.barangay === b)).toBe(true);
    }
    expect(Object.values(counts).reduce((a, n) => a + n, 0)).toBe(players.filter((p) => p.barangay).length);
    expect(await c.playersIn("Atlantis")).toEqual([]);
    // pair_credit arrives with the redeploy; until then the app falls back to loans_of.
    if (players.length >= 2) {
      const pc = await c.pairCredit(players[0].account_id, players[1].account_id).catch(() => null);
      if (pc) {
        expect(shape(pc)).toEqual(shape(m.view("pair_credit", { a: "a.testnet", b: "b.testnet" }, T)));
        expect(BigInt(pc.cap)).toBe(BigInt(rules.first_loan_cap) * BigInt(1 + pc.counted_repayments));
      } else {
        console.warn("pair_credit not available on this contract yet (fallback path in use)");
      }
    }
    // Global invariants hold on chain too.
    expect(BigInt(stats.total_supply)).toBe(BigInt(stats.outstanding) + BigInt(stats.bonus_minted));
    expect(BigInt(stats.total_lent)).toBe(
      BigInt(stats.total_repaid_on_time) + BigInt(stats.total_repaid_late) + BigInt(stats.outstanding),
    );
    expect(stats.players).toBe(players.length);
  }, 60_000);
});
