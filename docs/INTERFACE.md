# $UTANG contract interface (shared spec for contract, sim and web)

The README is the product spec. This file pins the exact data shapes so `contract/`, `sim/` and `web/` agree.

## Units

- Token: name `Utang`, symbol `UTANG`, **decimals 2**. All amounts on the wire are **U128 as JSON strings in centavos**: `"1000"` = 10.00 UTANG.
- Timestamps: **nanoseconds**, U64 as **JSON strings** (`"1794635152735562000"`).
- Durations: one "day" = `DAY_NS`.
  - Normal build: `DAY_NS = 86_400_000_000_000` (24 h).
  - Demo build (`cargo near build -- --features demo-time` or equivalent): `DAY_NS = 60_000_000_000` (1 minute). Every rule expressed in days scales with it. `rules().demo_time` is `true` in that build.

## Constants (returned by `rules()`)

```json
{
  "demo_time": false,
  "day_ns": "86400000000000",
  "join_deposit": "10000000000000000000000",      // 0.01 NEAR in yoctoNEAR
  "starting_limit": "1000",                      // 10.00
  "max_limit": "100000",                         // 1,000.00
  "min_limit": "100",                            // 1.00 (floor after halving)
  "min_loan": "100",                             // 1.00
  "max_loan": "100000",                          // 1,000.00
  "min_days": 2,                                 // 2, not 1: a repayment only counts once the loan is 1 day old, so a 1-day loan could never count
  "max_days": 30,
  "max_open_loans_per_borrower": 5,              // requested + active
  "first_loan_cap": "1000",                      // pair credit step: a pair may borrow at most first_loan_cap × (1 + counted repayments between them)
  "bonus_bps": 1000,                             // 10% total, split 50/50
  "bonus_base_cap": "1000",                      // bonus is computed on at most 10.00 of a loan → max 1.00 per loan
  "bonus_pool_cap": "10000000",                  // 100,000.00
  "bonus_min_age_days": 1,                       // minimum loan age for a repayment to COUNT (see below)
  "pair_cooldown_days": 7,                       // one counted repayment per unordered pair per 7 days
  "borrower_count_cooldown_days": 1,             // a borrower gets at most one counted repayment per day
  "trust_on_time_borrower": 10,
  "trust_on_time_lender": 5,
  "trust_overdue_borrower": -20,
  "trust_overdue_lender": -10,
  "trust_late_repay_borrower": 5,
  "trust_late_repay_lender": 2,
  "level_step": 50,
  "barangays": ["Addition Hills", "Bagong Silang", "Barangka Drive", "Barangka Ibaba", "Barangka Ilaya",
    "Barangka Itaas", "Buayang Bato", "Burol", "Daang Bakal", "Hagdang Bato Itaas", "Hagdang Bato Libis",
    "Harapin ang Bukas", "Highway Hills", "Hulo", "Mabini-J. Rizal", "Malamig", "Mauway", "Namayan",
    "New Zañiga", "Old Zañiga", "Pag-asa", "Plainview", "Pleasant Hills", "Poblacion", "San Jose",
    "Vergara", "Wack-Wack Greenhills"]   // the 27 barangays of Mandaluyong City (names as in OpenStreetMap)
}
```

## Types

```ts
type LoanStatus = "Requested" | "Active" | "Overdue" | "Repaid" | "RepaidLate" | "Declined" | "Cancelled";

interface Loan {
  id: number;                 // u64, sequential from 0 (safe as JSON number)
  lender: string;
  borrower: string;
  amount: string;             // U128 centavos
  days: number;               // 1..=30
  status: LoanStatus;         // stored status; see past_due
  requested_at: string;       // U64 ns
  approved_at: string | null;
  due_at: string | null;      // approved_at + days * DAY_NS
  closed_at: string | null;   // repaid / declined / cancelled
  bonus_paid: string;         // U128 centavos, total bonus minted for this loan (both sides)
  counted: boolean;           // true if the repayment was a counted repayment (earned trust / limit growth / bonus)
  past_due: boolean;          // computed in views: status == "Active" && now > due_at, or status == "Overdue"
}

interface Profile {
  account_id: string;
  balance: string;            // U128 centavos
  trust: number;              // u32, never below 0
  level: number;              // trust / level_step + 1
  lending_limit: string;      // U128 centavos
  lent_out: string;           // U128 centavos currently out on Active loans this account approved
  borrowed_out: string;       // U128 centavos currently owed by this account (Active + Overdue)
  loans_repaid_on_time: number;   // as borrower
  loans_repaid_late: number;      // as borrower
  loans_overdue: number;          // as borrower, times marked overdue (lifetime)
  loans_made: number;             // as lender, approved
  loans_made_repaid: number;      // as lender, repaid on time
  has_overdue: boolean;           // any loan as borrower that is past_due
  joined_at: string;              // U64 ns
  player_index: number;           // order of joining, from 0
  badges: string[];               // see Badges
  barangay: string | null;        // one of rules().barangays, chosen by the player; null until set
}

interface Stats {
  total_supply: string;
  total_lent: string;                 // sum of all approved loan amounts, lifetime
  total_repaid_on_time: string;
  total_repaid_late: string;
  outstanding: string;                // Active + Overdue principal
  overdue_outstanding: string;        // Overdue (marked or past due) principal
  active_loans: number;
  requested_loans: number;
  players: number;
  bonus_minted: string;
  bonus_pool_left: string;
  trust_index_bps: number;            // see below
}
```

`trust_index_bps = total_repaid_on_time * 10000 / (total_repaid_on_time + total_repaid_late + overdue_outstanding)`, and `10000` when the denominator is 0.

## Badges (computed in `profile`)

| id | rule |
|---|---|
| `founding_neighbour` | `player_index < 50` |
| `first_repay` | `loans_repaid_on_time >= 1` |
| `ten_on_time` | `loans_repaid_on_time >= 10` |
| `never_late` | `loans_repaid_on_time >= 3 && loans_overdue == 0` |
| `good_lender` | `loans_made_repaid >= 5` |
| `trusted` | `trust >= 100` |

## Methods

Change methods (all require the caller to be registered unless noted):

| Method | Args | Deposit | Returns | Rules |
|---|---|---|---|---|
| `new` | — | — | — | `#[init]`, sets metadata, no owner stored |
| `storage_deposit` | `{account_id?: string, registration_only?: bool}` | ≥ 0.01 NEAR | `StorageBalance` | Registers FT account + player profile (starting limit, trust 0). Refunds excess. Re-registering is a no-op with refund. |
| `set_barangay` | `{barangay}` | — | — | caller registered; `barangay` must exactly match one of `rules().barangays` (panic "Unknown barangay"); may be changed any time; emits `utang` event `barangay_set` `{account_id, barangay}`. Barangay only — the game never stores an address or location. |
| `ask` | `{lender, amount, days}` | 1 yocto optional, none required | `number` loan id | caller ≠ lender; both registered; caller has no past-due loan ("Bayad muna"); `min_loan ≤ amount ≤ max_loan`; `min_days ≤ days ≤ max_days`; caller's Requested+Active+Overdue loans < 5; `amount ≤ first_loan_cap × (1 + counted repayments between the unordered pair {caller, lender})` (panic "Credit between you two is at most X right now", X formatted like 20.00; a new pair's X is 10.00) |
| `decline` | `{loan_id}` | — | — | caller == lender; status Requested → Declined |
| `cancel` | `{loan_id}` | — | — | caller == borrower; status Requested → Cancelled |
| `approve` | `{loan_id}` | — | — | caller == lender; status Requested; `lent_out + amount ≤ lending_limit`; borrower still has no past-due loan. Mints `amount` to borrower, status Active, sets approved_at/due_at, `lent_out += amount` |
| `repay` | `{loan_id}` | — | — | caller == borrower; status Active or Overdue; borrower balance ≥ amount; burns `amount`. **On time** (status Active and now ≤ due_at): status Repaid, `lent_out -= amount`. If the repayment **counts** (see below): `counted = true`, trust +10/+5, lender `lending_limit = min(max_limit, limit + amount)`, bonus while the pool lasts. If it doesn't count, the loan simply closes: no trust, no limit growth, no bonus. **Late**: if overdue penalty not yet applied, apply it first (as in `mark_overdue`), then status RepaidLate, trust +5/+2, no bonus. |
| `mark_overdue` | `{loan_id}` | — | — | anyone (registration not required); status Active and now > due_at. Status Overdue; borrower trust −20, `loans_overdue += 1`; lender trust −10, `lending_limit = max(min_limit, limit / 2)`, `lent_out -= amount` |
| `ft_transfer`, `ft_transfer_call` | NEP-141 | 1 yocto | NEP-141 | **Panics with "Bayad muna: you have an overdue loan"** if the sender has any past-due loan |

**Counted repayment.** An on-time repay counts only if ALL hold:
1. `now ≥ approved_at + bonus_min_age_days * DAY_NS` (loan open at least 1 day);
2. the **unordered** pair {lender, borrower} has had no counted repayment in the last `pair_cooldown_days * DAY_NS`;
3. the borrower has had no counted repayment (with anyone) in the last `borrower_count_cooldown_days * DAY_NS`.

Only counted repayments earn trust, grow the lender's limit and earn a bonus. Profile counters `loans_repaid_on_time` and `loans_made_repaid` (which drive badges) also move **only on counted repayments**, while global `stats.total_repaid_on_time` (and so `trust_index_bps`) includes every on-time repayment, counted or not. Cooldowns start only on a counted repayment; boundaries are inclusive (`now ≥ approved_at + 1 day`, `now ≥ last + cooldown`). This closes the "lend and repay a minute later" loop that the simulation showed could pump limits and trust for free.

Bonus on a counted repayment = `min(amount, bonus_base_cap) * bonus_bps / 10000` (max 1.00), capped at `bonus_pool_left`; minted half to lender, half to borrower (odd centavo goes to the borrower). If the pool is empty the repayment still counts for trust and limit.

View methods:

| Method | Args | Returns |
|---|---|---|
| `rules` | — | constants object above |
| `get_loan` | `{loan_id}` | `Loan \| null` |
| `loans_of` | `{account_id}` | `Loan[]` where account is lender or borrower, newest first |
| `listahan` | `{from_index?: number, limit?: number}` | `Loan[]` newest first (default limit 50) |
| `overdue` | — | `Loan[]` that are past_due |
| `profile` | `{account_id}` | `Profile \| null` |
| `players` | `{from_index?: number, limit?: number}` | `Profile[]` in join order (default limit 50) |
| `players_in` | `{barangay, from_index?: number, limit?: number}` | `Profile[]` whose barangay equals `barangay`, in join order (default limit 50) |
| `barangay_counts` | — | `{ [barangay: string]: number }` players per barangay (only barangays with ≥1 player) |
| `leaderboard` | `{limit?: number}` | `Profile[]` sorted by trust desc, then loans_repaid_on_time desc (default 20) |
| `stats` | — | `Stats` |
| `pair_credit` | `{a, b}` | `{ counted_repayments: number, cap: string }` for the unordered pair; `cap` = `first_loan_cap × (1 + counted_repayments)` in centavos |
| `ft_*`, `storage_balance_of`, `storage_balance_bounds` | NEP-141 / NEP-145 | standard; bounds min = max = 0.01 NEAR |

Events: emit NEP-297 `nep141` `ft_mint` / `ft_burn` for every mint and burn, and an `utang` standard event (`version: "1.0.0"`) for `loan_asked`, `loan_approved`, `loan_declined`, `loan_cancelled`, `loan_repaid`, `loan_repaid_late`, `loan_overdue`, `bonus_paid`, `player_joined`.

`storage_withdraw` and `storage_unregister` panic with "Leaving the neighbourhood is not supported".
