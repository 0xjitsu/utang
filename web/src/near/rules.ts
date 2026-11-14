// Client-side previews of contract rules, for hints only. The contract is always the authority.

import type { Loan, PairCredit, Profile, Rules } from "./types";

export type CountBlocker = "too_young" | "pair_cooldown" | "borrower_cooldown";

/**
 * Would an on-time repayment of `loan` right now count (earn trust, limit growth, bonus)?
 * `borrowerLoans` must be the borrower's `loans_of` (newest first is fine).
 * Returns null when it would count, or the reason it would not.
 */
export function countBlocker(loan: Loan, borrowerLoans: Loan[], rules: Rules, now: bigint): CountBlocker | null {
  if (!loan.approved_at) return null;
  const day = BigInt(rules.day_ns);
  if (now < BigInt(loan.approved_at) + BigInt(rules.bonus_min_age_days) * day) return "too_young";
  const pairCooldown = BigInt(rules.pair_cooldown_days ?? 7) * day;
  const borrowerCooldown = BigInt(rules.borrower_count_cooldown_days ?? 1) * day;
  for (const l of borrowerLoans) {
    if (!l.counted || !l.closed_at) continue;
    const closed = BigInt(l.closed_at);
    const samePair =
      (l.lender === loan.lender && l.borrower === loan.borrower) ||
      (l.lender === loan.borrower && l.borrower === loan.lender);
    if (samePair && now < closed + pairCooldown) return "pair_cooldown";
    if (l.borrower === loan.borrower && now < closed + borrowerCooldown) return "borrower_cooldown";
  }
  return null;
}

/** When the loan becomes old enough to count. */
export function countsFrom(loan: Loan, rules: Rules): bigint | null {
  if (!loan.approved_at) return null;
  return BigInt(loan.approved_at) + BigInt(rules.bonus_min_age_days) * BigInt(rules.day_ns);
}

export const BLOCKER_TEXT: Record<CountBlocker, string> = {
  too_young: "This loan is less than a day old, so repaying now closes it without trust, limit growth or bonus.",
  pair_cooldown: "You two already had a counted repayment this week, so this one closes the loan without trust or bonus.",
  borrower_cooldown: "A borrower can earn at most one counted repayment per day, so this one won't add trust or bonus.",
};

/** Bonus a counted repayment would mint in total (both sides), ignoring the pool. */
export function expectedBonus(amount: string, rules: Rules): bigint {
  const a = BigInt(amount);
  const cap = BigInt(rules.bonus_base_cap ?? amount);
  const base = a < cap ? a : cap;
  return (base * BigInt(rules.bonus_bps)) / 10000n;
}

/**
 * Pair credit computed from `loans_of(me)`: first_loan_cap × (1 + counted repayments between us).
 * Used as a fallback when the `pair_credit` view is unavailable, and as the instant first guess.
 */
export function pairCreditFromLoans(me: string, other: string, myLoans: Loan[], rules: Rules): PairCredit {
  const n = myLoans.filter(
    (l) => l.counted && ((l.lender === me && l.borrower === other) || (l.lender === other && l.borrower === me)),
  ).length;
  return { counted_repayments: n, cap: (BigInt(rules.first_loan_cap) * BigInt(1 + n)).toString() };
}

/** How much more this player can lend right now. */
export function availableToLend(p: Pick<Profile, "lending_limit" | "lent_out">): bigint {
  const v = BigInt(p.lending_limit) - BigInt(p.lent_out);
  return v > 0n ? v : 0n;
}

export function openLoanCount(accountId: string, loans: Loan[]): number {
  return loans.filter(
    (l) => l.borrower === accountId && (l.status === "Requested" || l.status === "Active" || l.status === "Overdue"),
  ).length;
}

/** Trust needed to reach the next level, and progress 0..1 within the current level. */
export function levelProgress(trust: number, step: number): { next: number; frac: number } {
  const base = Math.floor(trust / step) * step;
  return { next: base + step, frac: (trust - base) / step };
}
