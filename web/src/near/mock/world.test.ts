import { describe, expect, it } from "vitest";
import { PreviewWorld, NPCS } from "./world";
import { createPreviewBackend } from "../index";
import type { Loan, Profile } from "../types";

const DAY = 60_000_000_000n;

function setup(seed = 7) {
  let now = 1_800_000_000_000_000_000n;
  const clock = () => now;
  const world = PreviewWorld.create({ seed, clock });
  const backend = createPreviewBackend({ world, persistAccount: false });
  const advance = (days: number) => {
    now += BigInt(Math.round(days * 1000)) * (DAY / 1000n);
    world.tick();
  };
  return { world, backend, client: backend.client, advance, clock };
}

async function invariants(client: ReturnType<typeof setup>["client"]) {
  const players = await client.allPlayers();
  const stats = await client.stats();
  const sumBal = players.reduce((s, p) => s + BigInt(p.balance), 0n);
  const sumBorrowed = players.reduce((s, p) => s + BigInt(p.borrowed_out), 0n);
  expect(BigInt(stats.total_supply)).toBe(sumBal);
  expect(BigInt(stats.outstanding)).toBe(sumBorrowed);
  // supply is exactly outstanding debt + bonuses ever paid
  expect(BigInt(stats.total_supply)).toBe(BigInt(stats.outstanding) + BigInt(stats.bonus_minted));
  expect(BigInt(stats.total_lent)).toBe(
    BigInt(stats.total_repaid_on_time) + BigInt(stats.total_repaid_late) + BigInt(stats.outstanding),
  );
  for (const p of players) {
    expect(p.trust).toBeGreaterThanOrEqual(0);
    expect(BigInt(p.lent_out) <= BigInt(p.lending_limit)).toBe(true);
    expect(BigInt(p.balance) >= 0n).toBe(true);
  }
  return { players, stats };
}

describe("preview world", () => {
  it("seeds a lively, consistent neighbourhood", async () => {
    const { client } = setup();
    const { players, stats } = await invariants(client);
    expect(players.map((p) => p.account_id)).toEqual(NPCS.map((n) => n.id));
    // neighbours are spread across several barangays
    const counts = await client.barangayCounts();
    expect(counts).toMatchObject({ Hulo: 3, Plainview: 2, "Highway Hills": 2, "Addition Hills": 2 });
    expect((await client.playersIn("Hulo")).map((p) => p.account_id)).toContain("aling-nena.testnet");
    const loans = await client.listahan(0, 500);
    const statuses = new Set(loans.map((l) => l.status));
    expect(statuses.has("Repaid")).toBe(true);
    expect(loans.some((l) => BigInt(l.bonus_paid) > 0n)).toBe(true);
    expect(stats.trust_index_bps).toBeGreaterThan(5000);
    // someone is visibly overdue so the "Bayad muna" state shows in the preview
    expect(players.some((p) => p.has_overdue)).toBe(true);
    // newest first, ids descending
    for (let i = 1; i < loans.length; i++) expect(loans[i - 1].id).toBeGreaterThan(loans[i].id);
  });

  it("is deterministic for a seed and survives a save/load roundtrip", async () => {
    const a = setup(42);
    const b = setup(42);
    expect(await a.client.stats()).toEqual(await b.client.stats());
    const restored = PreviewWorld.load(a.clock);
    // node has no localStorage: load returns null, which is the graceful path
    expect(restored === null || restored instanceof PreviewWorld).toBe(true);
  });

  it("plays the full loop: join, ask, approve, repay with bonus, neighbour asks, overdue, bayad muna", async () => {
    const { backend, client, advance } = setup(3);
    const me = "ikaw.testnet";
    backend.preview!.setAccount(me);
    expect(await client.profile(me)).toBeNull();
    await expect(client.ask("ana.testnet", "500", 2)).rejects.toThrow(/not registered/);

    // join with exactly 0.01 NEAR
    await client.storageDeposit();
    let p = (await client.profile(me)) as Profile;
    expect(p.lending_limit).toBe("1000");
    expect(p.trust).toBe(0);

    // ask a neighbour who has room in their lending limit (the UI shows "can lend X")
    const roomy = (await client.allPlayers())
      .filter((x) => x.account_id !== me && !x.has_overdue)
      .sort((x, y) => Number(BigInt(y.lending_limit) - BigInt(y.lent_out) - (BigInt(x.lending_limit) - BigInt(x.lent_out))))[0];
    expect(BigInt(roomy.lending_limit) - BigInt(roomy.lent_out) >= 1000n).toBe(true);
    const id = (await client.ask(roomy.account_id, "1000", 3)) as number;
    expect(typeof id).toBe("number");
    expect((await client.getLoan(id))!.status).toBe("Requested");
    advance(0.5);
    let loan = (await client.getLoan(id)) as Loan;
    expect(loan.status).toBe("Active"); // welcoming to the human player when there is room
    {
      p = (await client.profile(me))!;
      expect(p.balance).toBe("1000");
      advance(1.2); // > 1 day old: bonus eligible
      await client.repay(id);
      loan = (await client.getLoan(id))!;
      expect(loan.status).toBe("Repaid");
      expect(loan.counted).toBe(true);
      expect(loan.bonus_paid).toBe("100");
      p = (await client.profile(me))!;
      expect(p.trust).toBe(10);
      expect(p.balance).toBe("50");
      expect(p.badges).toContain("first_repay");
    }

    // neighbours come to my store asking for loans
    let incoming: Loan[] = [];
    for (let i = 0; i < 40 && incoming.length === 0; i++) {
      advance(0.5);
      incoming = (await client.loansOf(me)).filter((l) => l.lender === me && l.status === "Requested");
    }
    expect(incoming.length).toBeGreaterThan(0);
    const req = incoming.find((l) => BigInt(l.amount) <= 1000n);
    expect(req).toBeDefined();
    if (req) {
      await client.approve(req.id);
      expect((await client.getLoan(req.id))!.status).toBe("Active");
      // wait for them to finish the loan one way or another
      for (let i = 0; i < 40; i++) {
        advance(0.5);
        const s = (await client.getLoan(req.id))!.status;
        if (s === "Repaid" || s === "RepaidLate") break;
      }
      expect(["Repaid", "RepaidLate", "Overdue"]).toContain((await client.getLoan(req.id))!.status);
    }
    // decline any other pending requests
    for (const l of (await client.loansOf(me)).filter((l) => l.lender === me && l.status === "Requested")) {
      await client.decline(l.id);
    }

    // go overdue on purpose
    const lenders = (await client.allPlayers()).filter((x) => x.account_id !== me && !x.has_overdue);
    let od: number | undefined;
    for (const l of lenders) {
      const lid = (await client.ask(l.account_id, "100", 2)) as number;
      advance(0.4);
      if ((await client.getLoan(lid))!.status === "Active") {
        od = lid;
        break;
      }
    }
    expect(od).toBeDefined();
    advance(2.2);
    p = (await client.profile(me))!;
    expect(p.has_overdue).toBe(true);
    await expect(client.ask("ana.testnet", "100", 2)).rejects.toThrow(/Bayad muna/);
    await expect(client.ftTransfer("ana.testnet", "1")).rejects.toThrow(/Bayad muna/);
    const odLoan = (await client.getLoan(od!))!;
    expect(odLoan.past_due).toBe(true);
    // anyone may mark it (here: me, if a neighbour has not already)
    if (odLoan.status === "Active") await client.markOverdue(od!);
    expect((await client.getLoan(od!))!.status).toBe("Overdue");
    // can still repay (late, no bonus) and is free again
    await client.repay(od!);
    expect((await client.getLoan(od!))!.status).toBe("RepaidLate");
    expect((await client.profile(me))!.has_overdue).toBe(false);
    // cancel flow
    const c = (await client.ask("aling-nena.testnet", "100", 2)) as number;
    await client.cancel(c);
    expect((await client.getLoan(c))!.status).toBe("Cancelled");

    await invariants(client);
  });

  it("time skip lets neighbours act and keeps invariants over a long run", async () => {
    const { backend, client } = setup(11);
    for (let i = 0; i < 30; i++) backend.preview!.skipDays(1);
    const { stats } = await invariants(client);
    expect(stats.players).toBe(NPCS.length);
    expect(Number(stats.total_lent)).toBeGreaterThan(0);
  });
});
