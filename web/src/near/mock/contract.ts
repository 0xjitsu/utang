// In-memory implementation of the $UTANG contract (docs/INTERFACE.md), used for PREVIEW mode
// and tests. It follows the contract rules exactly and returns the same JSON shapes
// (U128/U64 as strings), so the UI cannot tell it apart from the real thing.

import type { Loan, LoanStatus, Profile, Rules, Stats, StorageBalance } from "../types";

export const PREVIEW_DAY_NS = 60_000_000_000n; // demo build: 1 day = 1 minute

/** The 27 barangays of Mandaluyong City, in the contract's order (names as in OpenStreetMap). */
export const BARANGAYS = [
  "Addition Hills", "Bagong Silang", "Barangka Drive", "Barangka Ibaba", "Barangka Ilaya",
  "Barangka Itaas", "Buayang Bato", "Burol", "Daang Bakal", "Hagdang Bato Itaas", "Hagdang Bato Libis",
  "Harapin ang Bukas", "Highway Hills", "Hulo", "Mabini-J. Rizal", "Malamig", "Mauway", "Namayan",
  "New Zañiga", "Old Zañiga", "Pag-asa", "Plainview", "Pleasant Hills", "Poblacion", "San Jose",
  "Vergara", "Wack-Wack Greenhills",
];

export function makeRules(dayNs: bigint = PREVIEW_DAY_NS, demoTime = true): Rules {
  return {
    demo_time: demoTime,
    day_ns: dayNs.toString(),
    join_deposit: "10000000000000000000000",
    starting_limit: "1000",
    max_limit: "100000",
    min_limit: "100",
    min_loan: "100",
    max_loan: "100000",
    min_days: 2,
    max_days: 30,
    max_open_loans_per_borrower: 5,
    bonus_bps: 1000,
    bonus_base_cap: "1000",
    bonus_pool_cap: "10000000",
    first_loan_cap: "1000",
    bonus_min_age_days: 1,
    pair_cooldown_days: 7,
    borrower_count_cooldown_days: 1,
    trust_on_time_borrower: 10,
    trust_on_time_lender: 5,
    trust_overdue_borrower: -20,
    trust_overdue_lender: -10,
    trust_late_repay_borrower: 5,
    trust_late_repay_lender: 2,
    level_step: 50,
    barangays: [...BARANGAYS],
  };
}

interface PlayerState {
  trust: number;
  lending_limit: bigint;
  lent_out: bigint;
  loans_repaid_on_time: number;
  loans_repaid_late: number;
  loans_overdue: number;
  loans_made: number;
  loans_made_repaid: number;
  joined_at: bigint;
  player_index: number;
  /** Time of this player's last counted repayment as borrower. */
  last_counted_at: bigint | null;
  /** Index into rules.barangays, or null. */
  barangay: number | null;
}

interface LoanState {
  id: number;
  lender: string;
  borrower: string;
  amount: bigint;
  days: number;
  status: LoanStatus;
  requested_at: bigint;
  approved_at: bigint | null;
  due_at: bigint | null;
  closed_at: bigint | null;
  bonus_paid: bigint;
  counted: boolean;
  /** Overdue penalty already applied (by mark_overdue, or by a late repay). */
  penalized: boolean;
}

export interface MockEvent {
  event: string;
  data: Record<string, unknown>;
  at: string;
}

export class MockPanic extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MockPanic";
  }
}

function panic(msg: string): never {
  throw new MockPanic(msg);
}

const COIN_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 12 12'%3E%3Crect x='1' y='1' width='10' height='10' fill='%23f2c14e'/%3E%3C/svg%3E";

const ROUNDTRIP = <T>(v: T): T => JSON.parse(JSON.stringify(v));

export class MockUtangContract {
  readonly rules: Rules;
  private readonly dayNs: bigint;
  private players = new Map<string, PlayerState>();
  private playerOrder: string[] = [];
  private balances = new Map<string, bigint>();
  private loans: LoanState[] = [];
  /** Unordered pair -> time of its last counted repayment. */
  private pairLastCounted = new Map<string, bigint>();
  /** Unordered pair -> number of counted repayments between them (either direction). */
  private pairCounted = new Map<string, number>();
  private totalSupply = 0n;
  private totalLent = 0n;
  private totalRepaidOnTime = 0n;
  private totalRepaidLate = 0n;
  private bonusMinted = 0n;
  /** Recent events (NEP-297 style), newest last; capped. */
  events: MockEvent[] = [];

  constructor(rules: Rules = makeRules()) {
    this.rules = rules;
    this.dayNs = BigInt(rules.day_ns);
  }

  // ------------------------------------------------------------------ dispatch

  view(method: string, args: Record<string, any> = {}, now: bigint): unknown {
    switch (method) {
      case "rules":
        return ROUNDTRIP(this.rules);
      case "get_loan":
        return this.getLoan(num(args.loan_id), now);
      case "loans_of":
        return this.loansOf(str(args.account_id), now);
      case "listahan":
        return this.listahan(args.from_index, args.limit, now);
      case "overdue":
        return this.overdue(now);
      case "profile":
        return this.profile(str(args.account_id), now);
      case "players":
        return this.playersView(args.from_index, args.limit, now);
      case "leaderboard":
        return this.leaderboard(args.limit, now);
      case "stats":
        return this.stats(now);
      case "players_in":
        return this.playersIn(str(args.barangay), args.from_index, args.limit, now);
      case "barangay_counts":
        return this.barangayCounts();
      case "pair_credit": {
        const a = str(args.a);
        const b = str(args.b);
        return { counted_repayments: this.pairCountedRepayments(a, b), cap: this.pairCreditCap(a, b).toString() };
      }
      case "ft_balance_of":
        return (this.balances.get(str(args.account_id)) ?? 0n).toString();
      case "ft_total_supply":
        return this.totalSupply.toString();
      case "ft_metadata":
        return {
          spec: "ft-1.0.0",
          name: "Utang",
          symbol: "UTANG",
          icon: COIN_ICON,
          reference: null,
          reference_hash: null,
          decimals: 2,
        };
      case "storage_balance_of":
        return this.players.has(str(args.account_id))
          ? ({ total: this.rules.join_deposit, available: "0" } satisfies StorageBalance)
          : null;
      case "storage_balance_bounds":
        return { min: this.rules.join_deposit, max: this.rules.join_deposit };
      default:
        panic(`MethodNotFound: ${method}`);
    }
  }

  call(caller: string, method: string, args: Record<string, any>, deposit: bigint, now: bigint): unknown {
    switch (method) {
      case "storage_deposit":
        return this.storageDeposit(caller, args.account_id ?? caller, deposit, now);
      case "ask":
        if (deposit > 1n) panic("ask takes no deposit (at most 1 yoctoNEAR)");
        return this.ask(caller, str(args.lender), BigInt(str(args.amount)), num(args.days), now);
      case "approve":
        noDeposit(method, deposit);
        return this.approve(caller, num(args.loan_id), now);
      case "decline":
        noDeposit(method, deposit);
        return this.decline(caller, num(args.loan_id), now);
      case "cancel":
        noDeposit(method, deposit);
        return this.cancel(caller, num(args.loan_id), now);
      case "repay":
        noDeposit(method, deposit);
        return this.repay(caller, num(args.loan_id), now);
      case "set_barangay":
        noDeposit(method, deposit);
        return this.setBarangay(caller, str(args.barangay), now);
      case "mark_overdue":
        noDeposit(method, deposit);
        return this.markOverdue(num(args.loan_id), now);
      case "ft_transfer":
        // Past-due check runs before the 1-yocto check, as in the contract.
        if (this.hasPastDue(caller, now)) panic("Bayad muna: you have an overdue loan");
        if (deposit !== 1n) panic("Requires attached deposit of exactly 1 yoctoNEAR");
        return this.ftTransfer(caller, str(args.receiver_id), BigInt(str(args.amount)), now);
      case "storage_withdraw":
      case "storage_unregister":
        panic("Leaving the neighbourhood is not supported");
      default:
        panic(`MethodNotFound: ${method}`);
    }
  }

  // ------------------------------------------------------------------ change methods

  storageDeposit(_caller: string, accountId: string, deposit: bigint, now: bigint): StorageBalance {
    const min = BigInt(this.rules.join_deposit);
    if (this.players.has(accountId)) {
      // Re-registering is a no-op; the deposit is refunded.
      return { total: this.rules.join_deposit, available: "0" };
    }
    if (deposit < min) panic("The join deposit is 0.01 NEAR");
    this.players.set(accountId, {
      trust: 0,
      lending_limit: BigInt(this.rules.starting_limit),
      lent_out: 0n,
      loans_repaid_on_time: 0,
      loans_repaid_late: 0,
      loans_overdue: 0,
      loans_made: 0,
      loans_made_repaid: 0,
      joined_at: now,
      player_index: this.playerOrder.length,
      last_counted_at: null,
      barangay: null,
    });
    this.playerOrder.push(accountId);
    if (!this.balances.has(accountId)) this.balances.set(accountId, 0n);
    this.emit("player_joined", { account_id: accountId }, now);
    return { total: this.rules.join_deposit, available: "0" };
  }

  ask(caller: string, lender: string, amount: bigint, days: number, now: bigint): number {
    // Same validation order as the contract (contract/NOTES.md #8).
    if (caller === lender) panic("You cannot borrow from yourself");
    this.requireRegistered(caller);
    if (!this.players.has(lender)) panic("The lender is not registered");
    if (amount < BigInt(this.rules.min_loan) || amount > BigInt(this.rules.max_loan))
      panic("Amount must be between 1.00 and 1,000.00 UTANG");
    if (!Number.isInteger(days) || days < this.rules.min_days || days > this.rules.max_days)
      panic(`Days must be between ${this.rules.min_days} and ${this.rules.max_days}`);
    if (this.hasPastDue(caller, now)) panic("Bayad muna: you have an overdue loan");
    const open = this.loans.filter(
      (l) => l.borrower === caller && (l.status === "Requested" || l.status === "Active" || l.status === "Overdue"),
    ).length;
    if (open >= this.rules.max_open_loans_per_borrower)
      panic(`Too many open loans: at most ${this.rules.max_open_loans_per_borrower} requested or active`);
    const credit = this.pairCreditCap(caller, lender);
    if (amount > credit) panic(`Credit between you two is at most ${plainAmount(credit)} right now`);
    const loan: LoanState = {
      id: this.loans.length,
      lender,
      borrower: caller,
      amount,
      days,
      status: "Requested",
      requested_at: now,
      approved_at: null,
      due_at: null,
      closed_at: null,
      bonus_paid: 0n,
      counted: false,
      penalized: false,
    };
    this.loans.push(loan);
    this.emit("loan_asked", { loan_id: loan.id, lender, borrower: caller, amount: amount.toString(), days }, now);
    return loan.id;
  }

  decline(caller: string, loanId: number, now: bigint): void {
    this.requireRegistered(caller);
    const loan = this.loan(loanId);
    if (loan.lender !== caller) panic("Only the lender can do this");
    if (loan.status !== "Requested") panic("Loan is not a pending request");
    loan.status = "Declined";
    loan.closed_at = now;
    this.emit("loan_declined", { loan_id: loanId }, now);
  }

  cancel(caller: string, loanId: number, now: bigint): void {
    this.requireRegistered(caller);
    const loan = this.loan(loanId);
    if (loan.borrower !== caller) panic("Only the borrower can do this");
    if (loan.status !== "Requested") panic("Loan is not a pending request");
    loan.status = "Cancelled";
    loan.closed_at = now;
    this.emit("loan_cancelled", { loan_id: loanId }, now);
  }

  approve(caller: string, loanId: number, now: bigint): void {
    this.requireRegistered(caller);
    const loan = this.loan(loanId);
    if (loan.lender !== caller) panic("Only the lender can do this");
    if (loan.status !== "Requested") panic("Loan is not a pending request");
    const lender = this.player(loan.lender);
    if (lender.lent_out + loan.amount > lender.lending_limit) panic("Over your lending limit");
    if (this.hasPastDue(loan.borrower, now)) panic("Bayad muna: the borrower has an overdue loan");
    this.mint(loan.borrower, loan.amount, now);
    loan.status = "Active";
    loan.approved_at = now;
    loan.due_at = now + BigInt(loan.days) * this.dayNs;
    lender.lent_out += loan.amount;
    lender.loans_made += 1;
    this.totalLent += loan.amount;
    this.emit("loan_approved", { loan_id: loanId, due_at: loan.due_at.toString() }, now);
  }

  repay(caller: string, loanId: number, now: bigint): void {
    this.requireRegistered(caller);
    const loan = this.loan(loanId);
    if (loan.borrower !== caller) panic("Only the borrower can do this");
    if (loan.status !== "Active" && loan.status !== "Overdue") panic("Loan is not Active or Overdue");
    const bal = this.balances.get(caller) ?? 0n;
    if (bal < loan.amount) panic("Not enough UTANG to repay this loan");
    this.burn(caller, loan.amount, now);
    const borrower = this.player(loan.borrower);
    const lender = this.player(loan.lender);
    const onTime = loan.status === "Active" && now <= (loan.due_at as bigint);
    if (onTime) {
      loan.status = "Repaid";
      loan.closed_at = now;
      lender.lent_out -= loan.amount;
      this.totalRepaidOnTime += loan.amount;
      loan.counted = this.counts(loan, now);
      if (loan.counted) {
        this.addTrust(borrower, this.rules.trust_on_time_borrower);
        this.addTrust(lender, this.rules.trust_on_time_lender);
        borrower.loans_repaid_on_time += 1;
        borrower.last_counted_at = now;
        lender.loans_made_repaid += 1;
        lender.lending_limit = min(BigInt(this.rules.max_limit), lender.lending_limit + loan.amount);
        const key = pairKey(loan.lender, loan.borrower);
        this.pairLastCounted.set(key, now);
        this.pairCounted.set(key, (this.pairCounted.get(key) ?? 0) + 1);
      }
      this.emit("loan_repaid", { loan_id: loanId, counted: loan.counted }, now);
      if (loan.counted) this.payBonus(loan, now);
    } else {
      if (!loan.penalized) this.applyOverduePenalty(loan, now);
      loan.status = "RepaidLate";
      loan.closed_at = now;
      this.addTrust(borrower, this.rules.trust_late_repay_borrower);
      this.addTrust(lender, this.rules.trust_late_repay_lender);
      borrower.loans_repaid_late += 1;
      this.totalRepaidLate += loan.amount;
      this.emit("loan_repaid_late", { loan_id: loanId }, now);
    }
  }

  /** Pick or change the caller's barangay. Must exactly match one of rules.barangays. */
  setBarangay(caller: string, barangay: string, now: bigint): void {
    const idx = this.rules.barangays.indexOf(barangay);
    if (idx < 0) panic("Unknown barangay");
    const p = this.players.get(caller);
    if (!p) panic("You are not registered: call storage_deposit first");
    p.barangay = idx;
    this.emit("barangay_set", { account_id: caller, barangay }, now);
  }

  playersIn(barangay: string, fromIndex: unknown, limit: unknown, now: bigint): Profile[] {
    const idx = this.rules.barangays.indexOf(barangay);
    if (idx < 0) return [];
    const from = optNum(fromIndex, 0);
    const lim = optNum(limit, 50);
    return this.playerOrder
      .filter((a) => this.players.get(a)!.barangay === idx)
      .slice(from, from + lim)
      .map((a) => this.profile(a, now) as Profile);
  }

  barangayCounts(): Record<string, number> {
    const counts = new Array(this.rules.barangays.length).fill(0);
    for (const p of this.players.values()) if (p.barangay !== null) counts[p.barangay] += 1;
    const out: Record<string, number> = {};
    // BTreeMap in the contract: keys sorted by byte order
    const keys = this.rules.barangays.map((b, i) => [b, counts[i]] as const).filter(([, n]) => n > 0);
    keys.sort(([a], [b]) => byteCompare(a, b));
    for (const [b, n] of keys) out[b] = n;
    return out;
  }

  markOverdue(loanId: number, now: bigint): void {
    const loan = this.loan(loanId);
    if (loan.status !== "Active") panic("Loan is not Active");
    if (!(now > (loan.due_at as bigint))) panic("Loan is not past its due date yet");
    this.applyOverduePenalty(loan, now);
  }

  ftTransfer(caller: string, receiver: string, amount: bigint, now: bigint): void {
    if (!this.players.has(caller)) panic(`The account ${caller} is not registered`);
    if (!this.players.has(receiver)) panic(`The account ${receiver} is not registered`);
    if (caller === receiver) panic("Sender and receiver should be different");
    if (amount <= 0n) panic("The amount should be a positive number");
    if (this.hasPastDue(caller, now)) panic("Bayad muna: you have an overdue loan");
    const bal = this.balances.get(caller) ?? 0n;
    if (bal < amount) panic("The account doesn't have enough balance");
    this.balances.set(caller, bal - amount);
    this.balances.set(receiver, (this.balances.get(receiver) ?? 0n) + amount);
    this.emit("ft_transfer", { old_owner_id: caller, new_owner_id: receiver, amount: amount.toString() }, now);
  }

  // ------------------------------------------------------------------ views

  getLoan(id: number, now: bigint): Loan | null {
    const l = this.loans[id];
    return l ? this.loanJson(l, now) : null;
  }

  loansOf(accountId: string, now: bigint): Loan[] {
    const out: Loan[] = [];
    for (let i = this.loans.length - 1; i >= 0; i--) {
      const l = this.loans[i];
      if (l.lender === accountId || l.borrower === accountId) out.push(this.loanJson(l, now));
    }
    return out;
  }

  listahan(fromIndex: unknown, limit: unknown, now: bigint): Loan[] {
    const from = optNum(fromIndex, 0);
    const lim = optNum(limit, 50);
    const out: Loan[] = [];
    for (let i = this.loans.length - 1 - from; i >= 0 && out.length < lim; i--) out.push(this.loanJson(this.loans[i], now));
    return out;
  }

  overdue(now: bigint): Loan[] {
    return this.loans.filter((l) => this.isPastDue(l, now)).map((l) => this.loanJson(l, now));
  }

  profile(accountId: string, now: bigint): Profile | null {
    const p = this.players.get(accountId);
    if (!p) return null;
    let borrowedOut = 0n;
    let hasOverdue = false;
    for (const l of this.loans) {
      if (l.borrower !== accountId) continue;
      if (l.status === "Active" || l.status === "Overdue") borrowedOut += l.amount;
      if (this.isPastDue(l, now)) hasOverdue = true;
    }
    const badges: string[] = [];
    if (p.player_index < 50) badges.push("founding_neighbour");
    if (p.loans_repaid_on_time >= 1) badges.push("first_repay");
    if (p.loans_repaid_on_time >= 10) badges.push("ten_on_time");
    if (p.loans_repaid_on_time >= 3 && p.loans_overdue === 0) badges.push("never_late");
    if (p.loans_made_repaid >= 5) badges.push("good_lender");
    if (p.trust >= 100) badges.push("trusted");
    return {
      account_id: accountId,
      balance: (this.balances.get(accountId) ?? 0n).toString(),
      trust: p.trust,
      level: Math.floor(p.trust / this.rules.level_step) + 1,
      lending_limit: p.lending_limit.toString(),
      lent_out: p.lent_out.toString(),
      borrowed_out: borrowedOut.toString(),
      loans_repaid_on_time: p.loans_repaid_on_time,
      loans_repaid_late: p.loans_repaid_late,
      loans_overdue: p.loans_overdue,
      loans_made: p.loans_made,
      loans_made_repaid: p.loans_made_repaid,
      has_overdue: hasOverdue,
      joined_at: p.joined_at.toString(),
      player_index: p.player_index,
      badges,
      barangay: p.barangay === null ? null : this.rules.barangays[p.barangay],
    };
  }

  playersView(fromIndex: unknown, limit: unknown, now: bigint): Profile[] {
    const from = optNum(fromIndex, 0);
    const lim = optNum(limit, 50);
    return this.playerOrder.slice(from, from + lim).map((a) => this.profile(a, now) as Profile);
  }

  leaderboard(limit: unknown, now: bigint): Profile[] {
    const lim = optNum(limit, 20);
    return this.playerOrder
      .map((a) => this.profile(a, now) as Profile)
      .sort((a, b) => b.trust - a.trust || b.loans_repaid_on_time - a.loans_repaid_on_time || a.player_index - b.player_index)
      .slice(0, lim);
  }

  stats(now: bigint): Stats {
    let outstanding = 0n;
    let overdueOutstanding = 0n;
    let active = 0;
    let requested = 0;
    for (const l of this.loans) {
      if (l.status === "Active" || l.status === "Overdue") outstanding += l.amount;
      if (this.isPastDue(l, now)) overdueOutstanding += l.amount;
      if (l.status === "Active") active += 1;
      if (l.status === "Requested") requested += 1;
    }
    const denom = this.totalRepaidOnTime + this.totalRepaidLate + overdueOutstanding;
    const trustIndex = denom === 0n ? 10000 : Number((this.totalRepaidOnTime * 10000n) / denom);
    return {
      total_supply: this.totalSupply.toString(),
      total_lent: this.totalLent.toString(),
      total_repaid_on_time: this.totalRepaidOnTime.toString(),
      total_repaid_late: this.totalRepaidLate.toString(),
      outstanding: outstanding.toString(),
      overdue_outstanding: overdueOutstanding.toString(),
      active_loans: active,
      requested_loans: requested,
      players: this.playerOrder.length,
      bonus_minted: this.bonusMinted.toString(),
      bonus_pool_left: (BigInt(this.rules.bonus_pool_cap) - this.bonusMinted).toString(),
      trust_index_bps: trustIndex,
    };
  }

  // ------------------------------------------------------------------ helpers (also used by the preview world)

  isRegistered(accountId: string): boolean {
    return this.players.has(accountId);
  }

  playerIds(): string[] {
    return [...this.playerOrder];
  }

  /** Counted repayments between the unordered pair. */
  pairCountedRepayments(a: string, b: string): number {
    return this.pairCounted.get(pairKey(a, b)) ?? 0;
  }

  /** first_loan_cap × (1 + counted repayments between the pair). */
  pairCreditCap(a: string, b: string): bigint {
    return BigInt(this.rules.first_loan_cap) * BigInt(1 + this.pairCountedRepayments(a, b));
  }

  hasPastDue(accountId: string, now: bigint): boolean {
    return this.loans.some((l) => l.borrower === accountId && this.isPastDue(l, now));
  }

  loanCount(): number {
    return this.loans.length;
  }

  private isPastDue(l: LoanState, now: bigint): boolean {
    return l.status === "Overdue" || (l.status === "Active" && l.due_at !== null && now > l.due_at);
  }

  private loanJson(l: LoanState, now: bigint): Loan {
    return {
      id: l.id,
      lender: l.lender,
      borrower: l.borrower,
      amount: l.amount.toString(),
      days: l.days,
      status: l.status,
      requested_at: l.requested_at.toString(),
      approved_at: l.approved_at?.toString() ?? null,
      due_at: l.due_at?.toString() ?? null,
      closed_at: l.closed_at?.toString() ?? null,
      bonus_paid: l.bonus_paid.toString(),
      counted: l.counted,
      past_due: this.isPastDue(l, now),
    };
  }

  private applyOverduePenalty(loan: LoanState, now: bigint) {
    const borrower = this.player(loan.borrower);
    const lender = this.player(loan.lender);
    loan.status = "Overdue";
    loan.penalized = true;
    this.addTrust(borrower, this.rules.trust_overdue_borrower);
    borrower.loans_overdue += 1;
    this.addTrust(lender, this.rules.trust_overdue_lender);
    lender.lending_limit = max(BigInt(this.rules.min_limit), lender.lending_limit / 2n);
    lender.lent_out -= loan.amount;
    this.emit("loan_overdue", { loan_id: loan.id }, now);
  }

  /** Counted repayment: loan ≥ 1 day old, pair not counted in 7 days, borrower not counted in 1 day. */
  counts(loan: { approved_at: bigint | null; lender: string; borrower: string }, now: bigint): boolean {
    const approvedAt = loan.approved_at ?? now;
    if (now < approvedAt + BigInt(this.rules.bonus_min_age_days) * this.dayNs) return false;
    const last = this.pairLastCounted.get(pairKey(loan.lender, loan.borrower));
    if (last !== undefined && now < last + BigInt(this.rules.pair_cooldown_days) * this.dayNs) return false;
    const b = this.players.get(loan.borrower)?.last_counted_at ?? null;
    if (b !== null && now < b + BigInt(this.rules.borrower_count_cooldown_days) * this.dayNs) return false;
    return true;
  }

  /** Why a repayment right now would not count (null = it would count). Used for UI hints. */
  countBlocker(loanId: number, now: bigint): "too_young" | "pair_cooldown" | "borrower_cooldown" | null {
    const loan = this.loans[loanId];
    if (!loan || loan.approved_at === null) return null;
    if (now < loan.approved_at + BigInt(this.rules.bonus_min_age_days) * this.dayNs) return "too_young";
    const last = this.pairLastCounted.get(pairKey(loan.lender, loan.borrower));
    if (last !== undefined && now < last + BigInt(this.rules.pair_cooldown_days) * this.dayNs) return "pair_cooldown";
    const b = this.players.get(loan.borrower)?.last_counted_at ?? null;
    if (b !== null && now < b + BigInt(this.rules.borrower_count_cooldown_days) * this.dayNs) return "borrower_cooldown";
    return null;
  }

  private payBonus(loan: LoanState, now: bigint) {
    const left = BigInt(this.rules.bonus_pool_cap) - this.bonusMinted;
    if (left <= 0n) return; // pool empty: still counts for trust and limit
    const base = min(loan.amount, BigInt(this.rules.bonus_base_cap));
    let bonus = (base * BigInt(this.rules.bonus_bps)) / 10000n;
    if (bonus > left) bonus = left;
    if (bonus <= 0n) return;
    const toLender = bonus / 2n;
    const toBorrower = bonus - toLender; // odd centavo to the borrower
    if (toLender > 0n) this.mint(loan.lender, toLender, now);
    this.mint(loan.borrower, toBorrower, now);
    this.bonusMinted += bonus;
    loan.bonus_paid = bonus;
    this.emit("bonus_paid", { loan_id: loan.id, amount: bonus.toString() }, now);
  }

  private addTrust(p: PlayerState, delta: number) {
    p.trust = Math.max(0, p.trust + delta);
  }

  private mint(account: string, amount: bigint, now: bigint) {
    this.balances.set(account, (this.balances.get(account) ?? 0n) + amount);
    this.totalSupply += amount;
    this.emit("ft_mint", { owner_id: account, amount: amount.toString() }, now);
  }

  private burn(account: string, amount: bigint, now: bigint) {
    this.balances.set(account, (this.balances.get(account) ?? 0n) - amount);
    this.totalSupply -= amount;
    this.emit("ft_burn", { owner_id: account, amount: amount.toString() }, now);
  }

  private emit(event: string, data: Record<string, unknown>, now: bigint) {
    this.events.push({ event, data, at: now.toString() });
    if (this.events.length > 200) this.events.splice(0, this.events.length - 200);
  }

  private requireRegistered(account: string) {
    if (!this.players.has(account)) panic("You are not registered: call storage_deposit first");
  }

  private player(account: string): PlayerState {
    const p = this.players.get(account);
    if (!p) panic(`Account ${account} is not registered`);
    return p;
  }

  private loan(id: number): LoanState {
    const l = this.loans[id];
    if (!l) panic("Loan not found");
    return l;
  }

  // ------------------------------------------------------------------ persistence

  toJSON(): unknown {
    const big = (v: bigint | null) => (v === null ? null : v.toString());
    return {
      rules: this.rules,
      players: this.playerOrder.map((a) => {
        const p = this.players.get(a)!;
        return {
          a,
          ...p,
          lending_limit: big(p.lending_limit),
          lent_out: big(p.lent_out),
          joined_at: big(p.joined_at),
          last_counted_at: big(p.last_counted_at),
        };
      }),
      balances: [...this.balances].map(([a, b]) => [a, b.toString()]),
      loans: this.loans.map((l) => ({
        ...l,
        amount: big(l.amount),
        requested_at: big(l.requested_at),
        approved_at: big(l.approved_at),
        due_at: big(l.due_at),
        closed_at: big(l.closed_at),
        bonus_paid: big(l.bonus_paid),
      })),
      pairLastCounted: [...this.pairLastCounted].map(([k, v]) => [k, v.toString()]),
      pairCounted: [...this.pairCounted],
      totals: [this.totalSupply, this.totalLent, this.totalRepaidOnTime, this.totalRepaidLate, this.bonusMinted].map(String),
      events: this.events,
    };
  }

  static fromJSON(raw: any): MockUtangContract {
    const c = new MockUtangContract(raw.rules);
    const nb = (v: string | null) => (v === null ? null : BigInt(v));
    for (const p of raw.players) {
      const { a, ...rest } = p;
      c.players.set(a, {
        ...rest,
        lending_limit: BigInt(rest.lending_limit),
        lent_out: BigInt(rest.lent_out),
        joined_at: BigInt(rest.joined_at),
        last_counted_at: nb(rest.last_counted_at ?? null),
        barangay: rest.barangay ?? null,
      });
      c.playerOrder.push(a);
    }
    for (const [a, b] of raw.balances) c.balances.set(a, BigInt(b));
    c.loans = raw.loans.map((l: any) => ({
      ...l,
      amount: BigInt(l.amount),
      requested_at: BigInt(l.requested_at),
      approved_at: nb(l.approved_at),
      due_at: nb(l.due_at),
      closed_at: nb(l.closed_at),
      bonus_paid: BigInt(l.bonus_paid),
      counted: Boolean(l.counted),
    }));
    for (const [k, v] of raw.pairLastCounted ?? []) c.pairLastCounted.set(k, BigInt(v));
    for (const [k, v] of raw.pairCounted ?? []) c.pairCounted.set(k, Number(v));
    [c.totalSupply, c.totalLent, c.totalRepaidOnTime, c.totalRepaidLate, c.bonusMinted] = raw.totals.map((v: string) =>
      BigInt(v),
    );
    c.events = raw.events ?? [];
    return c;
  }
}

/** UTF-8 byte order, like Rust's String ordering in a BTreeMap. */
function byteCompare(a: string, b: string): number {
  const x = new TextEncoder().encode(a);
  const y = new TextEncoder().encode(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i] - y[i];
  return x.length - y.length;
}

/** Rust-style amount: 2000 -> "20.00" (no thousands separator). */
function plainAmount(c: bigint): string {
  return `${c / 100n}.${(c % 100n).toString().padStart(2, "0")}`;
}
function noDeposit(method: string, deposit: bigint) {
  if (deposit > 0n) panic(`Method ${method} doesn't accept deposit`);
}
function pairKey(a: string, b: string) {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}
function min(a: bigint, b: bigint) {
  return a < b ? a : b;
}
function max(a: bigint, b: bigint) {
  return a > b ? a : b;
}
function str(v: unknown): string {
  if (typeof v !== "string") panic("Failed to deserialize input: expected string");
  return v;
}
function num(v: unknown): number {
  if (typeof v !== "number" || !Number.isInteger(v)) panic("Failed to deserialize input: expected integer");
  return v;
}
function optNum(v: unknown, d: number): number {
  return v === undefined || v === null ? d : num(v);
}
