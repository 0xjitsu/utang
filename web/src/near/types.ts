// Wire types for the $UTANG contract. Mirrors docs/INTERFACE.md exactly:
// U128 amounts are JSON strings in centavos, U64 timestamps are JSON strings in nanoseconds.

export type U128 = string;
export type U64 = string;

export type LoanStatus =
  | "Requested"
  | "Active"
  | "Overdue"
  | "Repaid"
  | "RepaidLate"
  | "Declined"
  | "Cancelled";

export const LOAN_STATUSES: LoanStatus[] = [
  "Requested",
  "Active",
  "Overdue",
  "Repaid",
  "RepaidLate",
  "Declined",
  "Cancelled",
];

export interface Rules {
  demo_time: boolean;
  day_ns: U64;
  join_deposit: U128; // yoctoNEAR
  starting_limit: U128;
  max_limit: U128;
  min_limit: U128;
  min_loan: U128;
  max_loan: U128;
  min_days: number;
  max_days: number;
  max_open_loans_per_borrower: number;
  bonus_bps: number;
  /** Bonus is computed on at most this much of a loan (max 1.00 bonus per loan). */
  bonus_base_cap: U128;
  bonus_pool_cap: U128;
  /** Pair credit step: a pair may borrow at most first_loan_cap × (1 + counted repayments between them). */
  first_loan_cap: U128;
  /** Minimum loan age (days) for an on-time repayment to count. */
  bonus_min_age_days: number;
  /** One counted repayment per unordered pair per this many days. */
  pair_cooldown_days: number;
  /** A borrower gets at most one counted repayment per this many days. */
  borrower_count_cooldown_days: number;
  trust_on_time_borrower: number;
  trust_on_time_lender: number;
  trust_overdue_borrower: number;
  trust_overdue_lender: number;
  trust_late_repay_borrower: number;
  trust_late_repay_lender: number;
  level_step: number;
  /** The 27 barangays of Mandaluyong City, exact UTF-8 names (e.g. "New Zañiga"). */
  barangays: string[];
}

export interface Loan {
  id: number;
  lender: string;
  borrower: string;
  amount: U128;
  days: number;
  status: LoanStatus;
  requested_at: U64;
  approved_at: U64 | null;
  due_at: U64 | null;
  closed_at: U64 | null;
  bonus_paid: U128;
  /** True if the on-time repayment counted (earned trust, limit growth and bonus). */
  counted: boolean;
  past_due: boolean;
}

export type BadgeId =
  | "founding_neighbour"
  | "first_repay"
  | "ten_on_time"
  | "never_late"
  | "good_lender"
  | "trusted";

export interface Profile {
  account_id: string;
  balance: U128;
  trust: number;
  level: number;
  lending_limit: U128;
  lent_out: U128;
  borrowed_out: U128;
  loans_repaid_on_time: number;
  loans_repaid_late: number;
  loans_overdue: number;
  loans_made: number;
  loans_made_repaid: number;
  has_overdue: boolean;
  joined_at: U64;
  player_index: number;
  // Typed loosely so an unknown badge id from a newer contract does not break the UI.
  badges: string[];
  /** One of rules().barangays, or null until the player picks one. Never an address. */
  barangay: string | null;
}

/** barangay_counts(): players per barangay (only barangays with at least one player). */
export type BarangayCounts = Record<string, number>;

export interface Stats {
  total_supply: U128;
  total_lent: U128;
  total_repaid_on_time: U128;
  total_repaid_late: U128;
  outstanding: U128;
  overdue_outstanding: U128;
  active_loans: number;
  requested_loans: number;
  players: number;
  bonus_minted: U128;
  bonus_pool_left: U128;
  trust_index_bps: number;
}

/** pair_credit({a, b}) for the unordered pair. */
export interface PairCredit {
  counted_repayments: number;
  /** first_loan_cap × (1 + counted_repayments), centavos */
  cap: U128;
}

// NEP-145
export interface StorageBalance {
  total: U128;
  available: U128;
}

export interface StorageBalanceBounds {
  min: U128;
  max: U128 | null;
}

// NEP-148
export interface FtMetadata {
  spec: string;
  name: string;
  symbol: string;
  icon: string | null;
  reference: string | null;
  reference_hash: string | null;
  decimals: number;
}
