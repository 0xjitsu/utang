// The PREVIEW neighbourhood: a mock contract plus a handful of computer-controlled neighbours
// who ask, approve, repay (mostly on time) and occasionally go overdue, so the whole daily loop
// can be clicked through before the real contract is deployed.
//
// NPCs only ever act through the public contract methods, so every rule is enforced by the mock.

import { MockPanic, MockUtangContract, makeRules, PREVIEW_DAY_NS } from "./contract";

export interface NpcPersona {
  id: string;
  /** Probability a loan is repaid on time. */
  reliability: number;
  /** Probability of approving a request that fits their limit. */
  generosity: number;
  /** Average game days between their own loan requests. */
  askEvery: number;
  /** Where their tindahan is (preview neighbours are spread over a few barangays). */
  barangay: string;
}

export const NPCS: NpcPersona[] = [
  { id: "aling-nena.testnet", reliability: 0.98, generosity: 0.9, askEvery: 6, barangay: "Hulo" },
  { id: "ana.testnet", reliability: 0.95, generosity: 0.85, askEvery: 2.5, barangay: "Hulo" },
  { id: "ben.testnet", reliability: 0.94, generosity: 0.75, askEvery: 2, barangay: "Plainview" },
  { id: "carlo.testnet", reliability: 0.93, generosity: 0.7, askEvery: 3, barangay: "Highway Hills" },
  { id: "dina.testnet", reliability: 0.97, generosity: 0.95, askEvery: 4, barangay: "Addition Hills" },
  { id: "kuya-jun.testnet", reliability: 0.55, generosity: 0.6, askEvery: 2, barangay: "Hulo" },
  { id: "mang-tomas.testnet", reliability: 0.93, generosity: 0.8, askEvery: 3.5, barangay: "Plainview" },
  { id: "rosa.testnet", reliability: 0.95, generosity: 0.85, askEvery: 3, barangay: "Highway Hills" },
  { id: "lito.testnet", reliability: 0.9, generosity: 0.65, askEvery: 2.5, barangay: "Addition Hills" },
];

export const DEFAULT_PLAYER = "ikaw.testnet";
/** The neighbour the first-time quest sends you to in preview. */
export const QUEST_LENDER = "aling-nena.testnet";

interface RepayPlan {
  at: string; // ns
  late: boolean;
}

interface WorldState {
  seed: number;
  rng: number;
  offsetNs: string; // added to the wall clock (time-skip)
  lastTickNs: string;
  nextAskAt: Record<string, string>;
  decideAt: Record<string, string>; // loan id -> when the NPC lender decides
  plans: Record<string, RepayPlan>; // loan id -> NPC borrower's plan
}

const STORAGE_KEY = "utang-preview-v5";

export class PreviewWorld {
  readonly contract: MockUtangContract;
  private state: WorldState;
  private readonly dayNs: bigint;
  private readonly clock: () => bigint;
  private listeners = new Set<() => void>();
  /** Players whose first-time quest isn't at "Now try lending" yet: neighbours don't ask them. */
  private held = new Set<string>();

  setHoldRequests(accountId: string, hold: boolean) {
    if (hold) this.held.add(accountId);
    else this.held.delete(accountId);
  }

  constructor(contract: MockUtangContract, state: WorldState, clock: () => bigint) {
    this.contract = contract;
    this.state = state;
    this.dayNs = BigInt(contract.rules.day_ns);
    this.clock = clock;
  }

  /** Builds a fresh neighbourhood with ~14 game days of history ending at the current time. */
  static create(opts: { seed?: number; clock?: () => bigint; dayNs?: bigint; historyDays?: number } = {}): PreviewWorld {
    const clock = opts.clock ?? wallClock;
    const dayNs = opts.dayNs ?? PREVIEW_DAY_NS;
    const seed = opts.seed ?? 20251114;
    const contract = new MockUtangContract(makeRules(dayNs, true));
    const realNow = clock();
    const historyDays = opts.historyDays ?? 14;
    const start = realNow - BigInt(historyDays) * dayNs;
    const world = new PreviewWorld(
      contract,
      {
        seed,
        rng: seed,
        offsetNs: "0",
        lastTickNs: start.toString(),
        nextAskAt: {},
        decideAt: {},
        plans: {},
      },
      clock,
    );
    world.seedHistory(start);
    return world;
  }

  static load(clock: () => bigint = wallClock): PreviewWorld | null {
    try {
      const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed?.v !== 2) return null;
      return new PreviewWorld(MockUtangContract.fromJSON(parsed.contract), parsed.world, clock);
    } catch {
      return null;
    }
  }

  static clearSaved() {
    try {
      globalThis.localStorage?.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  save() {
    try {
      globalThis.localStorage?.setItem(
        STORAGE_KEY,
        JSON.stringify({ v: 2, contract: this.contract.toJSON(), world: this.state }),
      );
    } catch {
      /* storage unavailable: preview still works, it just won't survive a reload */
    }
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  notify() {
    for (const fn of this.listeners) fn();
  }

  /** Current contract time (wall clock + any time skipped in preview). */
  now(): bigint {
    return this.clock() + BigInt(this.state.offsetNs);
  }

  /** Preview-only "time machine": jump ahead, letting neighbours act along the way. */
  skip(days: number) {
    this.state.offsetNs = (BigInt(this.state.offsetNs) + BigInt(Math.round(days * 1000)) * (this.dayNs / 1000n)).toString();
    this.tick();
  }

  /** Runs NPC behaviour up to now. Returns true if anything happened. */
  tick(): boolean {
    const target = this.now();
    let t = BigInt(this.state.lastTickNs);
    if (target <= t) return false;
    const step = this.dayNs / 20n; // NPCs look around every 1/20 of a game day
    const before = this.contract.events.length + this.contract.loanCount();
    let changed = false;
    while (t < target) {
      t = t + step < target ? t + step : target;
      if (this.npcStep(t)) changed = true;
    }
    this.state.lastTickNs = target.toString();
    if (changed || this.contract.events.length + this.contract.loanCount() !== before) {
      this.save();
      this.notify();
      return true;
    }
    return false;
  }

  /** Called after the player acts so NPCs can schedule their response. */
  afterPlayerAction() {
    this.save();
    this.notify();
  }

  // ------------------------------------------------------------------ NPC logic

  private npcStep(now: bigint): boolean {
    let acted = false;
    const c = this.contract;
    const isNpc = (id: string) => NPCS.some((n) => n.id === id);
    // 1. Join (seeding only: everyone in NPCS is registered at start).
    // 2. Lenders decide on pending requests addressed to them.
    for (const loan of c.listahan(0, 1000, now)) {
      if (loan.status !== "Requested" || !isNpc(loan.lender)) continue;
      const key = String(loan.id);
      if (!this.state.decideAt[key]) {
        const delay = this.rand(0.05, 0.35);
        this.state.decideAt[key] = (BigInt(loan.requested_at) + this.days(delay)).toString();
      }
      if (now < BigInt(this.state.decideAt[key])) continue;
      const persona = NPCS.find((n) => n.id === loan.lender)!;
      const lender = c.profile(loan.lender, now)!;
      const borrower = c.profile(loan.borrower, now)!;
      const fits = BigInt(lender.lent_out) + BigInt(loan.amount) <= BigInt(lender.lending_limit);
      // No room yet? Wait for a repayment to free the limit (up to ~1.5 days) before saying no.
      if (!fits && now < BigInt(loan.requested_at) + this.days(1.5)) {
        this.state.decideAt[key] = (now + this.days(0.25)).toString();
        continue;
      }
      delete this.state.decideAt[key];
      let p = persona.generosity + Math.min(0.2, borrower.trust / 250) - borrower.loans_overdue * 0.15;
      if (!isNpc(loan.borrower)) p = Math.max(p, 0.85); // be welcoming to the human player
      if (!isNpc(loan.borrower) && loan.lender === QUEST_LENDER) p = 1; // the quest's first loan always works
      if (fits && !borrower.has_overdue && this.rng() < p) {
        acted = this.try(() => c.approve(loan.lender, loan.id, now)) || acted;
      } else {
        acted = this.try(() => c.decline(loan.lender, loan.id, now)) || acted;
      }
    }
    // 3. Borrowers follow their repayment plan.
    for (const loan of c.listahan(0, 1000, now)) {
      if ((loan.status !== "Active" && loan.status !== "Overdue") || !isNpc(loan.borrower)) continue;
      const key = String(loan.id);
      let plan = this.state.plans[key];
      if (!plan) {
        plan = this.planRepay(loan.borrower, BigInt(loan.approved_at!), loan.days);
        this.state.plans[key] = plan;
      }
      if (now < BigInt(plan.at)) continue;
      if (this.try(() => c.repay(loan.borrower, loan.id, now))) {
        delete this.state.plans[key];
        acted = true;
      }
    }
    // 4. A watchful neighbour marks loans that are well past due.
    for (const loan of c.overdue(now)) {
      if (loan.status === "Active" && now > BigInt(loan.due_at!) + this.days(0.5)) {
        acted = this.try(() => c.markOverdue(loan.id, now)) || acted;
      }
    }
    // 5. Neighbours ask each other (and the player) for small loans.
    const everyone = c.playerIds();
    for (const npc of NPCS) {
      if (!c.isRegistered(npc.id)) continue;
      const next = this.state.nextAskAt[npc.id];
      if (next === undefined) {
        this.state.nextAskAt[npc.id] = (now + this.days(this.rand(0.2, npc.askEvery))).toString();
        continue;
      }
      if (now < BigInt(next)) continue;
      this.state.nextAskAt[npc.id] = (now + this.days(this.rand(npc.askEvery * 0.5, npc.askEvery * 1.5))).toString();
      if (c.hasPastDue(npc.id, now)) continue;
      const humans = everyone.filter((a) => !isNpc(a));
      const pendingToHuman = (h: string) =>
        c.loansOf(h, now).filter((l) => l.status === "Requested" && l.lender === h).length;
      let lender: string | undefined;
      const human = humans.find((h) => pendingToHuman(h) < 3 && !this.held.has(h));
      if (human && this.rng() < 0.45) lender = human;
      else {
        // Neighbours ask someone who has room in their lending limit.
        const others = everyone.filter((a) => {
          // Aling Nena keeps her credit free for newcomers (the first-time quest asks her).
          if (a === npc.id || !isNpc(a) || a === QUEST_LENDER) return false;
          const p = c.profile(a, now)!;
          return BigInt(p.lending_limit) - BigInt(p.lent_out) >= 500n && !p.has_overdue;
        });
        lender = others[Math.floor(this.rng() * others.length)];
      }
      if (!lender || lender === npc.id) continue;
      // Don't stack requests to the same lender.
      if (c.loansOf(npc.id, now).some((l) => l.status === "Requested" && l.lender === lender)) continue;
      let amount = [500n, 500n, 1000n, 1000n, 2000n][Math.floor(this.rng() * 5)];
      const cap = c.pairCreditCap(npc.id, lender);
      if (amount > cap) amount = cap;
      if (isNpc(lender)) {
        const lp = c.profile(lender, now)!;
        const room = BigInt(lp.lending_limit) - BigInt(lp.lent_out);
        if (amount > room) amount = room >= 1000n ? 1000n : 500n;
      }
      const days = [2, 2, 3, 3, 3, 5, 7][Math.floor(this.rng() * 7)];
      acted = this.try(() => c.ask(npc.id, lender, amount, days, now)) || acted;
    }
    return acted;
  }

  private planRepay(borrower: string, approvedAt: bigint, days: number): RepayPlan {
    const persona = NPCS.find((n) => n.id === borrower);
    const reliability = persona?.reliability ?? 0.9;
    if (this.rng() < reliability) {
      // On time; usually after a day so the bonus applies.
      const frac = days >= 2 ? this.rand(Math.min(1.05, days * 0.9) / days, 0.95) : this.rand(0.4, 0.95);
      return { at: (approvedAt + this.days(days * frac)).toString(), late: false };
    }
    return { at: (approvedAt + this.days(days + this.rand(0.7, 4))).toString(), late: true };
  }

  private seedHistory(start: bigint) {
    const c = this.contract;
    // Everyone joins on the first morning.
    NPCS.forEach((n, i) => {
      c.storageDeposit(n.id, n.id, BigInt(c.rules.join_deposit), start + this.days(i * 0.02));
      c.setBarangay(n.id, n.barangay, start + this.days(i * 0.02 + 0.01));
    });
    // A few scripted loans so the notebook tells a story from the start.
    const d = (x: number) => start + this.days(x);
    const script: [string, string, bigint, number, number][] = [
      // borrower, lender, amount, days, ask-day
      ["ben.testnet", "ana.testnet", 1000n, 7, 0.3],
      ["rosa.testnet", "aling-nena.testnet", 500n, 3, 0.5],
      ["kuya-jun.testnet", "mang-tomas.testnet", 1000n, 3, 1.0],
      ["carlo.testnet", "dina.testnet", 1000n, 5, 1.2],
    ];
    for (const [b, l, amt, days, at] of script) {
      const id = c.ask(b, l, amt, days, d(at));
      c.approve(l, id, d(at + 0.1));
      if (b === "kuya-jun.testnet") this.state.plans[String(id)] = { at: d(8).toString(), late: true }; // repaid late
    }
    // Let the neighbourhood live for the remaining days up to the present.
    const realNow = this.clock();
    const injectAt = realNow - this.days(3.5);
    let injected = false;
    let t = d(1.3);
    const step = this.dayNs / 20n;
    while (t < realNow) {
      t = t + step < realNow ? t + step : realNow;
      this.npcStep(t);
      if (!injected && t >= injectAt) {
        injected = true;
        this.injectOverdueStory(t);
      }
    }
    this.state.lastTickNs = realNow.toString();
  }

  /** Make sure one neighbour is visibly overdue in the preview ("Bayad muna"), the kind way. */
  private injectOverdueStory(t: bigint) {
    const c = this.contract;
    const jun = "kuya-jun.testnet";
    if (c.hasPastDue(jun, t)) return;
    for (const lender of ["lito.testnet", "rosa.testnet", "ana.testnet", "dina.testnet"]) {
      try {
        const id = c.ask(jun, lender, 500n, 2, t);
        c.approve(lender, id, t);
        this.state.plans[String(id)] = { at: (t + this.days(4.5)).toString(), late: true };
        return;
      } catch (e) {
        if (!(e instanceof MockPanic)) throw e;
      }
    }
  }

  // ------------------------------------------------------------------ utils

  private days(x: number): bigint {
    return (BigInt(Math.round(x * 1_000_000)) * this.dayNs) / 1_000_000n;
  }

  /** mulberry32, state persisted so the preview is reproducible. */
  private rng(): number {
    let t = (this.state.rng = (this.state.rng + 0x6d2b79f5) | 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  private rand(lo: number, hi: number): number {
    return lo + (hi - lo) * this.rng();
  }

  private try(fn: () => void): boolean {
    try {
      fn();
      return true;
    } catch (e) {
      if (e instanceof MockPanic) return false;
      throw e;
    }
  }
}

export function wallClock(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}
