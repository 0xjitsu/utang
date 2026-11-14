// RPG-style bottom dialog used for every visit: neighbours' houses, visitors at your window,
// and your own store. Portrait on the left, a typed-out line, and a few big choices.
import { useEffect, useMemo, useRef, useState } from "react";
import { Avatar } from "../art/Avatar";
import { BADGES, BadgeIcon } from "../art/icons";
import { useGame } from "../game/GameProvider";
import { bus } from "../game/bus";
import { amountOptions, askBlocker, askCountNote, npcChoices, npcLine, storeChoices, storeLine, type Choice, type DialogCtx } from "../game/dialog";
import { fmtRealDuration, fmtRelative, fmtSpan, fmtUtang, loanView, LOAN_VIEW_LABEL, parseUtang, shortName } from "../near/format";
import { pairCreditFromLoans } from "../near/rules";
import type { Loan, PairCredit } from "../near/types";
import { reducedMotion } from "../street/viewPref";
import { Amount, Button, TrustMeter } from "./ui";
import { useFocusTrap } from "./useFocusTrap";

export type DialogStep = "main" | "ask" | "notebook" | "requests" | "debts";
export interface DialogTarget {
  who: string; // account id or "store"
  step?: DialogStep;
}

// ------------------------------------------------------------------ typewriter

function useTypewriter(text: string) {
  const instant = reducedMotion();
  const [n, setN] = useState(instant ? text.length : 0);
  useEffect(() => {
    if (instant) {
      setN(text.length);
      return;
    }
    setN(0);
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i % 2 === 0 && text[i] && text[i] !== " ") bus.emit("sfx", { name: "blip" });
      if (i >= text.length) clearInterval(timer);
    }, 24);
    return () => clearInterval(timer);
  }, [text, instant]);
  return { shown: text.slice(0, n), done: n >= text.length, skip: () => setN(text.length) };
}

function usePairCredit(other: string): PairCredit | null {
  const { accountId, myLoans, rules, actions } = useGame();
  const estimate = useMemo(
    () => (accountId && rules?.first_loan_cap ? pairCreditFromLoans(accountId, other, myLoans, rules) : null),
    [accountId, other, myLoans, rules],
  );
  const [fromChain, setFromChain] = useState<PairCredit | null>(null);
  useEffect(() => {
    let live = true;
    if (accountId && rules?.first_loan_cap && other !== "store") void actions.pairCredit(other).then((c) => live && setFromChain(c));
    return () => {
      live = false;
    };
  }, [accountId, other, myLoans, rules, actions]);
  return fromChain ?? estimate;
}

// ------------------------------------------------------------------ dialog shell

export function GameDialog({ target, onTarget, onClose }: { target: DialogTarget; onTarget: (t: DialogTarget) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bus.emit("sfx", { name: "open" });
    return () => bus.emit("sfx", { name: "close" });
  }, []);
  useFocusTrap(ref, onClose, `${target.who}|${target.step ?? "main"}`);
  return (
    <div className="rpg-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="rpg" role="dialog" aria-modal="true" aria-label="Visit" tabIndex={-1} ref={ref}>
        {target.who === "store" ? (
          <StoreDialog step={target.step ?? "main"} onTarget={onTarget} onClose={onClose} />
        ) : (
          <NeighbourDialog key={target.who} who={target.who} step={target.step ?? "main"} onTarget={onTarget} onClose={onClose} />
        )}
      </div>
    </div>
  );
}

function Speaker({ id, title, line, level, trust }: { id: string; title: string; line: string; level?: number; trust?: number }) {
  const { rules } = useGame();
  const { shown, done, skip } = useTypewriter(line);
  return (
    <div className="rpg-top">
      <div className="rpg-portrait">
        <Avatar name={id} size={88} />
      </div>
      <div className="rpg-speech">
        <div className="rpg-name">
          <span className="acct">{title}</span>
          {level !== undefined ? <span className="rpg-lv">Lv {level}</span> : null}
        </div>
        {trust !== undefined && rules ? <TrustMeter trust={trust} step={rules.level_step} /> : null}
        <p className="rpg-line" onClick={skip} aria-live="polite" aria-label={line}>
          {shown}
          {!done ? <span className="caret">▌</span> : null}
        </p>
      </div>
    </div>
  );
}

function ChoiceButtons({ choices, onChoose }: { choices: Choice[]; onChoose: (c: Choice) => void }) {
  const { busy } = useGame();
  return (
    <div className="choices">
      {choices.map((c) => (
        <div key={c.id + (c.loanId ?? "")} className="choice-cell">
          <button className={`choice choice-${c.kind}`} disabled={c.disabled || !!busy} onClick={() => onChoose(c)}>
            {c.label}
          </button>
          {c.disabled && c.reason ? <span className="choice-why">{c.reason}</span> : c.note ? <span className="choice-note">{c.note}</span> : null}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ neighbour

function NeighbourDialog({ who, step, onTarget, onClose }: { who: string; step: DialogStep; onTarget: (t: DialogTarget) => void; onClose: () => void }) {
  const g = useGame();
  const other = g.players.find((p) => p.account_id === who) ?? null;
  const credit = usePairCredit(who);
  const ctx: DialogCtx = { accountId: g.accountId, me: g.me, otherId: who, other, myLoans: g.myLoans, rules: g.rules, credit, now: g.now };
  const line = npcLine(ctx);
  const { primary, more } = npcChoices(ctx);
  const title = who === g.accountId ? "You" : who;

  const choose = async (c: Choice) => {
    const a = g.actions;
    switch (c.id) {
      case "ask":
        return onTarget({ who, step: "ask" });
      case "notebook":
        return onTarget({ who, step: "notebook" });
      case "leave":
        return onClose();
      case "approve":
        return void a.approve(c.loanId!);
      case "decline":
        return void a.decline(c.loanId!);
      case "repay":
        return void a.repay(c.loanId!);
      case "cancel":
        return void a.cancel(c.loanId!);
      case "mark_overdue":
        return void a.markOverdue(c.loanId!);
    }
  };

  return (
    <>
      <Speaker id={who} title={title} line={step === "ask" ? askLine(ctx) : line} level={other?.level} trust={other?.trust} />
      {step === "main" ? (
        <>
          <ChoiceButtons choices={primary} onChoose={choose} />
          {other ? <AboutThem who={who} /> : null}
          {other && g.me && who !== g.accountId ? (
            <details className="rpg-more">
              <summary>More</summary>
              {more.length ? <ChoiceButtons choices={more} onChoose={choose} /> : null}
              <SendCoins to={who} />
            </details>
          ) : null}
        </>
      ) : null}
      {step === "ask" ? <AskStep ctx={ctx} onDone={() => onTarget({ who, step: "main" })} /> : null}
      {step === "notebook" ? <Notebook who={who} onBack={() => onTarget({ who, step: "main" })} /> : null}
    </>
  );
}

function askLine(ctx: DialogCtx): string {
  const blocked = askBlocker(ctx);
  if (blocked) return blocked === "They can't lend right now" ? "Pasensya na, I can't lend right now. My limit is all used up." : blocked + ".";
  const max = maxOf(ctx);
  return max > 0n ? `How much do you need? I can do up to ${fmtUtang(max)} for you.` : "Pasensya na, I can't lend that much right now.";
}

function maxOf(ctx: DialogCtx): bigint {
  const opts = amountOptions(ctx);
  const ok = opts.filter((o) => !o.disabled).map((o) => BigInt(o.amount));
  return ok.length ? ok[ok.length - 1] : 0n;
}

function AskStep({ ctx, onDone }: { ctx: DialogCtx; onDone: () => void }) {
  const g = useGame();
  const rules = g.rules!;
  const opts = amountOptions(ctx);
  const firstOk = [...opts].reverse().find((o) => !o.disabled && BigInt(o.amount) <= 1000n) ?? opts.find((o) => !o.disabled);
  const [amount, setAmount] = useState<string | null>(firstOk?.amount ?? null);
  const [days, setDays] = useState(3);
  const blocked = askBlocker(ctx);
  const dayNs = BigInt(rules.day_ns);
  const minAge = rules.bonus_min_age_days;
  const selected = opts.find((o) => o.amount === amount);
  const reason = blocked ?? (opts.every((o) => o.disabled) ? opts[0].reason ?? null : null);

  return (
    <div className="ask-step">
      <div className="chip-row" role="radiogroup" aria-label="Amount">
        {opts.map((o) => (
          <button
            key={o.amount}
            role="radio"
            aria-checked={amount === o.amount}
            className={`chip chip-big${amount === o.amount ? " chip-on" : ""}`}
            disabled={o.disabled}
            title={o.reason}
            onClick={() => setAmount(o.amount)}
          >
            {fmtUtang(o.amount).replace(".00", "")}
          </button>
        ))}
      </div>
      <div className="stepper" aria-label="Days">
        <button className="step-btn" onClick={() => setDays(Math.max(rules.min_days, days - 1))} aria-label="Fewer days" disabled={days <= rules.min_days}>
          −
        </button>
        <span className="step-val">
          {days} day{days === 1 ? "" : "s"}
          {rules.demo_time ? <small> · {fmtRealDuration(BigInt(days) * dayNs)} real time</small> : null}
        </span>
        <button className="step-btn" onClick={() => setDays(Math.min(rules.max_days, days + 1))} aria-label="More days" disabled={days >= rules.max_days}>
          +
        </button>
      </div>
      <p className="hint-line">
        {reason ??
          askCountNote(ctx, g.now) ??
          `Repay after ${fmtSpan(BigInt(minAge) * dayNs, rules)} to earn +${rules.trust_on_time_borrower} trust.`}
      </p>
      <HowItCounts />
      <div className="btn-row">
        <Button
          disabled={!!blocked || !amount || !!selected?.disabled}
          onClick={async () => {
            if (!amount) return;
            const r = await g.actions.ask(ctx.otherId, amount, days);
            if (r !== false) onDone();
          }}
        >
          Ask for {amount ? fmtUtang(amount) : "…"}
        </Button>
        <Button kind="ghost" onClick={onDone}>
          Back
        </Button>
      </div>
    </div>
  );
}

function HowItCounts() {
  const { rules } = useGame();
  if (!rules) return null;
  return (
    <details className="how">
      <summary>ⓘ How it counts</summary>
      <ul>
        <li>An on-time repayment counts when the loan is at least {rules.bonus_min_age_days} day old.</li>
        <li>
          Counted: +{rules.trust_on_time_borrower} trust for the borrower, +{rules.trust_on_time_lender} for the lender, the lender's limit
          grows, and a bonus of up to {fmtUtang((BigInt(rules.bonus_base_cap ?? "1000") * BigInt(rules.bonus_bps)) / 10000n)} is shared.
        </li>
        <li>One counted repayment per pair per {rules.pair_cooldown_days} days, and one per borrower per day.</li>
        <li>Credit between two neighbours starts at {fmtUtang(rules.first_loan_cap ?? "1000")} and grows with each counted repayment.</li>
        <li>Miss the due date and it's overdue: bayad muna until you repay (−{-rules.trust_overdue_borrower} trust).</li>
      </ul>
    </details>
  );
}

function AboutThem({ who }: { who: string }) {
  const { players } = useGame();
  const p = players.find((x) => x.account_id === who);
  if (!p) return null;
  return (
    <details className="about">
      <summary>About them</summary>
      <dl className="about-grid">
        <div>
          <dt>Coins</dt>
          <dd>
            <Amount value={p.balance} />
          </dd>
        </div>
        <div>
          <dt>Can lend</dt>
          <dd>{fmtUtang(BigInt(p.lending_limit) - BigInt(p.lent_out) > 0n ? BigInt(p.lending_limit) - BigInt(p.lent_out) : 0n)}</dd>
        </div>
        <div>
          <dt>On time</dt>
          <dd>{p.loans_repaid_on_time}</dd>
        </div>
        <div>
          <dt>Overdue</dt>
          <dd>{p.loans_overdue}</dd>
        </div>
      </dl>
      <p className="hint-line">{p.barangay ? `Lives in Brgy. ${p.barangay}.` : "Hasn't chosen a barangay yet."}</p>
      {p.badges.length ? (
        <div className="badge-row">
          {p.badges.map((b) => (
            <span key={b} className="badge" title={BADGES[b]?.rule}>
              <BadgeIcon id={b} size={20} />
              {BADGES[b]?.label ?? b}
            </span>
          ))}
        </div>
      ) : null}
    </details>
  );
}

function Notebook({ who, onBack }: { who: string; onBack: () => void }) {
  const { myLoans, accountId } = useGame();
  const rows = myLoans.filter((l) => l.lender === who || l.borrower === who);
  return (
    <div className="mini-notebook">
      {rows.length === 0 ? <p className="muted">Walang nakasulat. Nothing between you two yet.</p> : null}
      {rows.slice(0, 12).map((l) => (
        <NotebookRow key={l.id} loan={l} me={accountId} />
      ))}
      <div className="btn-row">
        <Button kind="ghost" onClick={onBack}>
          Back
        </Button>
        <Button kind="secondary" onClick={() => bus.emit("open:screen", { screen: "listahan" })}>
          Open the listahan
        </Button>
      </div>
    </div>
  );
}

function NotebookRow({ loan, me }: { loan: Loan; me: string | null }) {
  const v = loanView(loan);
  const who = (id: string) => (id === me ? "you" : shortName(id));
  return (
    <div className={`nb-row nb-${v}`}>
      <span className="nb-id">#{loan.id}</span>
      <span className="nb-who">
        {who(loan.borrower)} ← {who(loan.lender)}
      </span>
      <span className="nb-amt">{fmtUtang(loan.amount)}</span>
      <span className={`stamp stamp-${v}`}>{LOAN_VIEW_LABEL[v]}</span>
    </div>
  );
}

function SendCoins({ to }: { to: string }) {
  const { me, actions } = useGame();
  const [val, setVal] = useState("");
  if (!me) return null;
  const amt = parseUtang(val);
  const bad = !amt || BigInt(amt) <= 0n || BigInt(amt) > BigInt(me.balance);
  if (me.has_overdue) return <p className="hint-line">Bayad muna: you can't send $UTANG while you have an overdue loan.</p>;
  return (
    <div className="send-row">
      <input className="input" inputMode="decimal" placeholder="1.00" value={val} onChange={(e) => setVal(e.target.value)} aria-label="Amount to send" />
      <Button small kind="secondary" disabled={bad} onClick={() => amt && actions.transfer(to, amt).then((ok) => ok && setVal(""))}>
        Send coins
      </Button>
    </div>
  );
}

// ------------------------------------------------------------------ your own store

function StoreDialog({ step, onTarget, onClose }: { step: DialogStep; onTarget: (t: DialogTarget) => void; onClose: () => void }) {
  const g = useGame();
  const me = g.accountId;
  const requests = g.myLoans.filter((l) => l.lender === me && l.status === "Requested");
  const debts = g.myLoans.filter((l) => l.borrower === me && (l.status === "Active" || l.status === "Overdue"));
  const line =
    step === "requests"
      ? requests.length
        ? "Who's at the window? Tap someone to talk to them."
        : "Nobody at the window right now."
      : step === "debts"
        ? debts.length
          ? "Your utang. Pay on time and the barangay trusts you more."
          : "You owe nothing. Malinis ang listahan!"
        : storeLine({ accountId: me, myLoans: g.myLoans, me: g.me });
  return (
    <>
      <Speaker id={me ?? "bisita.guest"} title="Your sari-sari store" line={line} level={g.me?.level} trust={g.me?.trust} />
      {step === "main" ? (
        <ChoiceButtons
          choices={storeChoices({ accountId: me, myLoans: g.myLoans })}
          onChoose={(c) => (c.id === "leave" ? onClose() : onTarget({ who: "store", step: c.id as DialogStep }))}
        />
      ) : null}
      {step === "requests" ? (
        <div className="rpg-list">
          {requests.map((l) => (
            <button key={l.id} className="rpg-row" onClick={() => onTarget({ who: l.borrower })}>
              <Avatar name={l.borrower} size={36} />
              <span className="rpg-row-text">
                <b className="acct">{shortName(l.borrower)}</b> asks <b>{fmtUtang(l.amount)}</b> for {l.days}d
              </span>
              <span className="rpg-row-go">Talk ›</span>
            </button>
          ))}
          <Button kind="ghost" onClick={() => onTarget({ who: "store" })}>
            Back
          </Button>
        </div>
      ) : null}
      {step === "debts" ? (
        <div className="rpg-list">
          {debts.map((l) => (
            <div key={l.id} className="rpg-row">
              <Avatar name={l.lender} size={36} />
              <span className="rpg-row-text">
                <b>{fmtUtang(l.amount)}</b> to <b className="acct">{shortName(l.lender)}</b>
                <br />
                <small className={l.past_due ? "warn-text" : "muted"}>
                  {l.due_at && g.rules ? (l.past_due ? "overdue, was due " : "due ") + fmtRelative(l.due_at, g.now, g.rules) : ""}
                </small>
              </span>
              <button className="choice choice-primary choice-inline" onClick={() => onTarget({ who: l.lender })}>
                Repay ›
              </button>
            </div>
          ))}
          <Button kind="ghost" onClick={() => onTarget({ who: "store" })}>
            Back
          </Button>
        </div>
      ) : null}
    </>
  );
}
