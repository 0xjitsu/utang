// Formatting helpers. Amounts are integer centavos (decimals = 2); times are nanoseconds.

import type { Loan, Rules } from "./types";

export const DECIMALS = 2;

/** "1050" -> "10.50"; "123456" -> "1,234.56" */
export function fmtUtang(centavos: string | bigint | number, opts: { sign?: boolean } = {}): string {
  let v = BigInt(centavos);
  const neg = v < 0n;
  if (neg) v = -v;
  const whole = (v / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const frac = (v % 100n).toString().padStart(2, "0");
  const sign = neg ? "−" : opts.sign && v > 0n ? "+" : "";
  return `${sign}${whole}.${frac}`;
}

/** Compact for charts: 12345600 centavos -> "123.5k" */
export function fmtUtangShort(centavos: number): string {
  const u = centavos / 100;
  const a = Math.abs(u);
  if (a >= 1_000_000) return `${(u / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1)}M`;
  if (a >= 1_000) return `${(u / 1_000).toFixed(a >= 10_000 ? 0 : 1)}k`;
  if (a >= 100) return u.toFixed(0);
  return u.toFixed(a >= 10 ? 1 : 2).replace(/\.?0+$/, "") || "0";
}

/** "10", "10.5", "10.50" -> "1050". Returns null on invalid input or more than 2 decimals. */
export function parseUtang(input: string): string | null {
  const s = input.trim().replace(/,/g, "");
  const m = /^(\d{1,12})(?:\.(\d{0,2}))?$/.exec(s);
  if (!m) return null;
  const whole = BigInt(m[1]);
  const frac = BigInt((m[2] ?? "").padEnd(2, "0") || "0");
  return (whole * 100n + frac).toString();
}

export function fmtNear(yocto: string | bigint): string {
  const v = BigInt(yocto);
  const base = 10n ** 24n;
  const whole = v / base;
  const frac = (v % base).toString().padStart(24, "0").slice(0, 4).replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : whole.toString();
}

export function nowNs(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

/** Fraction of a game day as a number (may be negative). */
export function nsToDays(ns: bigint, dayNs: bigint): number {
  return Number(ns) / Number(dayNs);
}

/**
 * A duration in *game* days, where one day = rules().day_ns.
 * 3.4 days -> "3d 9h"; 0.3 days -> "7h"; tiny -> "<1h".
 */
export function fmtGameDuration(ns: bigint, dayNs: bigint): string {
  const abs = ns < 0n ? -ns : ns;
  const hourNs = dayNs / 24n || 1n;
  const days = abs / dayNs;
  const hours = (abs % dayNs) / hourNs;
  if (days > 0n) return hours > 0n ? `${days}d ${hours}h` : `${days}d`;
  if (hours > 0n) return `${hours}h`;
  return "<1h";
}

/** Wall-clock duration: 150 s -> "2m 30s". */
export function fmtRealDuration(ns: bigint): string {
  const s = Number((ns < 0n ? -ns : ns) / 1_000_000_000n);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ${m % 60}m`;
  return `${Math.floor(h / 24)}d ${h % 24}h`;
}

/**
 * One time unit in primary labels. Demo builds (1 day = 1 minute) show real time only ("2m 20s");
 * normal builds show game time ("2d 8h"). The game-day equivalent goes in `fmtSpanHint` (tooltips).
 */
export function fmtSpan(ns: bigint, rules: Pick<Rules, "day_ns" | "demo_time">): string {
  return rules.demo_time ? fmtRealDuration(ns) : fmtGameDuration(ns, BigInt(rules.day_ns));
}

/** Secondary text for tooltips: "≈ 2d 8h of game time" in demo builds, "" otherwise. */
export function fmtSpanHint(ns: bigint, rules: Pick<Rules, "day_ns" | "demo_time">): string {
  const abs = ns < 0n ? -ns : ns;
  return rules.demo_time ? `≈ ${fmtGameDuration(abs, BigInt(rules.day_ns))} of game time (1 day = 1 minute)` : "";
}

/** "in 2m 20s (≈2d 8h)", "3m ago (≈3d)", or "just now" for anything under a game hour. */
export function fmtRelative(atNs: string | bigint, now: bigint, rules: Pick<Rules, "day_ns" | "demo_time">): string {
  const diff = BigInt(atNs) - now;
  const abs = diff < 0n ? -diff : diff;
  if (abs < BigInt(rules.day_ns) / 24n) return diff >= 0n ? "any moment now" : "just now";
  const span = fmtSpan(abs, rules);
  return diff >= 0n ? `in ${span}` : `${span} ago`;
}

/** Calendar-ish label for a timestamp. In demo time, shows the game day number since `originNs`. */
export function fmtWhen(atNs: string | bigint, rules: Pick<Rules, "demo_time">): string {
  const ms = Number(BigInt(atNs) / 1_000_000n);
  const d = new Date(ms);
  if (rules.demo_time) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export type LoanView =
  | "requested"
  | "active"
  | "pastdue" // Active but past due, not yet marked
  | "overdue"
  | "repaid"
  | "repaidlate"
  | "declined"
  | "cancelled";

export function loanView(loan: Loan): LoanView {
  switch (loan.status) {
    case "Requested":
      return "requested";
    case "Active":
      return loan.past_due ? "pastdue" : "active";
    case "Overdue":
      return "overdue";
    case "Repaid":
      return "repaid";
    case "RepaidLate":
      return "repaidlate";
    case "Declined":
      return "declined";
    case "Cancelled":
      return "cancelled";
  }
}

export const LOAN_VIEW_LABEL: Record<LoanView, string> = {
  requested: "Asked",
  active: "Owing",
  pastdue: "Past due",
  overdue: "Overdue",
  repaid: "Paid on time",
  repaidlate: "Paid late",
  declined: "Declined",
  cancelled: "Cancelled",
};

/**
 * Short account label for tight spaces: "ana.testnet" → "ana", "ben.utang-game.testnet" → "ben"
 * (first label of a sub-account). The full name is shown in dialogs.
 */
export function shortName(accountId: string): string {
  const bare = accountId.replace(/\.(testnet|near)$/, "");
  return bare.includes(".") ? bare.split(".")[0] : bare;
}

export function isValidAccountId(id: string): boolean {
  return (
    id.length >= 2 &&
    id.length <= 64 &&
    /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/.test(id)
  );
}
