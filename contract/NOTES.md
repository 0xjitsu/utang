# $UTANG contract: build notes and decisions

`docs/INTERFACE.md` is the authoritative interface. This file records how to build and test the
contract and every place where the contract had to pick a behaviour INTERFACE.md does not pin down.

## Layout

```
contract/
  Cargo.toml      crate `utang`, feature `demo-time`
  src/lib.rs      the contract
  src/tests.rs    unit tests (near-sdk `unit-testing`, testing_env + block_timestamp)
```

## Toolchain and versions

- rustc 1.99.1, cargo-near 0.22.0, target wasm32-unknown-unknown
- `near-sdk = "5.30"` and `near-contract-standards = "5.30"`, which resolve to **5.30.2** (see `Cargo.lock`)
- `cargo build` on the host fails on purpose (near-sdk 5.30 `compile_error!`). Use `cargo test` for
  native builds and `cargo near build` for wasm.

## Commands (run from `contract/`)

```bash
# Unit tests, normal 24 h day
cargo test

# Unit tests, demo day (60 s). The same tests run against both, since they use DAY_NS.
cargo test --features demo-time

# Lint
cargo clippy --tests

# Wasm, normal build  -> target/near/normal/utang.wasm
cargo near build non-reproducible-wasm --out-dir target/near/normal

# Wasm, demo-time build -> target/near/demo/utang.wasm
cargo near build non-reproducible-wasm --features demo-time --out-dir target/near/demo
```

`--out-dir` keeps the two variants apart (otherwise both land in `target/near/utang.wasm`).
Both builds also write `utang_abi.json` next to the wasm and embed the ABI.

Init after deploy (not done here): `new` takes no arguments, for example
`near contract call-function as-transaction <contract> new json-args '{}' ...`.

## Parameters

All constants are Rust `const`s in `src/lib.rs`. There is no owner field and no method that changes
them. `DAY_NS` is `86_400_000_000_000` normally and `60_000_000_000` with `--features demo-time`.
`rules().demo_time` is `cfg!(feature = "demo-time")`. Loan term (`due_at`), the minimum loan age for
a counted repayment, the pair cooldown and the borrower count cooldown are all `n * DAY_NS`.

## Counted repayments

An on-time repay (`status == Active && now <= due_at`) always closes the loan: status `Repaid`,
principal burned, lender `lent_out -= amount`, borrower `borrowed_out -= amount`. It **counts** only if:

1. `now >= approved_at + bonus_min_age_days * DAY_NS`,
2. the unordered pair has no counted repayment with `now < last + pair_cooldown_days * DAY_NS`,
3. the borrower has no counted repayment (as borrower, with anyone) with
   `now < last + borrower_count_cooldown_days * DAY_NS`.

A counted repay sets `Loan.counted = true`, gives trust +10/+5, grows the lender's limit
(`min(max_limit, limit + amount)`), records the pair and borrower timestamps (always, even if the
pool is empty), and pays `min(amount, bonus_base_cap) * bonus_bps / 10000` capped at the pool left.
A non-counted repay changes none of those. Storage: `pairs` (LookupMap keyed by the sorted pair,
value `PairRecord { last_counted_at, counted_repayments }`) and `Player.last_counted_at`.

## Pair credit (step by step)

A pair may borrow at most `first_loan_cap * (1 + counted repayments between them)`: 10.00 for a new
pair, 20.00 after one counted repayment, 30.00 after two, and so on. Counted repayments in either
direction add to the same unordered pair. The view `pair_credit({a, b})` returns
`{"counted_repayments": n, "cap": "<centavos>"}` in either argument order, and works for unregistered
or unknown accounts (`0`, `"1000"`).

## Panic messages

Messages fixed by INTERFACE.md are used verbatim. The others were chosen here:

| Where | Message |
|---|---|
| `ft_transfer`, `ft_transfer_call`, `ask` (caller past due) | `Bayad muna: you have an overdue loan` |
| `approve` (borrower past due) | `Bayad muna: the borrower has an overdue loan` |
| `storage_withdraw`, `storage_unregister` | `Leaving the neighbourhood is not supported` |
| `storage_deposit` below 0.01 NEAR | `The join deposit is 0.01 NEAR` |
| caller not registered | `You are not registered: call storage_deposit first` |
| `ask` lender not registered | `The lender is not registered` |
| `ask` lender == caller | `You cannot borrow from yourself` |
| `ask` amount | `Amount must be between 1.00 and 1,000.00 UTANG` |
| `ask` days | `Days must be between 2 and 30` |
| `ask` 5 open loans | `Too many open loans: at most 5 requested or active` |
| `ask` deposit above 1 yocto | `ask takes no deposit (at most 1 yoctoNEAR)` |
| unknown loan id | `Loan not found` |
| `decline` / `approve` by non-lender | `Only the lender can do this` |
| `cancel` / `repay` by non-borrower | `Only the borrower can do this` |
| `decline` / `cancel` / `approve` not Requested | `Loan is not in Requested status` |
| `repay` not Active/Overdue | `Loan is not Active or Overdue` |
| `mark_overdue` not Active | `Loan is not Active` |
| `mark_overdue` before due | `Loan is not past its due date yet` |
| `approve` over limit | `Over your lending limit` |
| `set_barangay` name not in `rules().barangays` | `Unknown barangay` |
| `ask` / `approve` above the pair credit | `Credit between you two is at most X right now`, X = cap like `10.00`, `20.00`, `1,000.00` |
| `repay` balance too low | `Not enough UTANG to repay this loan` |

NEP-141 errors from near-contract-standards are unchanged (for example
`Requires attached deposit of exactly 1 yoctoNEAR`, `The account <id> is not registered`).

## Barangays

`rules().barangays` is the 27-name `BARANGAYS` constant, in INTERFACE.md order. "New Zañiga" and
"Old Zañiga" use the precomposed `ñ` (U+00F1, UTF-8 `c3 b1`), the same bytes as INTERFACE.md.
`set_barangay` compares the exact string: no trimming, no case folding, no Unicode normalisation,
so a decomposed `n` + U+0303 is "Unknown barangay".

Storage:
- `Player.barangay: Option<u8>` stores the index into `BARANGAYS`, so the name length costs nothing
  per player. `Profile.barangay` turns it back into the name (or `null`).
- `barangay_members: LookupMap<u8, Vec<u32>>` holds each barangay's player indexes, kept sorted
  (binary search insert/remove), so `players_in` returns join order without scanning all players.
  Moving removes the player from the old list. At most 27 entries exist; an emptied list stays as an
  empty entry.
- `barangay_counts: Vec<u32>` (27 counters in contract state) backs `barangay_counts()`, which
  returns a JSON object of only the non-zero barangays (keys sorted by UTF-8 bytes).

**Join deposit check**: the unit test `join_deposit_covers_worst_case_player_storage` measures a
64-character account id joining and then moving between two barangays that had no index entry
yet (the longest name included): **543 bytes = 0.00543 NEAR**, so the 0.01 NEAR (1,000 bytes)
deposit still covers it. Each further player in a barangay adds 4 bytes to that barangay's list.
A barangay with N players reads and rewrites a 4·N-byte list on `set_barangay` (40 KB at
10,000 players), which is fine for this game's size.

`set_barangay` is not `#[payable]`, so any attached deposit is rejected by the near-sdk wrapper
("Method set_barangay doesn't accept deposit"). Setting the same barangay again is a no-op for the
index but still emits `barangay_set`. `players_in` with an unknown name returns `[]`.

## Events

Every mint/burn emits the standard `nep141` `ft_mint` / `ft_burn` (memo `"loan"`, `"bonus"` or
`"repay"`). Transfers emit `ft_transfer` (from near-contract-standards).

The game's own events use `{"standard":"utang","version":"1.0.0","event":...,"data":[{...}]}`.
INTERFACE.md does not fix the data shape, so `data` is an **array with one object**, like nep141.
Amounts and timestamps are strings; `loan_id` and `player_index` are numbers.

| event | data fields |
|---|---|
| `player_joined` | `account_id`, `player_index` |
| `barangay_set` | `account_id`, `barangay` (the name) |
| `loan_asked` | `loan_id`, `lender`, `borrower`, `amount`, `days` |
| `loan_approved` | `loan_id`, `lender`, `borrower`, `amount`, `due_at` |
| `loan_declined` | `loan_id`, `lender`, `borrower` |
| `loan_cancelled` | `loan_id`, `lender`, `borrower` |
| `loan_repaid` | `loan_id`, `lender`, `borrower`, `amount`, `counted` (bool) |
| `loan_repaid_late` | `loan_id`, `lender`, `borrower`, `amount` |
| `loan_overdue` | `loan_id`, `lender`, `borrower`, `amount`, `marked_at` |
| `bonus_paid` | `loan_id`, `lender`, `borrower`, `lender_bonus`, `borrower_bonus`, `bonus_pool_left` |

Order within one transaction:
- approve: `ft_mint`, `loan_approved`
- on-time repay: `ft_burn`, `loan_repaid`, then if it counted and the pool is not empty `ft_mint` (lender), `ft_mint` (borrower), `bonus_paid`
- late repay of an unmarked loan: `loan_overdue`, `ft_burn`, `loan_repaid_late`
- late repay of a marked loan: `ft_burn`, `loan_repaid_late`

## Decisions and interpretations of INTERFACE.md

1. **`listahan(from_index, limit)`**: `from_index` is an offset into the newest-first list
   (0 = newest loan). `from_index` past the end returns `[]`. No upper cap on `limit`.
2. **`players(from_index, limit)`**: `from_index` is the join index. No upper cap on `limit`.
3. **`overdue()`**: returns past-due loans (marked or not) sorted by loan id ascending (oldest first).
   It scans only the set of Active+Overdue loans, not every loan.
4. **`leaderboard`**: trust desc, then `loans_repaid_on_time` desc, then `player_index` asc as a final
   tie-break. Scans all players.
5. **`stats.active_loans`** counts loans whose stored status is `Active` (including ones past due
   that nobody has marked). Loans with stored status `Overdue` are not counted there; they are in
   `outstanding` and `overdue_outstanding`.
6. **`stats.overdue_outstanding`** and **`trust_index_bps`** include past-due loans that have not been
   marked, as the Stats comment says ("Overdue (marked or past due)").
7. **`ask` deposit**: `ask` is `#[payable]` so a wallet can attach 1 yocto. Anything above 1 yocto is
   rejected ("ask takes no deposit (at most 1 yoctoNEAR)") so nobody loses NEAR by mistake. No other
   loan method accepts a deposit.
8. **`ask` validation order**: self-loan, caller registered, lender registered, amount, days,
   caller past due, open-loan count, pair credit. INTERFACE.md lists the rules but not their order.
9. **`approve`** checks status, then pair credit (defensive; `ask` already enforces it), then
   the lending limit, then that the borrower has no past-due loan.
   `loans_made` is incremented at approval.
10. **`storage_deposit`**: `registration_only` is ignored because min == max. Excess over 0.01 NEAR
    is refunded to the predecessor. If the account is already registered, the whole deposit is
    refunded to the predecessor and nothing changes (no event). Registering on behalf of another
    `account_id` is allowed (the refund goes to the caller). `available` is always 0.
11. **`storage_withdraw` / `storage_unregister`** are `#[payable]` so they always panic with the
    "Leaving..." message, whatever deposit is attached.
12. **Transfers**: the past-due check runs before the NEP-141 one-yocto check. A sender who is not a
    player has no loans, so the NEP-141 rules apply unchanged. Receiving is never blocked.
    `ft_resolve_transfer` delegates to near-contract-standards; accounts can never unregister, so the
    "sender deleted, burn the refund" branch cannot happen.
13. **Time boundaries**: on time means `now <= due_at`; `mark_overdue` and `past_due` need
    `now > due_at`; min age is met at `now >= approved_at + 1 day`; a pair can count again at
    `now >= last_counted + 7 days`; a borrower can count again at `now >= last_counted + 1 day`.
14. **Cooldowns** are recorded on every counted repayment (including when the pool is empty) and
    never on a non-counted one, so a quick repay does not restart either cooldown. The pair key is
    the unordered pair (accounts sorted). The borrower cooldown only looks at counted repayments
    where the account was the borrower.
15. **Bonus split**: `lender = bonus / 2`, `borrower = bonus - lender`. If the capped bonus is a single
    centavo, only the borrower's `ft_mint` is emitted. `Loan.bonus_paid` is the total of both halves.
16. **Late repay**: if the loan is still stored as `Active`, the full `mark_overdue` penalty is applied
    first (including the `loan_overdue` event and `loans_overdue += 1`), then the late-repay trust.
    The lender's limit is not restored and does not grow on a late repay.
17. **`lent_out`** drops when a loan is marked overdue (as specified), so the halved limit is measured
    against loans that are still on time.
18. **Bonus pool in tests**: tests set the private `bonus_minted` field directly to simulate an almost
    empty pool. There is no runtime method or constructor argument for it.
19. **Storage cost of loans**: the 0.01 NEAR join deposit covers the player and FT records. Loan
    records (about 200 bytes each, plus index entries) are paid from the contract's own balance, so
    the contract account needs some NEAR on top of what it costs to deploy the code. The 5-open-loans
    rule limits how fast one borrower can add records.
20. **Token metadata**: `spec "ft-1.0.0"`, name `Utang`, symbol `UTANG`, decimals 2, a small inline
    SVG coin as `icon`, no `reference`.
21. Loan ids are `u64` on the wire but stored in a `Vector` indexed by `u32` (4 billion loans max).
22. **Profile counters only move on counted repayments**: `loans_repaid_on_time` (borrower) and
    `loans_made_repaid` (lender) are incremented only when the repayment counts, because they drive
    badges (`first_repay`, `ten_on_time`, `never_late`, `good_lender`) and the leaderboard tie-break,
    which would otherwise be farmable by quick repays. INTERFACE.md describes them as "repaid on
    time"; a non-counted on-time repay is not added to them.
23. **Global stats still include non-counted repays**: `stats.total_repaid_on_time` (and so
    `trust_index_bps`) adds the principal of every on-time repay, counted or not, so
    `total_lent = total_repaid_on_time + total_repaid_late + outstanding` always holds.
24. A loan repaid late, declined or cancelled always has `counted = false`.
25. **Pair credit**: `amount <= first_loan_cap * (1 + n)`, where `n` counts counted repayments of the
    unordered pair in either direction. Quick, late, declined or cancelled loans never raise `n`, and
    nothing lowers it (an overdue loan does not reset pair credit). The lender's lending limit still
    applies at `approve`, so pair credit is a ceiling, not a grant. The cap is not limited to
    `max_loan`; `pair_credit` returns the raw product. The amount in the panic message is formatted
    with 2 decimals and comma thousands separators (`format_utang`).
26. **Minimum term is 2 days** (`min_days = 2`, was 1). With a 1-day term and `bonus_min_age_days = 1`
    a loan could only count at the exact instant it fell due. A 2-day loan can count from age 1 day
    up to and including its due time (test `shortest_loan_can_count`).
