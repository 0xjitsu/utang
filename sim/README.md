# $UTANG 60-day simulation

```bash
cd sim && python3 simulate.py            # all scenarios + before/after + rule comparison, ~35 s
python3 simulate.py honest sybil         # just some scenarios (skips summary and before/after files)
```

Python 3 standard library only. Deterministic: each scenario has a fixed seed, and the JSON output is byte-identical between runs.

Output in `sim/output/`:

- `<scenario>.json`: `{scenario, description, params, days[], summary}`. Each day row has `day, total_supply, outstanding, overdue_outstanding, bonus_minted, bonus_pool_left, trust_index_bps, active_loans, players_with_overdue, avg_trust, loans_approved_today, loans_repaid_today, loans_overdue_today` plus a few extras (`loans_repaid_late_today, total_lent, frozen_balance, players_walked_away`, and attacker fields in `sybil`). Amounts are integer centavos (`1000` = 10.00 UTANG). Day rows are taken at the end of each day.
- `summary.json`: every scenario's `summary`. `summary.honest` is the non-attacker players only. Also `rules`, `counted_repayments`, `uncounted_on_time_repayments`, `trust_distribution` (players per level and trust percentiles, honest vs attacker) and `leaderboard_top10`.
- `players` (top-level, scenarios with at most 200 players): final per-player state (trust, level, limit, balance, loan counts, counted repayments, bonus, `kind` honest/attacker).
- `before_after.json`: `sybil` and `pool_stress` (at 2,000 players) under the original rules (`before`, v1) and the final rules (`after`, v2), same behaviour and seeds, with daily series. `after` is the official rules (C). `sybil` also has `after_naive_attacker` (no pair priming) and `what_if_pair_history_cap` (kept for compatibility; now the same as `after`). `rule_comparison` reruns the sybil scenario under the original rules and four v2 variants — A: no pair cap; B: cap lifts fully after one counted repayment (the previous rule); **C: pair cap = 10.00 × (1 + counted repayments in the pair), the adopted rule (`"adopted": true`)**; D: C + a pair's first counted repayment gives no limit growth (A, B, D are NOT in INTERFACE.md) — each against the best of 7 attacker strategies (no priming, or priming a new lender a day / re-priming 5 fixed lenders, from day 2, 8 or 15), plus the honest cost: median limit in the 40-player honest run and in a 2,000-player pool_stress, and the share of on-time repayments that counted.
- `summary.md`: results table, sybil attacker, before vs after, findings and suggested rule changes.

## How it works

- **Contract model.** `Contract` in `simulate.py` follows `docs/INTERFACE.md` exactly: limits start at 10.00 and halve on overdue (floor 1.00); terms 2–30 days (1–30 in the original v1 rules); max 5 open loans per borrower. An on-time repayment **counts** only if the loan is at least 1 day old, the unordered pair had no counted repayment in 7 days and the borrower had none in the last day; only counted repayments give trust +10/+5, limit growth by the amount (max 1,000.00) and a bonus of 10% of min(amount, 10.00), split 50/50 (odd centavo to the borrower) while the 100,000.00 pool lasts. Cooldowns start only on a counted repayment (an empty pool still records them), the borrower cooldown only looks at repayments as borrower, and boundaries are inclusive (age ≥ 1 day, now ≥ last + cooldown). An `ask` is rejected if the amount is over the pair credit: `first_loan_cap` (10.00) × (1 + counted repayments between the unordered pair). Profile counters `loans_repaid_on_time` / `loans_made_repaid` move only on counted repayments; global `total_repaid_on_time` and the trust index include every on-time repayment. Trust −20/−10 when overdue, +5/+2 on late repay, never below 0; a borrower with a past-due loan cannot `ask` or `ft_transfer`; late `repay` applies the overdue penalty first if nobody had called `mark_overdue`. Agents can only act through these methods.
- **Time.** Event-driven with 1-minute resolution (a day is 1440 minutes), so the 24 h bonus age and the 7-day cooldown are exact.
- **Original rules.** `Contract(rules="v1")` keeps the first spec (every on-time repayment earns trust and limit growth; 10% bonus on the full amount if 1 day old and the pair had no bonus in 7 days). Used only for `before_after.json`.
- **Invariants**, asserted at the end of every day: balances, supply, trust and pool never negative; sum of balances = supply = outstanding + bonus minted; supply ≤ outstanding + 100,000.00; each player's `lent_out` / `borrowed_out` match their open loans; limits within [1.00, 1,000.00]; ≤ 5 open loans per borrower. At the end of each run every loan is audited: bonus only on counted loans, at most 1.00 each, sum of bonuses = bonus minted, no counted repayment younger than 1 day, no borrower counted twice within 1 day, no pair twice within 7 days.

## Behaviour assumptions (per agent, see `BASE_BEHAVIOUR` in the code)

Every agent pays the 0.01 NEAR join deposit and runs a store.

| Behaviour | Assumption |
|---|---|
| Asking | Once a day, with an agent-specific chance of 15–45% (halved if already owing). Only if not past due and fewer than 2 open loans of their own. |
| Amount / term | 5, 10, 20, 50, 100 UTANG (35/35/20/7/3%), capped by what the chosen lender has free and by the pair credit (10.00 × (1 + counted repayments with that lender)). Terms 2/3/7/14/30 days (minimum 2 under the official rules) (5/20/40/25/10%). |
| Whom to ask | Past lenders who were repaid on time (weight +3 each) plus 12 random neighbours; 15% of asks go to a random candidate. Skips lenders with no free limit, lenders who declined them in the last 3 days (lower weight) and players who walked away. |
| Approving | Answer within 0.2–12 h. Chance = 0.45 + trust/200 (max +0.35) + 0.08 per past on-time loan with this lender (max 3) − 0.15 per lifetime overdue (max 3) ± a personal 0.1. Almost never (2%) to someone who went overdue on them. After being burned once, ×0.6 for strangers. The contract can still refuse (limit, past due). |
| Spending | Borrowed coins: 50–100% spent at 1–2 neighbours' stores within 12 h. Daily: 30–70% of coins not set aside for repayments. Stores are picked by popularity; 35% of purchases go to neighbours who are short of coins with a loan due within 3 days (they are selling to raise cash); stores of past-due players are skipped 80% of the time. |
| Repaying | Each approved loan gets a fate from the scenario's on-time rate. On time: try at 35–100% of the term but not before the loan is 1 day old (we assume the game tells players a repayment counts only after 24 h), retry every 3 h until due; if still short within 24 h of due, ask another lender for the shortfall (7 days). Missed due for lack of coins → keep trying every 6 h (late). Late fate: try 1–10 days after due, then every 6 h. Of loans not on time, 60% are late and 40% never repaid. |
| Never repaying | Spends everything before the due date, then walks away once past due: store closes, ignores requests, never repays any other loan. |
| `mark_overdue` | Someone notices 0–24 h after the due date. |

## Scenarios

| Scenario | Setup |
|---|---|
| `honest` | 40 agents, 95% of loans on time. |
| `deadbeats` | 40 agents; 25% of them repay on time 10% of the time, the rest 90% (70% on average per person). |
| `collapse` | 40 agents; 95% on time for loans due before day 30, 40% for loans due on day 30 or later. |
| `sybil` | `honest` community + one attacker with 50 accounts playing the best strategy we found for the current rules: a ring where every account borrows exactly once a day (the borrower cooldown) from the account k places ahead and repays exactly 24 h later; k cycles 1..24 so no unordered pair repeats within 7 days. Loans are as large as the lender's free limit and the pair credit allow (10.00 for new pairs, which also earns the full 1.00 bonus). It keeps going after the pool is empty because counted repayments still give trust. Days 2–35 (the best of 7 strategies under the official rules): each of 45 "runner" accounts picks 5 honest lenders and once a day borrows 10.00 from one of them, repaying exactly 24 h later and re-priming each lender whenever the 7-day pair cooldown allows, so each pair's credit climbs 10.00 per counted repayment (runners skip the ring as borrowers meanwhile, since they get one counted repayment a day). From day 36 the runners ask each lender for as much as the pair credit and the lender's free limit allow (7-day terms), move each loan to one of 5 clean accounts and never repay. (Under v1 rules the attacker instead pumps limits with same-minute loops on day 1 and farms loans repaid after 24 h on fresh pairs; v1 still allows 1-day terms; priming works the same way.) Attacker accounts never lend to or buy from honest players. Gas is estimated at an assumed 0.0005 NEAR per call. |
| `pool_stress` | 10,000 very active agents (asking 60–95% of days, up to 4 open loans, 10–500 UTANG on 2–7 day terms, 95% on time) to show the pool running out and supply staying bounded. |

## Known simplifications

- Defaults are drawn independently per loan, so in a big, very active community many players eventually hit one "never" loan and walk away; real defaulters are more concentrated.
- Honest players don't spot sybils except through the approval rule above.
- No coin price, no trading off-platform, no new players joining mid-way.
