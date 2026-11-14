// The shared notebook: compact rows, filters, search and pages. Tap a row for details.
import { useEffect, useMemo, useState } from "react";
import { NotebookIcon } from "../art/icons";
import { LoanActions, LoanTiming, NameLink, StatusStamp } from "../components/LoanCard";
import { Button } from "../components/ui";
import { useGame } from "../game/GameProvider";
import { fmtUtang, loanView, shortName } from "../near/format";
import type { Loan } from "../near/types";

export type ListFilter = "all" | "mine" | "open" | "overdue" | "closed";
export const PAGE_SIZE = 15;

export function filterLoans(loans: Loan[], filter: ListFilter, query: string, me: string | null): Loan[] {
  const q = query.trim().toLowerCase();
  return loans.filter((l) => {
    if (q && !l.lender.includes(q) && !l.borrower.includes(q)) return false;
    const v = loanView(l);
    switch (filter) {
      case "mine":
        return !!me && (l.lender === me || l.borrower === me);
      case "open":
        return v === "requested" || v === "active" || v === "pastdue";
      case "overdue":
        return l.past_due;
      case "closed":
        return v === "repaid" || v === "repaidlate" || v === "declined" || v === "cancelled";
      default:
        return true;
    }
  });
}

const FILTERS: { id: ListFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "mine", label: "Mine" },
  { id: "open", label: "Open" },
  { id: "overdue", label: "Overdue" },
  { id: "closed", label: "Closed" },
];

/** "you owe aling-nena", "kuya-jun owes you", "ben asked ana" — words instead of arrows. */
export function sentence(l: Loan, me: string | null): string {
  const n = (id: string) => (id === me ? "you" : shortName(id));
  const v = loanView(l);
  const b = n(l.borrower);
  const lend = n(l.lender);
  const owe = b === "you" ? "owe" : "owes";
  switch (v) {
    case "requested":
      return `${b} asked ${lend}`;
    case "active":
    case "pastdue":
    case "overdue":
      return `${b} ${owe} ${lend}`;
    case "repaid":
    case "repaidlate":
      return `${b} paid back ${lend}`;
    case "declined":
      return `${lend} declined ${b === "you" ? "your" : `${b}'s`} ask`;
    case "cancelled":
      return `${b} cancelled ${b === "you" ? "your" : "the"} ask to ${lend}`;
  }
}

export function Listahan() {
  const { listahan, listahanDone, players, accountId, actions } = useGame();
  const [filter, setFilter] = useState<ListFilter>("all");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<number | null>(null);
  const playersById = useMemo(() => new Map(players.map((p) => [p.account_id, p])), [players]);
  const rows = useMemo(() => filterLoans(listahan, filter, query, accountId), [listahan, filter, query, accountId]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  useEffect(() => setPage(0), [filter, query]);
  const shown = rows.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE);
  const lastPage = page >= pages - 1;

  return (
    <div className="screen">
      <div className="screen-title">
        <NotebookIcon size={30} />
        <div>
          <h1>Listahan</h1>
          <p className="muted">Every loan on the street: who owes whom, and how it ended.</p>
        </div>
      </div>
      <div className="list-tools">
        <div className="chip-row" role="tablist" aria-label="Filter">
          {FILTERS.map((f) => (
            <button key={f.id} role="tab" aria-selected={filter === f.id} className={`chip${filter === f.id ? " chip-on" : ""}`} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <input className="input search" placeholder="Search a name…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search by name" />
      </div>

      <div className="notebook">
        <div className="notebook-spiral" aria-hidden />
        <ol className="notebook-page">
          {shown.length === 0 ? <li className="empty">Walang nakasulat. Nothing written here.</li> : null}
          {shown.map((l) => {
            const v = loanView(l);
            const isOpen = open === l.id;
            return (
              <li key={l.id} className={`lrow lrow-${v}${isOpen ? " lrow-open" : ""}`}>
                <button className="lrow-main" onClick={() => setOpen(isOpen ? null : l.id)} aria-expanded={isOpen}>
                  <span className="lrow-id">{l.id}</span>
                  <span className="lrow-who">{sentence(l, accountId)}</span>
                  <span className="lrow-amt">{fmtUtang(l.amount)}</span>
                  <StatusStamp loan={l} />
                </button>
                {isOpen ? (
                  <div className="lrow-detail">
                    <p>
                      <NameLink id={l.borrower} /> {v === "requested" ? "asked" : "borrowed from"} <NameLink id={l.lender} /> for {l.days} day
                      {l.days === 1 ? "" : "s"}.
                    </p>
                    <p>
                      <LoanTiming loan={l} />
                    </p>
                    {l.status === "Repaid" ? (
                      <p className={l.counted ? "counted-tag" : "muted"}>
                        {l.counted ? "Counted: earned trust and the bonus." : "Not counted: repaid too soon or within a cooldown."}
                      </p>
                    ) : null}
                    {BigInt(l.bonus_paid) > 0n ? <p className="counted-tag">Bonus paid: {fmtUtang(l.bonus_paid)}</p> : null}
                    <LoanActions loan={l} playersById={playersById} />
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>
      <div className="pager">
        <Button small kind="secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ‹ Newer
        </Button>
        <span className="pager-info">
          Page {page + 1} / {pages} · {rows.length} loan{rows.length === 1 ? "" : "s"}
        </span>
        {lastPage && !listahanDone ? (
          <Button small kind="secondary" onClick={() => actions.loadMoreListahan()}>
            Load older ›
          </Button>
        ) : (
          <Button small kind="secondary" disabled={lastPage} onClick={() => setPage(page + 1)}>
            Older ›
          </Button>
        )}
      </div>
    </div>
  );
}
