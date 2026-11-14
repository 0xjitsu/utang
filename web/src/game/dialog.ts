// Pure logic for the RPG-style visit dialog: what a neighbour says and which choices you get.
// Kept free of React so it can be unit-tested.

import { hash32 } from "../art/pixel";
import { fmtUtang, shortName } from "../near/format";
import { availableToLend, countBlocker, countsFrom, openLoanCount } from "../near/rules";
import { fmtRelative, fmtSpan } from "../near/format";
import type { Loan, PairCredit, Profile, Rules } from "../near/types";

export type ChoiceId =
  | "approve"
  | "decline"
  | "repay"
  | "ask"
  | "cancel"
  | "notebook"
  | "leave"
  | "mark_overdue"
  | "requests"
  | "debts";

export interface Choice {
  id: ChoiceId;
  label: string;
  kind: "good" | "primary" | "secondary" | "danger" | "ghost";
  disabled?: boolean;
  /** One line explaining why it's disabled. */
  reason?: string;
  /** One line shown under an enabled choice (e.g. "won't count yet"). */
  note?: string;
  loanId?: number;
}

export interface DialogCtx {
  accountId: string | null;
  me: Profile | null;
  otherId: string;
  other: Profile | null;
  myLoans: Loan[];
  rules: Rules | null;
  credit: PairCredit | null;
  /** Current contract time (ns); needed for "will this repayment count?" */
  now?: bigint;
}

const OPEN = new Set(["Requested", "Active", "Overdue"]);

function between(ctx: DialogCtx) {
  const me = ctx.accountId;
  const o = ctx.otherId;
  const theyAsked = ctx.myLoans.filter((l) => l.lender === me && l.borrower === o && l.status === "Requested");
  const iAsked = ctx.myLoans.filter((l) => l.borrower === me && l.lender === o && l.status === "Requested");
  const iOwe = ctx.myLoans.filter((l) => l.borrower === me && l.lender === o && (l.status === "Active" || l.status === "Overdue"));
  const theyOwe = ctx.myLoans.filter((l) => l.lender === me && l.borrower === o && (l.status === "Active" || l.status === "Overdue"));
  return { theyAsked, iAsked, iOwe, theyOwe };
}

const GREETINGS = [
  "Uy, kumusta! Need something from the tindahan?",
  "Magandang araw! How's business at your store?",
  "Ay, ikaw pala! Pasok, pasok.",
  "Kain na tayo? Just kidding. What can I do for you?",
  "Mainit ngayon, ano? Come in, come in.",
  "Oy! Long time no see, neighbour.",
];

const SPECIAL: Record<string, string> = {
  "aling-nena.testnet": "Uy, kumusta! Need something from the tindahan? Ask me for a small loan, anak.",
  "kuya-jun.testnet": "Ah... hello. Don't look at the listahan too closely, ha?",
};

/** What the neighbour says, depending on how things stand between you. */
export function npcLine(ctx: DialogCtx): string {
  const name = shortName(ctx.otherId);
  if (!ctx.other) return `${name} hasn't joined the barangay yet.`;
  if (!ctx.accountId) return "Hello, stranger! Pick an account so we can do business.";
  if (!ctx.me) return "Welcome! Join the barangay first (0.01 NEAR) so we can do business.";
  const { theyAsked, iAsked, iOwe, theyOwe } = between(ctx);
  const theyOweOverdue = theyOwe.find((l) => l.past_due);
  if (theyOweOverdue) return `Pasensya na... I know it's overdue. I'll pay the ${fmtUtang(theyOweOverdue.amount)} soon, promise.`;
  if (theyAsked[0]) {
    const l = theyAsked[0];
    return `Pa-utang po? ${fmtUtang(l.amount)} lang, for ${l.days} day${l.days === 1 ? "" : "s"}. I'll pay you back on time!`;
  }
  if (theyOwe[0]) return "Bayad ko 'to bukas, promise! Your coins are safe with me.";
  const iOweOverdue = iOwe.find((l) => l.past_due);
  if (iOweOverdue) return `Ay... bayad muna ha? That ${fmtUtang(iOweOverdue.amount)} is overdue.`;
  if (iOwe[0]) return `Kumusta! About that ${fmtUtang(iOwe[0].amount)}... no rush, just before the due date.`;
  if (iAsked[0]) return "I'm still thinking about your request. Sandali lang!";
  if (ctx.other.has_overdue) return "Pasensya na, I'm a bit behind on my own utang right now...";
  return SPECIAL[ctx.otherId] ?? GREETINGS[hash32(ctx.otherId) % GREETINGS.length];
}

/** The biggest loan you can ask this neighbour for right now, and why it's limited. */
export function askLimit(ctx: DialogCtx): { max: bigint; byCredit: boolean; free: bigint } {
  const rules = ctx.rules;
  if (!rules || !ctx.other) return { max: 0n, byCredit: false, free: 0n };
  const free = availableToLend(ctx.other);
  const credit = ctx.credit ? BigInt(ctx.credit.cap) : BigInt(rules.first_loan_cap ?? rules.max_loan);
  let max = BigInt(rules.max_loan);
  let byCredit = false;
  if (credit < max) {
    max = credit;
    byCredit = true;
  }
  if (free < max) {
    max = free;
    byCredit = false;
  }
  return { max, byCredit, free };
}

export interface AmountOption {
  amount: string;
  disabled: boolean;
  reason?: string;
}

/** The 5 / 10 / 20 chips, limited by pair credit and the lender's free limit. */
export function amountOptions(ctx: DialogCtx, presets = ["500", "1000", "2000"]): AmountOption[] {
  const { free } = askLimit(ctx);
  const credit = ctx.credit ? BigInt(ctx.credit.cap) : null;
  return presets.map((a) => {
    const v = BigInt(a);
    if (credit !== null && v > credit) return { amount: a, disabled: true, reason: `Credit between you is up to ${fmtUtang(credit)}` };
    if (v > free) return { amount: a, disabled: true, reason: `They can lend ${fmtUtang(free)} right now` };
    return { amount: a, disabled: false };
  });
}

/**
 * If the next repayment between you two (or any of yours) won't count because of a cooldown,
 * say when it will. Null when a repayment after a day would count normally.
 */
export function askCountNote(ctx: DialogCtx, now: bigint): string | null {
  const rules = ctx.rules;
  if (!rules || !ctx.accountId) return null;
  const day = BigInt(rules.day_ns);
  const me = ctx.accountId;
  const o = ctx.otherId;
  let pairUntil = 0n;
  let mineUntil = 0n;
  for (const l of ctx.myLoans) {
    if (!l.counted || !l.closed_at) continue;
    const closed = BigInt(l.closed_at);
    if ((l.lender === me && l.borrower === o) || (l.lender === o && l.borrower === me)) {
      const until = closed + BigInt(rules.pair_cooldown_days) * day;
      if (until > pairUntil) pairUntil = until;
    }
    if (l.borrower === me) {
      const until = closed + BigInt(rules.borrower_count_cooldown_days ?? 1) * day;
      if (until > mineUntil) mineUntil = until;
    }
  }
  // a new loan is at least bonus_min_age_days old before it can count anyway
  const earliest = now + BigInt(rules.bonus_min_age_days) * day;
  if (pairUntil > earliest) return `Next counted repayment with ${shortName(o)}: ${fmtRelative(pairUntil, now, rules)}. Repaying sooner just closes the loan.`;
  if (mineUntil > earliest) return `Your next counted repayment: ${fmtRelative(mineUntil, now, rules)}.`;
  return null;
}

/** Why you can't ask at all (null = you can). */
export function askBlocker(ctx: DialogCtx): string | null {
  if (!ctx.accountId) return "Pick an account first";
  if (!ctx.me) return "Join the barangay first";
  if (!ctx.other) return "They haven't joined yet";
  if (ctx.me.has_overdue) return "Bayad muna: repay your overdue loan first";
  const rules = ctx.rules;
  if (rules && openLoanCount(ctx.accountId, ctx.myLoans) >= rules.max_open_loans_per_borrower)
    return `You already have ${rules.max_open_loans_per_borrower} open loans`;
  const minLoan = rules ? BigInt(rules.min_loan) : 100n;
  if (availableToLend(ctx.other) < minLoan) return "They can't lend right now";
  return null;
}

/** Main choices (at most 4, "Leave" last) plus extra ones for the "More" row. */
export function npcChoices(ctx: DialogCtx): { primary: Choice[]; more: Choice[] } {
  const primary: Choice[] = [];
  const more: Choice[] = [];
  const leave: Choice = { id: "leave", label: "Leave", kind: "ghost" };
  if (!ctx.other || !ctx.accountId || !ctx.me) return { primary: [leave], more };
  const { theyAsked, iAsked, iOwe, theyOwe } = between(ctx);

  const req = theyAsked[0];
  if (req) {
    const free = availableToLend(ctx.me);
    const over = BigInt(req.amount) > free;
    primary.push({
      id: "approve",
      label: `Approve ${fmtUtang(req.amount)}`,
      kind: "good",
      loanId: req.id,
      disabled: over || ctx.other.has_overdue,
      reason: over
        ? `Over your lending limit (you can lend ${fmtUtang(free)})`
        : ctx.other.has_overdue
          ? "Bayad muna: they have an overdue loan"
          : undefined,
    });
    primary.push({ id: "decline", label: "Decline", kind: "secondary", loanId: req.id });
  }

  const debt = iOwe[0];
  if (debt) {
    const short = BigInt(ctx.me.balance) < BigInt(debt.amount);
    const reason = short ? `You need ${fmtUtang(BigInt(debt.amount) - BigInt(ctx.me.balance))} more $UTANG` : undefined;
    const rules = ctx.rules;
    const blocker = !debt.past_due && rules && ctx.now !== undefined ? countBlocker(debt, ctx.myLoans, rules, ctx.now) : null;
    if (debt.past_due) {
      primary.push({ id: "repay", label: `Repay (late) ${fmtUtang(debt.amount)}`, kind: "danger", loanId: debt.id, disabled: short, reason, note: `Clears it, +${rules?.trust_late_repay_borrower ?? 5} trust, no bonus` });
    } else if (blocker && rules && ctx.now !== undefined) {
      const from = countsFrom(debt, rules);
      const wait = blocker === "too_young" && from ? `wait ${fmtSpan(from - ctx.now, rules)}` : blocker === "pair_cooldown" ? "you two had a counted repayment this week" : "one counted repayment per day";
      primary.push({ id: "repay", label: "Repay now (won't earn trust yet)", kind: "secondary", loanId: debt.id, disabled: short, reason, note: `No trust or bonus: ${wait}` });
    } else {
      primary.push({ id: "repay", label: `Repay ${fmtUtang(debt.amount)} ★ counts`, kind: "good", loanId: debt.id, disabled: short, reason, note: rules ? `+${rules.trust_on_time_borrower} trust and a bonus` : undefined });
    }
  }

  if (iAsked[0]) {
    primary.push({ id: "cancel", label: "Cancel my request", kind: "secondary", loanId: iAsked[0].id });
  } else {
    const blocked = askBlocker(ctx);
    primary.push({ id: "ask", label: "Pa-utang po (ask)", kind: "primary", disabled: !!blocked, reason: blocked ?? undefined });
  }

  const pastDue = theyOwe.find((l) => l.status === "Active" && l.past_due);
  if (pastDue) more.push({ id: "mark_overdue", label: "Mark overdue", kind: "secondary", loanId: pastDue.id });

  const notebook: Choice = { id: "notebook", label: "See notebook", kind: "secondary" };
  const list = primary.slice(0, 3);
  if (list.length < 3) list.push(notebook);
  else more.unshift(notebook);
  list.push(leave);
  more.push(...primary.slice(3));
  return { primary: list, more };
}

/** Choices at your own store. */
export function storeChoices(ctx: { accountId: string | null; myLoans: Loan[] }): Choice[] {
  const me = ctx.accountId;
  const requests = ctx.myLoans.filter((l) => l.lender === me && l.status === "Requested").length;
  const debts = ctx.myLoans.filter((l) => l.borrower === me && OPEN.has(l.status) && l.status !== "Requested").length;
  return [
    { id: "requests", label: `At your window (${requests})`, kind: requests ? "good" : "secondary" },
    { id: "debts", label: `Your utang (${debts})`, kind: debts ? "primary" : "secondary" },
    { id: "leave", label: "Leave", kind: "ghost" },
  ];
}

export function storeLine(ctx: { accountId: string | null; myLoans: Loan[]; me: Profile | null }): string {
  if (!ctx.me) return "Your store is closed. Join the barangay to open it.";
  const me = ctx.accountId;
  const requests = ctx.myLoans.filter((l) => l.lender === me && l.status === "Requested").length;
  const overdue = ctx.myLoans.some((l) => l.borrower === me && l.past_due);
  if (overdue) return "Bayad muna! One of your loans is overdue. Repay it to open up again.";
  if (requests) return `${requests} neighbour${requests === 1 ? " is" : "s are"} waiting at your window.`;
  return "All quiet at the tindahan. Sweep the floor, count the sachets...";
}
