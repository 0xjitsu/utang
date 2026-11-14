import { useMemo, useState } from "react";
import { Avatar } from "../art/Avatar";
import { BadgeIcon, NavIcon } from "../art/icons";
import { Empty, Tabs } from "../components/ui";
import { useGame } from "../game/GameProvider";
import { bus } from "../game/bus";
import { fmtUtang } from "../near/format";
import type { Profile } from "../near/types";

type Board = "trust" | "barangay" | "lenders" | "ontime";

const BOARDS: Record<Board, { title: string; value: (p: Profile) => string; note: string }> = {
  trust: {
    title: "Most trusted",
    value: (p) => `${p.trust} trust · Lv ${p.level}`,
    note: "From the contract's leaderboard(): trust, then loans repaid on time.",
  },
  lenders: {
    title: "Best lenders",
    value: (p) => `${p.loans_made_repaid} repaid · limit ${fmtUtang(p.lending_limit)}`,
    note: "Loans they vouched for that came back on time (counted), then lending limit.",
  },
  barangay: {
    title: "My barangay",
    value: (p) => `${p.trust} trust · Lv ${p.level}`,
    note: "Most trusted players in your barangay.",
  },
  ontime: {
    title: "On-time payers",
    value: (p) => `${p.loans_repaid_on_time} on time · ${p.loans_repaid_late} late`,
    note: "Counted on-time repayments as a borrower.",
  },
};

export function Leaderboard() {
  const { leaderboard, players, accountId, me } = useGame();
  const [board, setBoard] = useState<Board>("trust");
  const ranked = useMemo(() => {
    if (board === "trust") return leaderboard;
    if (board === "barangay")
      return players
        .filter((p) => !!me?.barangay && p.barangay === me.barangay)
        .sort((a, b) => b.trust - a.trust || b.loans_repaid_on_time - a.loans_repaid_on_time || a.player_index - b.player_index)
        .slice(0, 20);
    const copy = [...players];
    if (board === "lenders")
      copy.sort(
        (a, b) =>
          b.loans_made_repaid - a.loans_made_repaid ||
          Number(BigInt(b.lending_limit) - BigInt(a.lending_limit)) ||
          a.player_index - b.player_index,
      );
    else copy.sort((a, b) => b.loans_repaid_on_time - a.loans_repaid_on_time || a.loans_repaid_late - b.loans_repaid_late || a.player_index - b.player_index);
    return copy.slice(0, 20);
  }, [board, leaderboard, players, me]);
  const cfg = BOARDS[board];
  const podium = ranked.slice(0, 3);

  return (
    <div className="screen">
      <div className="screen-title">
        <NavIcon id="leaderboard" size={34} />
        <div>
          <h1>Leaderboard</h1>
          <p className="muted">Trust can't be bought or transferred. It only moves when loans finish.</p>
        </div>
      </div>
      <Tabs<Board>
        value={board}
        onChange={setBoard}
        options={[
          { id: "trust", label: "Most trusted" },
          { id: "lenders", label: "Best lenders" },
          { id: "barangay", label: "My barangay" },
          { id: "ontime", label: "On time" },
        ]}
      />
      {ranked.length === 0 ? (
        <Empty>{board === "barangay" && !me?.barangay ? "Choose your barangay first (menu → Move to another barangay)." : "No players yet."}</Empty>
      ) : null}
      {podium.length ? (
        <div className="podium">
          {[1, 0, 2].map((i) =>
            podium[i] ? (
              <button
                key={podium[i].account_id}
                className={`podium-step step-${i + 1}`}
                onClick={() => bus.emit("open:profile", { accountId: podium[i].account_id })}
              >
                <Avatar name={podium[i].account_id} size={i === 0 ? 64 : 48} />
                <span className="acct small">{podium[i].account_id}</span>
                <span className="podium-block">{i + 1}</span>
              </button>
            ) : null,
          )}
        </div>
      ) : null}
      <ol className="rank-list">
        {ranked.map((p, i) => (
          <li key={p.account_id} className={p.account_id === accountId ? "rank-me" : ""}>
            <span className="rank-n">{i + 1}</span>
            <Avatar name={p.account_id} size={32} />
            <button className="name-link acct" onClick={() => bus.emit("open:profile", { accountId: p.account_id })}>
              {p.account_id}
            </button>
            <span className="rank-badges">
              {p.badges.slice(0, 3).map((b) => (
                <BadgeIcon key={b} id={b} size={14} />
              ))}
            </span>
            <span className="rank-val">{cfg.value(p)}</span>
          </li>
        ))}
      </ol>
      <p className="footnote">{cfg.note}</p>
    </div>
  );
}
