// One loan, with the actions that make sense for the viewer.
import { Avatar } from "../art/Avatar";
import { useGame } from "../game/GameProvider";
import { bus } from "../game/bus";
import { fmtRelative, fmtSpan, fmtSpanHint, fmtUtang, loanView, LOAN_VIEW_LABEL } from "../near/format";
import { availableToLend, BLOCKER_TEXT, countBlocker, countsFrom } from "../near/rules";
import type { Loan, Profile } from "../near/types";
import { Amount, Button } from "./ui";

export function StatusStamp({ loan }: { loan: Loan }) {
  const v = loanView(loan);
  return (
    <span className={`stamp stamp-${v}`} title={loan.status}>
      {LOAN_VIEW_LABEL[v]}
      {v === "repaid" ? <span className="stamp-sub">{loan.counted ? "counted" : "not counted"}</span> : null}
    </span>
  );
}

export function NameLink({ id }: { id: string }) {
  const { accountId } = useGame();
  if (id === accountId) return <b className="you">you</b>;
  return (
    <button className="name-link" onClick={() => bus.emit("open:profile", { accountId: id })} title={id}>
      {id === accountId ? "you" : id}
    </button>
  );
}

/** Timing line for a loan, in game days relative to rules().day_ns. */
export function LoanTiming({ loan }: { loan: Loan }) {
  const { rules, now } = useGame();
  if (!rules) return null;
  const v = loanView(loan);
  if (v === "requested") return <span className="muted">for {loan.days} days · asked {fmtRelative(loan.requested_at, now, rules)}</span>;
  if (v === "active" && loan.due_at)
    return <span title={fmtSpanHint(BigInt(loan.due_at) - now, rules)}>due {fmtRelative(loan.due_at, now, rules)}</span>;
  if ((v === "pastdue" || v === "overdue") && loan.due_at)
    return <span className="warn-text">was due {fmtRelative(loan.due_at, now, rules)}</span>;
  if (loan.closed_at && loan.approved_at && (v === "repaid" || v === "repaidlate")) {
    const held = BigInt(loan.closed_at) - BigInt(loan.approved_at);
    return (
      <span className="muted">
        closed {fmtRelative(loan.closed_at, now, rules)} · held {fmtSpan(held, rules)}
      </span>
    );
  }
  if (loan.closed_at) return <span className="muted">closed {fmtRelative(loan.closed_at, now, rules)}</span>;
  return null;
}

export function LoanActions({ loan, playersById }: { loan: Loan; playersById: Map<string, Profile> }) {
  const { accountId, me, myLoans, rules, now, actions } = useGame();
  if (!accountId || !rules) return null;
  const v = loanView(loan);
  const iAmLender = loan.lender === accountId;
  const iAmBorrower = loan.borrower === accountId;
  const out: JSX.Element[] = [];
  let hint: string | null = null;

  if (v === "requested" && iAmLender && me) {
    const free = availableToLend(me);
    const borrower = playersById.get(loan.borrower);
    const overLimit = BigInt(loan.amount) > free;
    const borrowerOverdue = !!borrower?.has_overdue;
    out.push(
      <Button
        key="approve"
        kind="good"
        small
        disabled={overLimit || borrowerOverdue}
        onClick={() => actions.approve(loan.id)}
        title="Mint the loan to them; you vouch for it"
      >
        Approve
      </Button>,
      <Button key="decline" kind="secondary" small onClick={() => actions.decline(loan.id)}>
        Decline
      </Button>,
    );
    if (overLimit) hint = `Over your lending limit: you can lend ${fmtUtang(free)} right now.`;
    else if (borrowerOverdue) hint = "Bayad muna: they have an overdue loan and must repay first.";
  }
  if (v === "requested" && iAmBorrower) {
    out.push(
      <Button key="cancel" kind="secondary" small onClick={() => actions.cancel(loan.id)}>
        Cancel request
      </Button>,
    );
  }
  if ((v === "active" || v === "pastdue" || v === "overdue") && iAmBorrower && me) {
    const short = BigInt(me.balance) < BigInt(loan.amount);
    const late = v !== "active";
    out.push(
      <Button key="repay" kind={late ? "danger" : "primary"} small disabled={short} onClick={() => actions.repay(loan.id)}>
        {late ? "Repay (late)" : "Repay"} {fmtUtang(loan.amount)}
      </Button>,
    );
    if (short) hint = `You need ${fmtUtang(BigInt(loan.amount) - BigInt(me.balance))} more $UTANG to repay. Neighbours can send you coins.`;
    else if (late) hint = "Paid late: clears the debt and lifts Bayad muna, +5 trust, no bonus.";
    else {
      const blocker = countBlocker(loan, myLoans, rules, now);
      if (blocker === "too_young") {
        const from = countsFrom(loan, rules);
        hint = `Repay after ${from ? fmtRelative(from, now, rules).replace(/^in /, "") : "a day"} for it to count (trust and bonus). Repaying now just closes the loan.`;
      } else if (blocker) hint = BLOCKER_TEXT[blocker];
    }
  }
  if (v === "pastdue") {
    out.push(
      <Button
        key="mark"
        kind="ghost"
        small
        onClick={() => actions.markOverdue(loan.id)}
        title="Anyone can record a loan that is past its due date"
      >
        Mark overdue
      </Button>,
    );
  }
  if (!out.length) return null;
  return (
    <div className="loan-actions">
      <div className="btn-row">{out}</div>
      {hint ? <p className="hint">{hint}</p> : null}
    </div>
  );
}

export function LoanCard({ loan, playersById, perspective }: { loan: Loan; playersById: Map<string, Profile>; perspective?: string | null }) {
  const other = perspective === loan.lender ? loan.borrower : perspective === loan.borrower ? loan.lender : loan.borrower;
  const v = loanView(loan);
  const closed = v === "repaid" || v === "repaidlate" || v === "declined" || v === "cancelled";
  return (
    <article className={`loan-card loan-${v}`}>
      <Avatar name={other} size={40} />
      <div className="loan-main">
        <div className="loan-line">
          <NameLink id={loan.borrower} />
          <span className="muted">{v === "requested" ? " asks " : closed ? " borrowed from " : " owes "}</span>
          <NameLink id={loan.lender} />
        </div>
        <div className="loan-line">
          <Amount value={loan.amount} />
          <LoanTiming loan={loan} />
          {BigInt(loan.bonus_paid) > 0n ? <span className="bonus-tag">+{fmtUtang(loan.bonus_paid)} bonus</span> : null}
        </div>
        <LoanActions loan={loan} playersById={playersById} />
      </div>
      <StatusStamp loan={loan} />
    </article>
  );
}
