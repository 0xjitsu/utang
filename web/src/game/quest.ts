// First-time quest: (0) choose a barangay, (1) ask a neighbour for 10.00, (2) wait a day,
// (3) repay on time → reward, then "Now try lending", then a "You're set!" card with next goals.
// Pure state derivation + a small persisted record per account.

import { shortName } from "../near/format";
import type { Loan, Profile, Rules } from "../near/types";

export type QuestStage = "barangay" | "ask" | "wait" | "repay" | "reward" | "lend" | "set" | "done";

export interface QuestSaved {
  loanId: number | null;
  dismissed: boolean;
  rewarded: boolean;
  finished: boolean;
  /** Loans with id <= this are ignored (earlier attempts, or loans before a restart). */
  ignoreUpTo: number;
  /** loans_made when the lending step began; lending counts only after that. */
  lendBase: number | null;
  /** The last attempt was repaid but didn't count: show the "ask again" tip. */
  retry: boolean;
}

export const NEW_QUEST: QuestSaved = {
  loanId: null,
  dismissed: false,
  rewarded: false,
  finished: false,
  ignoreUpTo: -1,
  lendBase: null,
  retry: false,
};

export interface QuestInput {
  accountId: string | null;
  me: Profile | null;
  myLoans: Loan[];
  target: string | null;
  /** The target's barangay, to tell the player where to find them. */
  targetBarangay?: string | null;
  /** The street the player is looking at right now (visited barangay, or their own). */
  currentBarangay?: string | null;
  rules: Rules | null;
  now: bigint;
  saved: QuestSaved;
}

export interface QuestView {
  stage: QuestStage;
  step: 0 | 1 | 2 | 3 | null;
  title: string;
  detail: string;
  target: string | null;
  loan: Loan | null;
  /** ns left until the loan is a day old (stage "wait"). */
  waitLeftNs: bigint | null;
  counted: boolean;
  /** The target lives in another barangay than the street you're on. */
  targetAway: boolean;
  targetBarangay: string | null;
  /** Next goals on the final card. */
  goals: string[];
  /** Where the street should point an arrow. */
  arrow: { kind: "house"; id: string } | { kind: "store" } | null;
}

const QUEST_STATUSES = new Set(["Requested", "Active", "Overdue", "Repaid", "RepaidLate"]);

/** Should the preview neighbours hold their loan requests to this player? (until "Now try lending") */
export function holdsRequests(stage: QuestStage): boolean {
  return stage !== "lend" && stage !== "set" && stage !== "done";
}

/** Derives the quest view from game state. Returns the (possibly updated) saved record too. */
export function questView(input: QuestInput): { view: QuestView; saved: QuestSaved } {
  const { accountId, me, myLoans, target, rules, now } = input;
  let saved: QuestSaved = { ...NEW_QUEST, ...input.saved };
  const base = {
    target,
    loan: null as Loan | null,
    waitLeftNs: null as bigint | null,
    counted: false,
    targetAway: false,
    targetBarangay: input.targetBarangay ?? null,
    goals: [] as string[],
    arrow: null as QuestView["arrow"],
  };
  const done = (): { view: QuestView; saved: QuestSaved } => ({
    view: { ...base, stage: "done", step: null, title: "", detail: "" },
    saved,
  });
  if (!accountId || !me || !target || !rules || saved.dismissed || saved.finished) return done();
  const name = shortName(target);
  const away = !!input.targetBarangay && (input.currentBarangay ?? me.barangay) !== input.targetBarangay;
  base.targetAway = away;
  const findThem = away
    ? `${name} lives in ${input.targetBarangay}. Ride the jeepney there from the Map, or tap "Go ask".`
    : `Walk to ${name}'s house and choose "Pa-utang po".`;

  if (saved.rewarded) {
    if (saved.lendBase === null) saved = { ...saved, lendBase: me.loans_made };
    if (me.loans_made > (saved.lendBase ?? 0)) {
      const step = rules.level_step;
      const next = (Math.floor(me.trust / step) + 1) * step;
      return {
        view: {
          ...base,
          stage: "set",
          step: null,
          title: "You're set!",
          detail: "You've borrowed, repaid on time and vouched for a neighbour. Keep going:",
          goals: [
            `Reach Level ${me.level + 1} (${me.trust} / ${next} trust)`,
            me.loans_made_repaid > 0
              ? `Good lender badge: ${me.loans_made_repaid} / 5 counted repayments as a lender`
              : "Get your first counted repayment as a lender",
          ],
        },
        saved,
      };
    }
    return {
      view: {
        ...base,
        stage: "lend",
        step: null,
        title: "Now try lending",
        detail: "Approve a neighbour at your window. You vouch for them, and you both gain trust when they repay.",
        arrow: { kind: "store" },
      },
      saved,
    };
  }

  if (me.barangay === null && rules.barangays?.length) {
    return {
      view: {
        ...base,
        stage: "barangay",
        step: 0,
        title: "Choose your barangay",
        detail: `Where's your tindahan? Pick one of Mandaluyong's 27 barangays. Only the barangay is stored, never an address.${
          input.targetBarangay ? ` Tip: ${name}, your first lender, is in ${input.targetBarangay}.` : ""
        }`,
      },
      saved,
    };
  }

  // The quest loan: the saved one, or the newest loan we asked the target for (after ignoreUpTo).
  const usable = (l: Loan) => l.id > saved.ignoreUpTo && QUEST_STATUSES.has(l.status);
  let loan = saved.loanId !== null ? myLoans.find((l) => l.id === saved.loanId && usable(l)) ?? null : null;
  if (!loan) loan = myLoans.find((l) => l.borrower === accountId && l.lender === target && usable(l)) ?? null;
  saved = { ...saved, loanId: loan ? loan.id : null, retry: loan ? false : saved.retry };

  // Repaid but it didn't count (too early or late): loop back to step 1.
  if (loan && (loan.status === "RepaidLate" || (loan.status === "Repaid" && !loan.counted))) {
    saved = { ...saved, ignoreUpTo: Math.max(saved.ignoreUpTo, loan.id), loanId: null, retry: true };
    loan = null;
  }
  base.loan = loan;
  base.counted = !!loan?.counted;

  if (!loan) {
    return {
      view: {
        ...base,
        stage: "ask",
        step: 1,
        title: saved.retry ? "That didn't count yet. Ask again" : `Visit ${name} and ask for 10.00`,
        detail: saved.retry
          ? `Repaid, but too soon to earn trust. Ask ${name} again and wait a full day before repaying. ${away ? findThem : ""}`.trim()
          : findThem,
        arrow: away ? null : { kind: "house", id: target },
      },
      saved,
    };
  }

  if (loan.status === "Requested") {
    return {
      view: { ...base, stage: "wait", step: 2, title: "Wait for a yes", detail: `${name} is deciding on your request...` },
      saved,
    };
  }

  if (loan.status === "Active" || loan.status === "Overdue") {
    const day = BigInt(rules.day_ns) * BigInt(rules.bonus_min_age_days);
    const readyAt = BigInt(loan.approved_at ?? "0") + day;
    if (loan.status === "Active" && !loan.past_due && now < readyAt) {
      return {
        view: {
          ...base,
          stage: "wait",
          step: 2,
          title: "Wait one day",
          detail: "A repayment only counts for trust once the loan is a day old. Repaying sooner just closes it.",
          waitLeftNs: readyAt - now,
        },
        saved,
      };
    }
    return {
      view: {
        ...base,
        stage: "repay",
        step: 3,
        title: loan.past_due ? "Repay now (it's late)" : "Repay on time to earn trust",
        detail: loan.past_due
          ? "It went past the due date. Paying late still clears it, with a little trust back."
          : away
            ? `${name} lives in ${input.targetBarangay}. Ride the jeepney there, or tap "Go repay".`
            : `Visit ${name} again and choose "Repay".`,
        arrow: away ? null : { kind: "house", id: target },
      },
      saved,
    };
  }

  // Repaid on time and counted: show the reward once.
  return {
    view: {
      ...base,
      stage: "reward",
      step: 3,
      title: "Quest complete!",
      detail: `+${rules.trust_on_time_borrower} trust, a bonus, and your first badge.`,
    },
    saved,
  };
}

/** A fresh quest that ignores everything that happened before now. */
export function restartedQuest(myLoans: Loan[]): QuestSaved {
  const maxId = myLoans.reduce((m, l) => Math.max(m, l.id), -1);
  return { ...NEW_QUEST, ignoreUpTo: maxId };
}

// ------------------------------------------------------------------ persistence

const key = (accountId: string) => `utang-quest:v2:${accountId}`;

export function loadQuest(accountId: string | null): QuestSaved {
  if (!accountId) return { ...NEW_QUEST };
  try {
    const raw = globalThis.localStorage?.getItem(key(accountId));
    if (raw) return { ...NEW_QUEST, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return { ...NEW_QUEST };
}

export function saveQuest(accountId: string | null, saved: QuestSaved) {
  if (!accountId) return;
  try {
    globalThis.localStorage?.setItem(key(accountId), JSON.stringify(saved));
  } catch {
    /* ignore */
  }
}

/** The neighbour the quest sends you to: Aling Nena in preview, else the first other player. */
export function questTarget(mode: "preview" | "live", accountId: string | null, players: Profile[], previewLender: string): string | null {
  const others = players.filter((p) => p.account_id !== accountId);
  if (mode === "preview" && others.some((p) => p.account_id === previewLender)) return previewLender;
  return others[0]?.account_id ?? null;
}
