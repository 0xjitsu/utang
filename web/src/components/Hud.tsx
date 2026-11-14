// In-scene HUD: a React overlay on top of the street (or the simple SVG store).
import { Coin, Heart } from "../art/icons";
import { Sprite } from "../art/pixel";
import { useGame } from "../game/GameProvider";
import { bus } from "../game/bus";
import { fmtSpan, fmtSpanHint, fmtUtang, shortName } from "../near/format";
import { availableToLend, levelProgress } from "../near/rules";
import { QuestTracker } from "./Quest";

const BELL = [
  "....kk....",
  "...kyyk...",
  "..kyyyyk..",
  "..kyyyyk..",
  ".kyyyyyyk.",
  ".kyyyyyyk.",
  "kyyyyyyyyk",
  "kkkkkkkkkk",
  "....kk....",
];

export function Hud() {
  const { me, myLoans, accountId, rules, now, mode } = useGame();
  if (!me || !rules) {
    return mode === "preview" ? <span className="preview-pill">PREVIEW</span> : null;
  }
  const { frac, next } = levelProgress(me.trust, rules.level_step);
  const free = availableToLend(me);
  const limit = BigInt(me.lending_limit);
  const debts = myLoans
    .filter((l) => l.borrower === accountId && (l.status === "Active" || l.status === "Overdue"))
    .sort((a, b) => Number(BigInt(a.due_at ?? "0") - BigInt(b.due_at ?? "0")));
  const requests = myLoans.filter((l) => l.lender === accountId && l.status === "Requested").length;
  const owed = debts.reduce((s, l) => s + BigInt(l.amount), 0n);
  const overdueLoan = debts.find((l) => l.past_due);
  const first = debts[0];
  const dueText = first?.due_at
    ? first.past_due
      ? "overdue"
      : `due in ${fmtSpan(BigInt(first.due_at) - now, rules)}`
    : "";

  return (
    <div className="hud">
      <div className="hud-row">
        <div className="hud-card hud-me" aria-label={`${fmtUtang(me.balance)} UTANG, level ${me.level}, ${me.trust} trust`}>
          <span className="hud-coins">
            <Coin size={18} />
            {fmtUtang(me.balance)}
          </span>
          <span className="hud-level">
            Lv {me.level}
            <span className="hud-hearts" title={`${me.trust} trust · next level at ${next}`}>
              {Array.from({ length: 5 }, (_, i) => (
                <Heart key={i} size={11} empty={i >= Math.round(frac * 5)} />
              ))}
            </span>
          </span>
        </div>
        <div className="hud-right">
          <div className="hud-card hud-limit" aria-label={`Can lend ${fmtUtang(free)}`}>
            <span className="hud-label">Can lend {fmtUtang(free)}</span>
            <span className="hud-bar">
              <span style={{ width: `${limit > 0n ? Number((free * 100n) / limit) : 0}%` }} />
            </span>
          </div>
          <button
            className={`hud-btn hud-bell${requests ? " hud-bell-on" : ""}`}
            onClick={() => bus.emit("open:store", { view: "requests" })}
            aria-label={`${requests} neighbour${requests === 1 ? "" : "s"} at your window`}
          >
            <Sprite rows={BELL} palette={{ k: "#2b1d16", y: "#f2c14e" }} size={20} />
            {requests ? <span className="hud-count">{requests}</span> : null}
          </button>
        </div>
      </div>
      {me.has_overdue ? (
        // one compact strip while overdue: it replaces the owe chip and the quest card
        <div className="hud-bayad" role="alert">
          <span>
            <b>Bayad muna</b> · {overdueLoan ? `${fmtUtang(overdueLoan.amount)} to ${shortName(overdueLoan.lender)} is overdue` : "a loan is overdue"}
          </span>
          {overdueLoan ? (
            <button className="btn btn-small btn-danger" onClick={() => bus.emit("open:profile", { accountId: overdueLoan.lender })}>
              Repay now
            </button>
          ) : null}
        </div>
      ) : (
        <>
          {first ? (
            <button
              title={first.due_at ? fmtSpanHint(BigInt(first.due_at) - now, rules) : undefined}
              className={`hud-btn hud-pill${first.past_due ? " hud-pill-late" : ""}`}
              onClick={() =>
                debts.length === 1 ? bus.emit("open:profile", { accountId: first.lender }) : bus.emit("open:store", { view: "debts" })
              }
            >
              <span>
                You owe {fmtUtang(owed)} · {dueText}
              </span>
              <span className="hud-pill-go">{first.past_due ? "Repay ›" : "›"}</span>
            </button>
          ) : null}
          <QuestTracker />
        </>
      )}
      {mode === "preview" ? <span className="preview-pill">PREVIEW</span> : null}
    </div>
  );
}
