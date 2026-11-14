# $UTANG — the neighbourhood trust game

> Built at NEAR HACKATHON · Tracks: **Memecoins With Mechanics** · **Games With Real Economies**

In every Filipino neighbourhood there is a **sari-sari store**: a tiny shop in the front window of someone's house. When you're short on cash, the owner lets you take what you need and writes it in a notebook, the **listahan**. You pay later. The notebook only works because neighbours keep their word.

**$UTANG turns that notebook into a multiplayer game and a memecoin on NEAR.**

You run a little sari-sari store. Other players are your neighbours. They come to borrow, you decide whether to trust them, and everyone competes to become the most trusted person on the street.

The coin, $UTANG (*utang* = debt), has **no starting supply**. Nobody can buy it at launch and there is no team allocation. The only way a coin comes into existence is that **one neighbour lends to another**. Repay on time and the debt disappears, both players gain trust, and you share a small bonus. Miss the due date and the loan is marked overdue, and the borrower's coins stay frozen until they pay.

So the supply of $UTANG is a live measure of **how much a community trusts each other**.

---

## The game

| Screen | What you do there |
|---|---|
| **My Store** | Your pixel-art shop: coin balance, trust score, level, who's visiting, open loans |
| **Listahan** | The shared notebook: every loan, who owes whom, due dates, repaid / overdue |
| **Neighbours** | Every registered player. Visit a profile, ask them for a loan, or approve their request |
| **Leaderboard** | Most trusted players, best lenders, most loans repaid on time |
| **Economy** | Live supply, trust index, bonus pool left, and the 60-day simulation |

### The daily loop

1. **Open your store.** Check your coins, debts and who has asked you for a loan.
2. **A neighbour asks.** Another player requests 5, 10 or 20 $UTANG for a few days.
3. **Decide.** Approve (you vouch for them) or decline.
4. **Wait.** The listahan tracks the due date for both of you.
5. **Get repaid.** Both players gain trust, and the bonus is shared.
6. **Level up.** Higher trust unlocks a bigger lending limit and badges.

### Set in Mandaluyong

The game is set in **Mandaluyong City**, Metro Manila. When you join you pick your **barangay** (one of the city's 27). The city map is drawn from [OpenStreetMap](https://www.openstreetmap.org/copyright) boundaries; tap a barangay and ride the jeepney into its street, where every house is a player who lives there. The game only ever stores a barangay name, never an address or location.

Everything that matters (loans, balances, trust, the player list, barangays) lives **in the contract**. The game has no server. If the website disappeared, the rules and records would still be there on NEAR.

---

## How the coin works

```
   ana.testnet                          ben.testnet
       │   1. ben asks: "lend me 10, 7 days"    │
       │ ◄───────────────────────────────────── │
       │   2. ana approves                      │
       │ ─────────────────────────────────────► │  +10.00 UTANG minted to ben
       │                                        │  (ben owes ana 10.00)
   ── repaid on time ──────────────────────────────────────────────────
       │   3. ben repays                        │  −10.00 UTANG burned
  +0.50│ ◄────────── bonus ──────────► │+0.50   │  +1.00 UTANG from the bonus pool
  +5 trust                          +10 trust   │
   ── overdue ─────────────────────────────────────────────────────────
       │   3. due date passes; anyone calls mark_overdue
  −10 trust, lending limit halved   −20 trust, coins frozen until repaid
```

### The rules

1. **Join.** Register with a small storage deposit (NEP-145). This makes fake accounts cost real money.
2. **Ask.** The borrower asks a specific lender for an amount and a term (2–30 days; the shortest is 2 days so there is always time to repay in a way that counts). **Credit between two neighbours grows step by step:** at most 10.00 the first time, then 10.00 more for every counted repayment between them (20.00, 30.00, …). You start small with someone new, like in a real store.
3. **Approve.** The lender approves. The contract **mints** the amount to the borrower and records the debt. A lender can only have as much lent out as their **lending limit**.
4. **Repay on time.** Coins equal to the debt are **burned** from the borrower. The repayment **counts** if the loan was open at least 24 hours, the two players haven't had a counted repayment together in the last 7 days, and the borrower hasn't had one with anyone in the last day. A counted repayment gives both players **trust**, grows the lender's lending limit, and pays a **10% bonus on up to 10.00** (so at most 1.00) from the capped bonus pool, half to each side. A repayment that doesn't count still clears the debt.
5. **Overdue.** After the due date, **anyone** can call `mark_overdue`. While a borrower has an overdue loan they **cannot send $UTANG and cannot borrow**: *bayad muna* (pay first). They can still receive coins and repay. A late repayment clears the debt but earns no bonus.
6. **Lender's risk.** When a loan you approved goes overdue, **your lending limit is halved** and you lose trust. Vouch carefully.

A loan needs **both sides to agree** (ask + approve), so nobody can push a debt onto someone else.

### Trust (reputation)

Trust is a **score stored in the contract. It can't be transferred, bought or sold.** It only moves when loans finish.

| Event | Borrower | Lender |
|---|---|---|
| Loan repaid on time (counted repayment) | +10 | +5 |
| Loan marked overdue | −20 | −10 |
| Overdue loan repaid late | +5 (partial recovery) | +2 |

Trust never goes below 0. Your **level** is shown from your trust (Level 1 at 0, then every 50 points), and badges are unlocked by milestones (first loan repaid, 10 loans repaid on time, never overdue, …).

### Parameters

Fixed at deploy. Readable by anyone with `rules()`. **No admin key can change them.**

| Parameter | Value |
|---|---|
| Decimals | 2 (like pesos and centavos) |
| Join deposit | 0.01 NEAR (storage deposit, NEP-145) |
| Starting lending limit | 10.00 UTANG |
| Lending limit growth | + the amount of each loan you made that was repaid on time |
| Maximum lending limit | 1,000.00 UTANG |
| Loan term | 2–30 days |
| Credit between two neighbours | at most 10.00 × (1 + counted repayments between them) |
| On-time bonus | 10% of the first 10.00 of the loan (max 1.00): half to lender, half to borrower |
| Bonus pool | **100,000.00 UTANG in total, ever.** When it's empty, repayments still earn trust but no new coins |
| A repayment counts only if… | the loan was open ≥ 24 hours, **and** the pair had no counted repayment in the last 7 days, **and** the borrower had none in the last day |
| Only counted repayments | earn trust, grow the lending limit, and earn the bonus |
| Overdue penalty (lender) | lending limit halved, −10 trust |
| Overdue penalty (borrower) | transfers and new loans blocked until repaid, −20 trust |

### What the supply tells you

| Event | Supply |
|---|---|
| A loan is approved | ⬆ +amount |
| A loan is repaid on time | ⬇ −amount, then ⬆ bonus (while the pool lasts) |
| A loan is repaid late | ⬇ −amount |
| A loan stays unpaid | coins stay frozen with the borrower |

Because bonuses come from a fixed pool, **total supply can never exceed outstanding loans + 100,000.00 UTANG**.

The Economy screen shows the **trust index**: the share of all lent $UTANG that came back on time.

---

## 60-day simulation

Before fixing the numbers above, we simulated 60 days of a neighbourhood playing $UTANG under several scenarios. The results are shown on the Economy screen and can be re-run with one command (see [Run it yourself](#run-it-yourself)).

| Scenario | What it tests |
|---|---|
| **Honest barangay** | 95% of loans repaid on time. Does supply grow steadily without exploding? |
| **A few deadbeats** | 70% repaid. Do the overdue rules contain the damage? |
| **Trust collapse** | Repayment drops from 95% to 40% on day 30. How fast does supply react? |
| **Sybil farm** | One player with 50 fake accounts lending to each other. What does it cost them and what can they get? |

| Scenario | Players | Loans | On time | Peak supply | Bonus minted | Bonus pool empty | Trust index, day 60 |
|---|---|---|---|---|---|---|---|
| Honest barangay | 40 | 236 | 94.6% | 516.30 | 133.80 | no | 92.2% |
| A few deadbeats | 40 | 195 | 79.8% | 514.60 | 91.10 | no | 78.9% |
| Trust collapse | 40 | 184 | 66.9% | 490.70 | 72.90 | no | 65.6% |
| Sybil farm (40 honest + 50 fake) | 90 | 1,800 | 97.2% | 8,979.30 | 1,474.60 | no | 72.3% |
| Pool stress (very active) | 10,000 | 228,846 | 92.9% | 393,649.00 | 100,000.00 | day 45, stops exactly at the cap | 92.9% |

### The simulation broke our first design

Our first rules looked fine on paper. The simulation showed they weren't, so we changed them:

| Same attacker, same seeds | First design | Final rules |
|---|---|---|
| Bonus farmed by 50 fake accounts in 60 days | 99,876.00 (**pool emptied on day 22**) | **989.00** (pool would last ~2,000 days) |
| Borrow-and-run, attacker who builds history first | 12,081.00 | **6,738.00** |
| Borrow-and-run, attacker who doesn't | 2,323.00 | **770.00** |
| Honest players' median lending limit (40-player barangay) | 35.00 | **41.62** (no cost to honest players) |

What changed: repayments only **count** after a day and once per pair per week (so instant lend-repay loops earn nothing), the bonus is capped at 1.00 per loan, and **credit between two neighbours grows step by step**. We tested four versions of that last rule against an attacker who adapts to each; `sim/output/summary.md` has the full comparison and what each one costs honest players.

What the simulation says we **didn't** fix: fake accounts can still out-rank honest players on the leaderboard, because trust can't prove identity. Very active honest players also feel the rules: in the 10,000-player run, about 36% of on-time repayments were too quick or too repetitive to count.

Full results: [`sim/output/summary.md`](sim/output/summary.md) · data: `sim/output/*.json`.

---

## Limits and the honest threat model

This is a hackathon demo on testnet. These are the attacks we know about and how far the rules go against them:

| Attack | What stops it | What it still allows |
|---|---|---|
| **Instant lend-and-repay loops** to pump trust and limits | A repayment only counts after the loan is 24 h old, once per pair per 7 days, once per borrower per day | Nothing: quick loops just close loans. (Our first design allowed this; the simulation caught it. See below.) |
| **Self-lending ring to farm the bonus and trust** (many accounts lending to each other) | Join deposit per account; counting rules above; bonus capped at 1.00 per loan; bonus pool capped forever | Each fake account can earn at most one counted repayment a day: ≈ 1.00 bonus and +10 trust per account per day. In the simulation a 50-account ring farmed 989.00 UTANG of bonus in 60 days (vs 99,876.00 under our first design) but still out-ranked almost every honest player (best honest player: #48 of 90). **Trust can't prove identity**; read the leaderboard with that in mind. |
| **Borrow and run** (borrow from honest neighbours, move the coins to a clean account before the due date) Credit with any neighbour grows only 10.00 per counted repayment; max 5 open loans per borrower; lenders' limits halve on every overdue loan; runners are frozen after the due date | A naive runner gets about 10.00 per honest lender. A **patient** attacker can first build real repayment history with honest lenders ("priming") and then run: in the simulation, 50 fake accounts took 6,738 UTANG this way (9,492 with an all-at-once cap, 11,042 with no cap, 12,081 under our first design). We compared four rules; see `sim/output/summary.md`. |
| **Coins sent to an overdue account** | — | They stay frozen with that account and can only be used to repay. |
| **Forcing debt on someone** | Loans need the borrower to ask *and* the lender to approve | — |
| **Admin changing the rules** | Parameters are constants; the contract account's full-access keys are deleted after deploy | — |
| **Spam `mark_overdue`** | Only works after the due date on an unpaid loan; it only records what is already true | — |
| **Inflation from bonuses** | Bonus pool capped at 100,000.00 UTANG forever | — |

The contract cannot know who is a real person. Trust in $UTANG measures how accounts treated each other. It does not prove identity. Players appear by their NEAR account name only, and the game never asks for personal information.

---

## Why NEAR

- **Readable names.** The listahan reads like the real notebook: `ben.testnet owes ana.testnet 10.00`. No hex addresses.
- **Rules nobody can change.** NEAR lets us delete the contract account's keys after deploy, so the rules are final.
- **Storage deposits** give every account a real, small cost, our first line against fake accounts.
- **Fast, cheap transactions** make repaying 0.50 UTANG worth doing and make the game feel responsive.
- Standards: **NEP-141** (fungible token), **NEP-145** (storage management).

---

## Repository layout

```
contract/   Rust smart contract (near-sdk): NEP-141 token, loans, trust, bonus pool
sim/        60-day neighbourhood simulation (Python) → JSON shown on the Economy screen
web/        The game: pixel-art store, Listahan, Neighbours, Leaderboard, Economy
```

## Contract methods

| Method | Who | What it does |
|---|---|---|
| `storage_deposit()` | anyone | Join the neighbourhood (NEP-145) |
| `set_barangay(barangay)` | player | Choose your home barangay (one of Mandaluyong's 27); can be changed any time |
| `ask(lender, amount, days)` | borrower | Request a loan; returns `loan_id` |
| `approve(loan_id)` | lender | Mint the loan to the borrower |
| `decline(loan_id)` | lender | Turn down a request |
| `cancel(loan_id)` | borrower | Withdraw a request before approval |
| `repay(loan_id)` | borrower | Burn the debt; bonus and trust if on time |
| `mark_overdue(loan_id)` | anyone | Mark an unpaid loan past its due date |
| `ft_transfer`, `ft_balance_of`, … | — | Standard NEP-141; transfers blocked while the sender has an overdue loan |
| `rules()` | view | All parameters |
| `get_loan(loan_id)`, `loans_of(account_id)` | view | Loan details |
| `listahan(from_index, limit)` | view | All loans, newest first |
| `overdue()` | view | Loans currently overdue |
| `profile(account_id)` | view | Balance, trust, level, lending limit, loan counts |
| `players(from_index, limit)` | view | Registered players (for the Neighbours screen) |
| `players_in(barangay, from_index, limit)`, `barangay_counts()` | view | Players in a barangay, and how many live in each (for the city map) |
| `pair_credit(a, b)` | view | How much two neighbours can currently borrow from each other |
| `leaderboard(limit)` | view | Players ranked by trust |
| `stats()` | view | Supply, total lent, repaid on time, overdue, trust index, bonus pool left |

## Run it yourself

Requirements: Rust with the `wasm32-unknown-unknown` target and [cargo-near](https://github.com/near/cargo-near), Node 20+, Python 3.10+ (standard library only).

```bash
# Simulation: 5 scenarios + before/after rule comparison, deterministic (~25 s)
cd sim && python3 simulate.py                 # writes sim/output/*.json and summary.md

# Contract: 62 unit tests, in both time modes
cd contract
cargo test
cargo test --features demo-time
cargo near build non-reproducible-wasm --out-dir target/near/normal
cargo near build non-reproducible-wasm --features demo-time --out-dir target/near/demo

# Game (see "Run the game" below for details)
cd web && npm install && npm run dev          # open http://localhost:5173
```

### Run the game (frontend)

The game is a Vite + React + TypeScript app in `web/` (Phaser 4 for the street, ZzFX for sound). Requires Node 20+.

```bash
cd web
npm install
npm run dev            # → http://localhost:5173
```

It runs in one of two modes, chosen by environment variables:

| Mode | How | What you get |
|---|---|---|
| **Preview** (default) | no `.env.local` | An in-browser neighbourhood with computer neighbours and a demo clock (1 day = 1 minute, "Skip 1 day" in the ≡ menu). No wallet, nothing on-chain. Best for a first look. |
| **Live** | `cp .env.example .env.local` | Plays against the deployed contract on NEAR testnet. You sign in with a testnet wallet and every action is a real transaction. |

`.env.local` settings:

| Variable | Default | Meaning |
|---|---|---|
| `VITE_NETWORK` | `testnet` | NEAR network |
| `VITE_CONTRACT_ID` | `demo.utang-game.testnet` | Contract to play against. `demo.…` = 1 day is 1 minute (good for trying the full loop); `utang-game.testnet` = real days. Leave empty for preview mode. |
| `VITE_RPC_URL` | FastNEAR testnet RPC | Optional RPC override |

**Playing live:** create a free testnet account in [MyNearWallet](https://testnet.mynearwallet.com/) or [Meteor Wallet](https://wallet.meteorwallet.app/) (switch it to testnet; test NEAR is free), open the game, click **Connect NEAR wallet**, then **Join for 0.01 NEAR**, pick your barangay and follow the quest. You'll need someone else to lend to and borrow from: open the game in a second browser profile with a second testnet account.

Other commands:

```bash
npm run build          # type-check + production build into web/dist/
npm run preview        # serve the production build locally
npm test               # 70 tests: contract-rules mock, invariants, input guards, quest, dialogs, map
npm run sync-sim       # copy ../sim/output/*.json into the Economy screen
npm run check-live     # read-only check that the live contract's data matches the app's types
```

## Deployment

| | |
|---|---|
| Network | NEAR testnet |
| Contract (real time: 1 day = 24 h) | [`utang-game.testnet`](https://testnet.nearblocks.io/address/utang-game.testnet) |
| Demo contract (1 day = 1 minute) | [`demo.utang-game.testnet`](https://testnet.nearblocks.io/address/demo.utang-game.testnet) |
| Token | `UTANG`, 2 decimals, NEP-141 (on both contracts) |
| Test players (on the demo contract) | [`ana.utang-game.testnet`](https://testnet.nearblocks.io/address/ana.utang-game.testnet) (Hulo), [`ben.utang-game.testnet`](https://testnet.nearblocks.io/address/ben.utang-game.testnet) (New Zañiga) |
| Game | *to be deployed* |
| Demo post | *to be posted* |

Private keys are never published in this repository. To play live, use your own testnet account (see [Run the game](#run-the-game-frontend)).

### For developers and AI agents: account keys

The keys are **not in this repo** (`.gitignore` blocks key and env files). They live on the original developer's machine in the NEAR CLI's local keychain:

| Account | Role | Key file |
|---|---|---|
| `utang-game.testnet` | Main contract (also funds and owns the sub-accounts) | `~/.near-credentials/testnet/utang-game.testnet.json` |
| `demo.utang-game.testnet` | Demo contract (1 day = 1 minute) | `~/.near-credentials/testnet/demo.utang-game.testnet.json` |
| `ana.utang-game.testnet` | Test player (Hulo) | `~/.near-credentials/testnet/ana.utang-game.testnet.json` |
| `ben.utang-game.testnet` | Test player (New Zañiga) | `~/.near-credentials/testnet/ben.utang-game.testnet.json` |

Each file is `{ "account_id", "public_key", "private_key" }` in the format used by [near-cli-rs](https://github.com/near/near-cli-rs) (`save-to-legacy-keychain` / `sign-with-legacy-keychain`). Older, no-longer-valid keys from earlier deployments are kept in `~/.near-credentials/testnet/_stale-utang-keys-backup/`; ignore them.

**Getting access as another developer.** Preferred: create your own key and have the owner add it to the account, so no private key is ever sent:

```bash
# 1. New developer: make your own key pair by creating a free testnet account
near account create-account sponsor-by-faucet-service <you>.testnet autogenerate-new-keypair save-to-legacy-keychain network-config testnet create
#    your public key is the "public_key" field of ~/.near-credentials/testnet/<you>.testnet.json — send ONLY that

# 2. Owner: add that public key to the contract account
near account add-key utang-game.testnet grant-full-access use-manually-provided-public-key ed25519:<THEIR_PUBLIC_KEY> network-config testnet sign-with-legacy-keychain send

# 3. New developer: tell the CLI to use your key for that account
cp ~/.near-credentials/testnet/<you>.testnet.json ~/.near-credentials/testnet/utang-game.testnet.json
#    then edit "account_id" in the copy to "utang-game.testnet"
```

Repeat step 2–3 for `demo.utang-game.testnet` if needed. The owner can remove access later with `near account delete-keys utang-game.testnet public-keys ed25519:<THEIR_PUBLIC_KEY> network-config testnet sign-with-legacy-keychain send`.

If a key file has to be handed over, send it through a password manager or another encrypted channel, never chat, email or git, and place it at the same path on the receiving machine.

**Rules for AI agents working in this repo:** sign with `sign-with-legacy-keychain` (the CLI finds the key by account name), never print, copy or commit the contents of `~/.near-credentials`, and never add key material to code, docs, logs or `.env` files.

**Upgrading a deployed contract** (only possible while the account still has a key):

```bash
cd contract
cargo near build non-reproducible-wasm --out-dir target/near/normal
near contract deploy utang-game.testnet use-file target/near/normal/utang.wasm without-init-call network-config testnet sign-with-legacy-keychain send
cargo near build non-reproducible-wasm --features demo-time --out-dir target/near/demo
near contract deploy demo.utang-game.testnet use-file target/near/demo/utang.wasm without-init-call network-config testnet sign-with-legacy-keychain send
```

`without-init-call` keeps existing state; it only works if the contract's stored data layout hasn't changed. If it has, the account has to be recreated and `new` called again (state is lost).

> **Before the final submission the contracts' keys will be deleted** so that nobody, including us, can change the rules. After that, the key files for `utang-game.testnet` and `demo.utang-game.testnet` stop working and the contracts can no longer be upgraded; the test-player keys keep working.

Both contracts run the same code; the demo build only shortens the day so a full loan cycle (ask → approve → wait a "day" → repay with bonus) fits in a video. Check with `near contract call-function as-read-only demo.utang-game.testnet rules json-args '{}' network-config testnet now`: `demo_time` is `true` there and `false` on the main contract.

> The contracts still hold their deploy keys while the game is being tested. They are deleted at the final deploy, and this section will link the transaction that removes them.

## Status

- [x] 60-day simulation
- [x] Contract: NEP-141 + NEP-145
- [x] Contract: ask / approve / decline / cancel / repay / mark_overdue
- [x] Contract: trust, lending limits, capped bonus pool, counted repayments, first-loan cap
- [x] Contract: transfers blocked while overdue
- [x] Contract tests (62 unit tests, normal and demo builds)
- [x] Deploy to testnet
- [ ] Delete the contracts' keys (final deploy)
- [x] Game: My Store, Listahan, Neighbours, Leaderboard, Economy
- [x] Wallet connection and live contract data
- [ ] Walkable street scene (Phaser) with sound effects
- [ ] Publish the game online
- [ ] Demo video + post on X

## Glossary

| Word | Meaning |
|---|---|
| **sari-sari store** | Small neighbourhood shop in the Philippines, often run from a home |
| **listahan** | "The list": the store's notebook of who owes what |
| **utang** | Debt |
| **bayad muna** | "Pay first" |
| **barangay** | Neighbourhood / village, the smallest unit of local government |

## License

MIT
