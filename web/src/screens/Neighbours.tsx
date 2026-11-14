import { useState } from "react";
import { Avatar } from "../art/Avatar";
import { BadgeIcon, NavIcon } from "../art/icons";
import { Button, Empty, Panel } from "../components/ui";
import { useGame } from "../game/GameProvider";
import { bus } from "../game/bus";
import { fmtUtang, shortName } from "../near/format";
import { availableToLend } from "../near/rules";

export function Neighbours() {
  const { players, accountId, myLoans } = useGame();
  const [q, setQ] = useState("");
  const { rules, me } = useGame();
  const [brgy, setBrgy] = useState<string>("all");
  const incoming = myLoans.filter((l) => l.lender === accountId && l.status === "Requested");
  const list = players.filter(
    (p) =>
      p.account_id.includes(q.trim().toLowerCase()) &&
      (brgy === "all" || (brgy === "none" ? !p.barangay : p.barangay === brgy)),
  );

  return (
    <div className="screen">
      <div className="screen-title">
        <NavIcon id="neighbours" size={34} />
        <div>
          <h1>Neighbours</h1>
          <p className="muted">Everyone on the street, by NEAR account name. Visit a store to ask for a loan.</p>
        </div>
      </div>

      {incoming.length ? (
        <Panel title={<>Requests to you <span className="count">{incoming.length}</span></>}>
          <div className="rpg-list">
            {incoming.map((l) => (
              <button key={l.id} className="rpg-row" onClick={() => bus.emit("open:profile", { accountId: l.borrower })}>
                <Avatar name={l.borrower} size={36} />
                <span className="rpg-row-text">
                  <b className="acct">{shortName(l.borrower)}</b> asks <b>{fmtUtang(l.amount)}</b> for {l.days} days
                </span>
                <span className="rpg-row-go">Talk ›</span>
              </button>
            ))}
          </div>
        </Panel>
      ) : null}

      <input
        className="input search"
        placeholder="Find a neighbour…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        aria-label="Search neighbours"
      />
      {rules?.barangays?.length ? (
        <select className="input select" value={brgy} onChange={(e) => setBrgy(e.target.value)} aria-label="Filter by barangay">
          <option value="all">All barangays</option>
          {me?.barangay ? <option value={me.barangay}>My barangay ({me.barangay})</option> : null}
          {rules.barangays.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
          <option value="none">Not chosen yet</option>
        </select>
      ) : null}
      {list.length === 0 ? <Empty>No neighbours found.</Empty> : null}
      <div className="neighbour-grid">
        {list.map((p) => {
          const isMe = p.account_id === accountId;
          const free = availableToLend(p);
          const canLend = free > 0n;
          return (
            <article key={p.account_id} className={`neighbour${isMe ? " neighbour-me" : ""}`}>
              <button className="neighbour-open" onClick={() => bus.emit("open:profile", { accountId: p.account_id })}>
                <Avatar name={p.account_id} size={56} />
                <div className="neighbour-info">
                  <strong className="acct">{isMe ? `${p.account_id} (you)` : p.account_id}</strong>
                  <span>
                    Lv {p.level} · {p.trust} trust
                  </span>
                  <span className="muted small">
                    {p.barangay ? `Brgy. ${p.barangay}` : "Barangay not chosen"}
                  </span>
                  <span className="muted small">{canLend ? `can lend ${fmtUtang(free)}` : "can't lend right now"}</span>
                  {p.has_overdue ? <span className="overdue-chip small">Overdue · bayad muna</span> : null}
                </div>
              </button>
              <div className="neighbour-foot">
                <span className="mini-badges">
                  {p.badges.slice(0, 4).map((b) => (
                    <BadgeIcon key={b} id={b} size={16} />
                  ))}
                </span>
                {!isMe ? (
                  <Button small kind="secondary" disabled={!canLend} onClick={() => canLend && bus.emit("open:ask", { lender: p.account_id })}>
                    {canLend ? "Ask" : "Can't lend"}
                  </Button>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
