// Live economy stats (from stats()) and the 60-day simulation (from /sim/<scenario>.json).
import { useEffect, useState } from "react";
import { Coin, NavIcon } from "../art/icons";
import { LineChart } from "../components/LineChart";
import { Panel, Tabs } from "../components/ui";
import { useGame } from "../game/GameProvider";
import { fmtUtang, fmtUtangShort } from "../near/format";

export const SCENARIOS = ["honest", "deadbeats", "collapse", "sybil", "pool_stress"] as const;
type Scenario = (typeof SCENARIOS)[number];
const SCENARIO_LABEL: Record<Scenario, string> = {
  honest: "Honest",
  deadbeats: "Deadbeats",
  collapse: "Collapse",
  sybil: "Sybil farm",
  pool_stress: "Pool stress",
};

export interface SimDay {
  day: number;
  total_supply: number;
  outstanding: number;
  overdue_outstanding: number;
  bonus_minted: number;
  bonus_pool_left: number;
  trust_index_bps: number;
  active_loans: number;
  players_with_overdue: number;
  avg_trust: number;
  [k: string]: number;
}

export interface SimFile {
  scenario: string;
  description: string;
  params?: unknown;
  days: SimDay[];
  summary?: Record<string, unknown>;
  placeholder?: boolean;
}

// Validated categorical palette on the cream chart surface (see report).
const C1 = "#0a8a9e";
const C2 = "#7b4fa8";
const C3 = "#d0562c";

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 === 0 ? 0 : 1)}%`;
const count = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1));

export function Economy() {
  const { stats, rules, mode } = useGame();
  const [scenario, setScenario] = useState<Scenario>("honest");
  const [sims, setSims] = useState<Partial<Record<Scenario, SimFile | "missing">>>({});

  useEffect(() => {
    if (sims[scenario]) return;
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}sim/${scenario}.json`, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: SimFile) => {
        if (!cancelled) setSims((s) => ({ ...s, [scenario]: Array.isArray(j?.days) ? j : "missing" }));
      })
      .catch(() => !cancelled && setSims((s) => ({ ...s, [scenario]: "missing" })));
    return () => {
      cancelled = true;
    };
  }, [scenario, sims]);

  const sim = sims[scenario];
  const matured =
    !!stats &&
    BigInt(stats.total_repaid_on_time) + BigInt(stats.total_repaid_late) + BigInt(stats.overdue_outstanding) > 0n;
  const poolCap = rules ? Number(rules.bonus_pool_cap) : 10_000_000;

  return (
    <div className="screen">
      <div className="screen-title">
        <NavIcon id="economy" size={34} />
        <div>
          <h1>Economy</h1>
          <p className="muted">How much does the street trust each other? Read live from {mode === "preview" ? "the preview neighbourhood" : "the contract"}.</p>
        </div>
      </div>

      {stats ? (
        <Panel className="econ-live">
          <div className="hero-stat">
            <span className="label">Trust index</span>
            <span className="hero-num">{matured ? pct(stats.trust_index_bps) : "—"}</span>
            <p className="muted small">
              {matured
                ? "Share of all lent $UTANG that came back on time: on-time ÷ (on-time + late + still overdue)."
                : "No loan has finished yet. The trust index appears once the first loan is repaid or goes overdue."}
            </p>
            {matured ? (
              <div className="index-bar" aria-hidden>
                <div style={{ width: `${stats.trust_index_bps / 100}%` }} />
              </div>
            ) : null}
          </div>
          <dl className="tiles">
            <div>
              <dt>Owed right now</dt>
              <dd>{fmtUtang(stats.outstanding)}</dd>
            </div>
            <div>
              <dt>Of which overdue</dt>
              <dd className={BigInt(stats.overdue_outstanding) > 0n ? "warn-text" : ""}>{fmtUtang(stats.overdue_outstanding)}</dd>
            </div>
            <div>
              <dt>Repaid on time</dt>
              <dd>{fmtUtang(stats.total_repaid_on_time)}</dd>
            </div>
            <div>
              <dt>Repaid late</dt>
              <dd>{fmtUtang(stats.total_repaid_late)}</dd>
            </div>
            <div>
              <dt>Lent, all time</dt>
              <dd>{fmtUtang(stats.total_lent)}</dd>
            </div>
            <div>
              <dt>Players</dt>
              <dd>{stats.players}</dd>
            </div>
            <div>
              <dt>Active loans</dt>
              <dd>{stats.active_loans}</dd>
            </div>
            <div>
              <dt>Waiting requests</dt>
              <dd>{stats.requested_loans}</dd>
            </div>
          </dl>
          <div className="pool">
            <span className="label">
              <Coin size={14} /> Bonus pool left: <b>{fmtUtang(stats.bonus_pool_left)}</b> of {rules ? fmtUtang(rules.bonus_pool_cap) : "100,000.00"}
            </span>
            <div className="index-bar pool-bar" aria-hidden>
              <div style={{ width: `${(Number(stats.bonus_pool_left) / poolCap) * 100}%` }} />
            </div>
          </div>
          <p className="muted small supply-note">
            Supply: <b>{fmtUtang(stats.total_supply)}</b> $UTANG. Supply only measures debt still outstanding plus bonuses ever paid
            ({fmtUtang(stats.outstanding)} + {fmtUtang(stats.bonus_minted)}). Coins are minted by loans and burned by repayments.
          </p>
        </Panel>
      ) : null}

      <Panel
        title="60-day simulation"
        right={sim && sim !== "missing" && sim.placeholder ? <span className="tag tag-warn">PLACEHOLDER DATA</span> : null}
      >
        <p className="muted small">
          Before fixing the numbers, the neighbourhood was simulated for 60 days under several scenarios. Amounts in $UTANG.
        </p>
        <Tabs<Scenario> value={scenario} onChange={setScenario} options={SCENARIOS.map((s) => ({ id: s, label: SCENARIO_LABEL[s] }))} />
        {!sim ? <p className="muted">Loading…</p> : null}
        {sim === "missing" ? (
          <p className="empty">
            No simulation output for “{scenario}” yet. Run <code>python3 sim/simulate.py</code> then <code>npm run sync-sim</code>.
          </p>
        ) : null}
        {sim && sim !== "missing" ? <SimCharts sim={sim} /> : null}
      </Panel>
    </div>
  );
}

function SimCharts({ sim }: { sim: SimFile }) {
  const d = sim.days;
  const days = d.map((x) => x.day);
  const col = (k: string) => d.map((x) => Number(x[k] ?? 0));
  const markers: { day: number; label: string }[] = [];
  const poolEmpty = sim.summary?.bonus_pool_empty_day;
  if (typeof poolEmpty === "number") markers.push({ day: poolEmpty, label: "pool empty" });
  if (sim.scenario === "collapse") markers.push({ day: 30, label: "repayment drops" });

  return (
    <div className="sim">
      <p className="sim-desc">{sim.description}</p>
      {sim.placeholder ? <p className="hint warn-text">Placeholder numbers: run the simulation and `npm run sync-sim`.</p> : null}
      <div className="chart-grid">
        <LineChart
          title="Trust index"
          subtitle="share of lent coins repaid on time"
          days={days}
          series={[{ key: "ti", label: "Trust index", color: C1, values: col("trust_index_bps") }]}
          format={pct}
          yMax={10000}
          markers={markers}
        />
        <LineChart
          title="Debt and supply"
          subtitle="$UTANG"
          days={days}
          series={[
            { key: "supply", label: "Supply", color: C1, values: col("total_supply") },
            { key: "out", label: "Owed", color: C2, values: col("outstanding") },
            { key: "od", label: "Overdue", color: C3, values: col("overdue_outstanding") },
          ]}
          format={fmtUtangShort}
          markers={markers}
        />
        <LineChart
          title="Bonus pool used"
          subtitle="$UTANG paid as bonuses, of a 100,000 cap"
          days={days}
          series={[{ key: "pool", label: "Pool used", color: C2, values: col("bonus_minted") }]}
          format={fmtUtangShort}
          markers={markers}
        />
        <LineChart
          title="Loans and overdue players"
          subtitle="count"
          days={days}
          series={[
            { key: "active", label: "Active loans", color: C1, values: col("active_loans") },
            { key: "pwo", label: "Players overdue", color: C3, values: col("players_with_overdue") },
          ]}
          format={count}
        />
      </div>
      {sim.summary ? <SimSummary summary={sim.summary} /> : null}
    </div>
  );
}

const AMOUNT_KEY = /(supply|outstanding|lent|repaid_on_time|repaid_late|bonus_minted|bonus_pool_left|frozen|balance|extracted|profit|cost_utang|bonus_farmed|farm_bonus|farm_volume|stolen)/;

function fmtSummaryValue(key: string, v: unknown): string {
  if (v === null || v === undefined) return "never";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v !== "number") return String(v);
  if (key.endsWith("_bps")) return pct(v);
  if (/share|ratio|rate/.test(key) && v <= 1) return `${(v * 100).toFixed(1)}%`;
  if (key.endsWith("_near")) return `${v} NEAR`;
  if (AMOUNT_KEY.test(key) && Number.isInteger(v)) return fmtUtang(BigInt(v));
  return Number.isInteger(v) ? v.toLocaleString() : v.toFixed(2);
}

const HIGHLIGHTS = [
  "final_trust_index_bps",
  "min_trust_index_bps",
  "total_lent",
  "final_total_supply",
  "peak_total_supply",
  "final_overdue_outstanding",
  "bonus_minted",
  "bonus_pool_empty_day",
  "loans_marked_overdue",
  "final_players_with_overdue",
];

function label(key: string) {
  return key.replace(/_bps$/, "").replace(/_/g, " ");
}

function flatten(obj: Record<string, unknown>, prefix = ""): [string, unknown][] {
  const out: [string, unknown][] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v && typeof v === "object" && !Array.isArray(v)) out.push(...flatten(v as Record<string, unknown>, `${prefix}${k}.`));
    else if (!Array.isArray(v)) out.push([`${prefix}${k}`, v]);
  }
  return out;
}

function SimSummary({ summary }: { summary: Record<string, unknown> }) {
  const highlights = HIGHLIGHTS.filter((k) => k in summary);
  const all = flatten(summary).filter(([k]) => k !== "scenario" && !k.startsWith("rules."));
  const attacker = summary.attacker && typeof summary.attacker === "object" ? (summary.attacker as Record<string, unknown>) : null;
  const attackerKeys = ["accounts", "bonus_farmed", "bonus_farmed_share_of_all_bonus", "total_cost_near_estimate", "best_honest_leaderboard_rank", "accounts_needed_to_empty_pool_in_60_days"].filter(
    (k) => attacker && k in attacker,
  );
  return (
    <div className="sim-summary">
      <dl className="tiles">
        {highlights.map((k) => (
          <div key={k}>
            <dt>{label(k)}</dt>
            <dd>{fmtSummaryValue(k, summary[k])}</dd>
          </div>
        ))}
      </dl>
      {attacker && attackerKeys.length ? (
        <>
          <h4 className="sub">The attacker</h4>
          <dl className="tiles">
            {attackerKeys.map((k) => (
              <div key={k}>
                <dt>{label(k)}</dt>
                <dd>{fmtSummaryValue(k, attacker[k])}</dd>
              </div>
            ))}
          </dl>
        </>
      ) : null}
      <details>
        <summary>All summary numbers</summary>
        <table className="kv">
          <tbody>
            {all.map(([k, v]) => (
              <tr key={k}>
                <th>{label(k)}</th>
                <td>{fmtSummaryValue(k.split(".").pop() ?? k, v)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}
