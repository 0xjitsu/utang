// First-time quest: provider (state + persistence), HUD tracker, and the reward pop-up.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Coin } from "../art/icons";
import { useGame } from "../game/GameProvider";
import { bus } from "../game/bus";
import { holdsRequests, loadQuest, questTarget, questView, restartedQuest, saveQuest, type QuestSaved, type QuestView } from "../game/quest";
import { useVisiting } from "../game/location";
import { fmtSpan, fmtSpanHint } from "../near/format";
import { QUEST_LENDER } from "../near/mock/world";
import { Button } from "./ui";

interface QuestCtx {
  view: QuestView;
  dismiss(): void;
  restart(): void;
  ackReward(): void;
  finish(): void;
}

const Ctx = createContext<QuestCtx | null>(null);

export function QuestProvider({ children }: { children: ReactNode }) {
  const { accountId, me, myLoans, players, rules, now, mode, preview } = useGame();
  const [visiting] = useVisiting();
  const [saved, setSaved] = useState<QuestSaved>(() => loadQuest(accountId));
  const savedFor = useRef(accountId);
  if (savedFor.current !== accountId) {
    savedFor.current = accountId;
    // switching accounts: load that account's progress synchronously
    const s = loadQuest(accountId);
    if (JSON.stringify(s) !== JSON.stringify(saved)) setSaved(s);
  }
  const target = useMemo(() => questTarget(mode, accountId, players, QUEST_LENDER), [mode, accountId, players]);
  const targetBarangay = useMemo(() => players.find((p) => p.account_id === target)?.barangay ?? null, [players, target]);
  const { view, saved: next } = useMemo(
    () =>
      questView({ accountId, me, myLoans, target, targetBarangay, currentBarangay: visiting ?? me?.barangay ?? null, rules, now, saved }),
    [accountId, me, myLoans, target, targetBarangay, visiting, rules, now, saved],
  );
  useEffect(() => {
    if (JSON.stringify(next) !== JSON.stringify(saved)) {
      setSaved(next);
      saveQuest(accountId, next);
    }
  }, [next, saved, accountId]);

  // Preview: neighbours hold their loan requests to a newcomer until "Now try lending".
  useEffect(() => {
    if (preview && accountId) preview.world.setHoldRequests(accountId, holdsRequests(view.stage));
  }, [preview, accountId, view.stage]);

  const rewardFired = useRef<number | null>(null);
  useEffect(() => {
    if (view.stage === "reward" && view.loan && rewardFired.current !== view.loan.id) {
      rewardFired.current = view.loan.id;
      bus.emit("quest:complete", { counted: view.counted });
    }
  }, [view.stage, view.loan, view.counted]);

  const update = useCallback(
    (s: QuestSaved) => {
      setSaved(s);
      saveQuest(accountId, s);
    },
    [accountId],
  );
  const value: QuestCtx = {
    view,
    dismiss: () => update({ ...saved, dismissed: true }),
    restart: () => {
      rewardFired.current = null;
      update(restartedQuest(myLoans));
    },
    ackReward: () => update({ ...next, rewarded: true }),
    finish: () => update({ ...next, finished: true }),
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useQuest(): QuestCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useQuest outside QuestProvider");
  return c;
}

/** Tracker in the HUD. Opens when the step changes, then folds to one line (and always while a dialog is open). */
export function QuestTracker({ compact = false }: { compact?: boolean }) {
  const { view, dismiss, finish } = useQuest();
  const { rules, mode, actions } = useGame();
  const stageKey = `${view.stage}|${view.title}`;
  const [open, setOpen] = useState(true);
  useEffect(() => {
    // open briefly on each new step (folded straight away while something urgent, like overdue, is shown)
    setOpen(!compact);
    if (compact) return;
    const t = setTimeout(() => setOpen(false), 4000);
    return () => clearTimeout(t);
  }, [stageKey, compact]);
  if (view.stage === "done" || view.stage === "reward") return null;
  const wait = view.waitLeftNs !== null && rules ? fmtSpan(view.waitLeftNs, rules) : null;
  const tag = view.step === 0 ? "Start" : view.step ? `Quest ${view.step}/3` : view.stage === "set" ? "Done" : "Next";
  const goTarget = () => {
    if (!view.target) return;
    if (view.stage === "ask") bus.emit("open:ask", { lender: view.target });
    else bus.emit("open:profile", { accountId: view.target });
  };
  return (
    <div className={`quest${open ? "" : " quest-min"}`}>
      <button className="quest-head hud-btn" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="quest-tag">{tag}</span>
        <span className="quest-title">{view.title}</span>
        <span className="quest-caret" aria-hidden>
          {open ? "▾" : "▸"}
        </span>
      </button>
      {open ? (
        <div className="quest-body">
          <p>{view.detail}</p>
          {view.goals.length ? (
            <ul className="quest-goals">
              {view.goals.map((g) => (
                <li key={g}>{g}</li>
              ))}
            </ul>
          ) : null}
          {wait ? (
            <p className="quest-wait" title={rules && view.waitLeftNs !== null ? fmtSpanHint(view.waitLeftNs, rules) : undefined}>
              ⏳ {wait} left
            </p>
          ) : null}
          <div className="quest-actions">
            {view.stage === "barangay" ? (
              <Button small onClick={() => bus.emit("open:picker", {})}>
                Choose barangay
              </Button>
            ) : null}
            {(view.stage === "ask" || view.stage === "repay") && view.targetAway && view.targetBarangay ? (
              <Button small onClick={() => bus.emit("travel", { barangay: view.targetBarangay })}>
                Ride to {view.targetBarangay}
              </Button>
            ) : null}
            {view.stage === "ask" || view.stage === "repay" ? (
              <Button small kind={view.targetAway ? "secondary" : "primary"} onClick={goTarget}>
                {view.stage === "ask" ? "Go ask" : "Go repay"}
              </Button>
            ) : null}
            {view.stage === "wait" && mode === "preview" && view.waitLeftNs !== null ? (
              <Button small kind="secondary" onClick={() => actions.previewSkipDays(1)}>
                Skip 1 day ⏩
              </Button>
            ) : null}
            {view.stage === "lend" ? (
              <Button small onClick={() => bus.emit("open:store", { view: "requests" })}>
                Open window
              </Button>
            ) : null}
            {view.stage === "set" ? (
              <Button small onClick={finish}>
                Got it
              </Button>
            ) : (
              <button className="link-btn" onClick={dismiss}>
                Hide guide
              </button>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** "Quest complete!" pop-up with the reward. */
export function QuestReward() {
  const { view, ackReward } = useQuest();
  const { rules } = useGame();
  const btn = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (view.stage === "reward") btn.current?.focus();
  }, [view.stage]);
  if (view.stage !== "reward") return null;
  return (
    <div className="reward-backdrop" role="dialog" aria-label="Quest complete">
      <div className="reward-card">
        <Coin size={48} spin />
        <h2>{view.title}</h2>
        {view.counted ? <div className="reward-big">+{rules?.trust_on_time_borrower ?? 10} TRUST</div> : null}
        <p>{view.detail}</p>
        <button ref={btn} className="btn" onClick={ackReward}>
          Salamat! Next
        </button>
      </div>
    </div>
  );
}
