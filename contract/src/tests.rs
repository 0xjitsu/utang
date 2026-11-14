use super::*;
use near_sdk::mock::MockAction;
use near_sdk::test_utils::{get_created_receipts, get_logs, VMContextBuilder};
use near_sdk::testing_env;
use std::panic::{catch_unwind, AssertUnwindSafe};

const T0: u64 = 1_700_000_000_000_000_000;
const ONE_YOCTO: NearToken = NearToken::from_yoctonear(1);

fn acc(name: &str) -> AccountId {
    format!("{name}.testnet").parse().unwrap()
}

fn contract_id() -> AccountId {
    "utang.testnet".parse().unwrap()
}

fn set_ctx(predecessor: &AccountId, now: u64, deposit: NearToken) {
    testing_env!(VMContextBuilder::new()
        .current_account_id(contract_id())
        .predecessor_account_id(predecessor.clone())
        .signer_account_id(predecessor.clone())
        .account_balance(NearToken::from_near(100))
        .block_timestamp(now)
        .attached_deposit(deposit)
        .build());
}

/// Runs `f` and asserts it panics with a message containing `msg`.
fn expect_panic<R>(f: impl FnOnce() -> R, msg: &str) {
    let prev = std::panic::take_hook();
    std::panic::set_hook(Box::new(|_| {}));
    let res = catch_unwind(AssertUnwindSafe(f));
    std::panic::set_hook(prev);
    let err = match res {
        Ok(_) => panic!("expected panic containing {msg:?}, but call succeeded"),
        Err(e) => e,
    };
    let text = err
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| err.downcast_ref::<&str>().map(|s| s.to_string()))
        .unwrap_or_default();
    assert!(
        text.contains(msg),
        "expected panic containing {msg:?}, got {text:?}"
    );
}

/// Small harness: a contract plus a clock.
struct T {
    c: Contract,
    now: u64,
}

impl T {
    fn new() -> Self {
        set_ctx(&contract_id(), T0, NearToken::from_yoctonear(0));
        T {
            c: Contract::new(),
            now: T0,
        }
    }

    fn with(players: &[&str]) -> Self {
        let mut t = Self::new();
        for p in players {
            t.join(p);
        }
        t
    }

    fn at(&self, who: &AccountId) {
        set_ctx(who, self.now, NearToken::from_yoctonear(0));
    }

    fn at_dep(&self, who: &AccountId, dep: NearToken) {
        set_ctx(who, self.now, dep);
    }

    /// Moves the clock forward and refreshes the context so views see the new time.
    fn advance(&mut self, ns: u64) {
        self.now += ns;
        set_ctx(&contract_id(), self.now, NearToken::from_yoctonear(0));
    }

    fn join(&mut self, who: &str) {
        self.at_dep(&acc(who), JOIN_DEPOSIT);
        self.c.storage_deposit(None, None);
    }

    fn ask(&mut self, borrower: &str, lender: &str, amount: u128, days: u32) -> u64 {
        self.at(&acc(borrower));
        self.c.ask(acc(lender), U128(amount), days)
    }

    fn approve(&mut self, lender: &str, id: u64) {
        self.at(&acc(lender));
        self.c.approve(id);
    }

    fn repay(&mut self, borrower: &str, id: u64) {
        self.at(&acc(borrower));
        self.c.repay(id);
    }

    fn mark(&mut self, who: &str, id: u64) {
        self.at(&acc(who));
        self.c.mark_overdue(id);
    }

    fn transfer(&mut self, from: &str, to: &str, amount: u128) {
        self.at_dep(&acc(from), ONE_YOCTO);
        self.c.ft_transfer(acc(to), U128(amount), None);
    }

    /// ask + approve
    fn lend(&mut self, lender: &str, borrower: &str, amount: u128, days: u32) -> u64 {
        let id = self.ask(borrower, lender, amount, days);
        self.approve(lender, id);
        id
    }

    /// lend (30-day term), wait a full pair cooldown, repay: always a counted repayment
    /// unless the same pair or borrower counted something within the wait.
    fn settle(&mut self, lender: &str, borrower: &str, amount: u128) -> u64 {
        let id = self.lend(lender, borrower, amount, 30);
        self.advance(PAIR_COOLDOWN_DAYS * DAY_NS);
        self.repay(borrower, id);
        assert!(
            self.loan(id).counted,
            "settle() expected a counted repayment"
        );
        id
    }

    fn prof(&self, who: &str) -> Profile {
        self.c.profile(acc(who)).expect("registered")
    }

    fn bal(&self, who: &str) -> u128 {
        self.c.ft_balance_of(acc(who)).0
    }

    fn loan(&self, id: u64) -> LoanView {
        self.c.get_loan(id).expect("loan exists")
    }

    fn stats(&self) -> Stats {
        self.c.stats()
    }
}

/// Parses `EVENT_JSON:` logs into JSON values.
fn events() -> Vec<serde_json::Value> {
    get_logs()
        .iter()
        .filter_map(|l| l.strip_prefix("EVENT_JSON:"))
        .map(|j| serde_json::from_str(j).unwrap())
        .collect()
}

fn event_names() -> Vec<String> {
    events()
        .iter()
        .map(|e| e["event"].as_str().unwrap().to_string())
        .collect()
}

// ---------------------------------------------------------------------------
// rules / metadata
// ---------------------------------------------------------------------------

#[test]
fn rules_match_interface() {
    let t = T::new();
    let r = serde_json::to_value(t.c.rules()).unwrap();
    assert_eq!(
        r["demo_time"],
        serde_json::json!(cfg!(feature = "demo-time"))
    );
    let day = if cfg!(feature = "demo-time") {
        "60000000000"
    } else {
        "86400000000000"
    };
    assert_eq!(r["day_ns"], day);
    assert_eq!(r["join_deposit"], "10000000000000000000000");
    assert_eq!(r["starting_limit"], "1000");
    assert_eq!(r["max_limit"], "100000");
    assert_eq!(r["min_limit"], "100");
    assert_eq!(r["min_loan"], "100");
    assert_eq!(r["max_loan"], "100000");
    assert_eq!(r["min_days"], 2);
    assert_eq!(r["max_days"], 30);
    assert_eq!(r["max_open_loans_per_borrower"], 5);
    assert_eq!(r["first_loan_cap"], "1000");
    assert_eq!(r["bonus_bps"], 1000);
    assert_eq!(r["bonus_base_cap"], "1000");
    assert_eq!(r["bonus_pool_cap"], "10000000");
    assert_eq!(r["bonus_min_age_days"], 1);
    assert_eq!(r["pair_cooldown_days"], 7);
    assert_eq!(r["borrower_count_cooldown_days"], 1);
    assert_eq!(r["trust_on_time_borrower"], 10);
    assert_eq!(r["trust_on_time_lender"], 5);
    assert_eq!(r["trust_overdue_borrower"], -20);
    assert_eq!(r["trust_overdue_lender"], -10);
    assert_eq!(r["trust_late_repay_borrower"], 5);
    assert_eq!(r["trust_late_repay_lender"], 2);
    assert_eq!(r["level_step"], 50);
    assert_eq!(r["barangays"].as_array().unwrap().len(), 27);
    assert_eq!(r.as_object().unwrap().len(), 26);
}

#[test]
fn metadata_and_empty_supply() {
    let t = T::new();
    let m = t.c.ft_metadata();
    assert_eq!(m.name, "Utang");
    assert_eq!(m.symbol, "UTANG");
    assert_eq!(m.decimals, 2);
    assert_eq!(m.spec, "ft-1.0.0");
    assert_eq!(t.c.ft_total_supply().0, 0);
}

// ---------------------------------------------------------------------------
// NEP-145 registration
// ---------------------------------------------------------------------------

#[test]
fn registration_creates_profile_and_emits_event() {
    let mut t = T::new();
    t.at_dep(&acc("ana"), JOIN_DEPOSIT);
    let sb = t.c.storage_deposit(None, None);
    assert_eq!(sb.total, JOIN_DEPOSIT);
    assert_eq!(sb.available.as_yoctonear(), 0);
    assert!(
        get_created_receipts().is_empty(),
        "exact deposit: no refund"
    );

    let ev = events();
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["standard"], "utang");
    assert_eq!(ev[0]["version"], "1.0.0");
    assert_eq!(ev[0]["event"], "player_joined");
    assert_eq!(ev[0]["data"][0]["account_id"], "ana.testnet");
    assert_eq!(ev[0]["data"][0]["player_index"], 0);

    let p = t.prof("ana");
    assert_eq!(p.trust, 0);
    assert_eq!(p.level, 1);
    assert_eq!(p.lending_limit.0, STARTING_LIMIT);
    assert_eq!(p.player_index, 0);
    assert_eq!(p.joined_at.0, T0);
    assert_eq!(p.badges, vec!["founding_neighbour".to_string()]);
    assert_eq!(t.bal("ana"), 0);
    assert!(t.c.storage_balance_of(acc("ana")).is_some());
    assert!(t.c.storage_balance_of(acc("nobody")).is_none());
    assert!(t.c.profile(acc("nobody")).is_none());

    let b = t.c.storage_balance_bounds();
    assert_eq!(b.min, JOIN_DEPOSIT);
    assert_eq!(b.max, Some(JOIN_DEPOSIT));

    t.join("ben");
    assert_eq!(t.prof("ben").player_index, 1);
    assert_eq!(t.stats().players, 2);
}

#[test]
fn registration_refunds_excess_and_reregister_is_noop() {
    let mut t = T::new();
    t.at_dep(&acc("ana"), NearToken::from_millinear(50));
    t.c.storage_deposit(None, Some(true));
    let r = get_created_receipts();
    assert_eq!(r.len(), 1);
    assert_eq!(r[0].receiver_id, acc("ana"));
    assert!(
        matches!(r[0].actions[0], MockAction::Transfer { deposit, .. } if deposit == NearToken::from_millinear(40))
    );

    // Re-register: full refund, nothing changes.
    t.at_dep(&acc("ana"), JOIN_DEPOSIT);
    let sb = t.c.storage_deposit(None, None);
    assert_eq!(sb.total, JOIN_DEPOSIT);
    let r = get_created_receipts();
    assert_eq!(r.len(), 1);
    assert!(
        matches!(r[0].actions[0], MockAction::Transfer { deposit, .. } if deposit == JOIN_DEPOSIT)
    );
    assert!(events().is_empty());
    assert_eq!(t.stats().players, 1);
    assert_eq!(t.c.players(None, None).len(), 1);
}

#[test]
fn registration_for_another_account() {
    let mut t = T::new();
    t.at_dep(&acc("ana"), JOIN_DEPOSIT);
    t.c.storage_deposit(Some(acc("ben")), None);
    assert!(t.c.profile(acc("ben")).is_some());
    assert!(t.c.profile(acc("ana")).is_none());
}

#[test]
fn registration_requires_join_deposit() {
    let mut t = T::new();
    t.at_dep(
        &acc("ana"),
        NearToken::from_yoctonear(JOIN_DEPOSIT.as_yoctonear() - 1),
    );
    expect_panic(|| t.c.storage_deposit(None, None), ERR_DEPOSIT);
    assert!(t.c.profile(acc("ana")).is_none());
}

#[test]
fn leaving_is_not_supported() {
    let mut t = T::with(&["ana"]);
    t.at_dep(&acc("ana"), ONE_YOCTO);
    expect_panic(|| t.c.storage_withdraw(None), ERR_LEAVING);
    t.at_dep(&acc("ana"), ONE_YOCTO);
    expect_panic(|| t.c.storage_unregister(Some(true)), ERR_LEAVING);
}

// ---------------------------------------------------------------------------
// ask
// ---------------------------------------------------------------------------

#[test]
fn ask_creates_requested_loan() {
    let mut t = T::with(&["ana", "ben"]);
    let id = t.ask("ben", "ana", 1000, 7);
    assert_eq!(id, 0);
    let ev = events();
    assert_eq!(ev[0]["event"], "loan_asked");
    assert_eq!(ev[0]["data"][0]["loan_id"], 0);
    assert_eq!(ev[0]["data"][0]["amount"], "1000");

    let v = serde_json::to_value(t.loan(0)).unwrap();
    assert_eq!(v["id"], 0);
    assert_eq!(v["lender"], "ana.testnet");
    assert_eq!(v["borrower"], "ben.testnet");
    assert_eq!(v["amount"], "1000");
    assert_eq!(v["days"], 7);
    assert_eq!(v["status"], "Requested");
    assert_eq!(v["requested_at"], T0.to_string());
    assert!(v["approved_at"].is_null());
    assert!(v["due_at"].is_null());
    assert!(v["closed_at"].is_null());
    assert_eq!(v["bonus_paid"], "0");
    assert_eq!(v["past_due"], false);
    assert_eq!(t.ask("ben", "ana", 100, 2), 1);
    assert_eq!(t.stats().requested_loans, 2);
    assert_eq!(t.c.get_loan(99), None);
}

#[test]
fn ask_with_one_yocto_is_accepted() {
    let mut t = T::with(&["ana", "ben"]);
    t.at_dep(&acc("ben"), ONE_YOCTO);
    assert_eq!(t.c.ask(acc("ana"), U128(500), 3), 0);
}

#[test]
fn ask_validation() {
    let mut t = T::with(&["ana", "ben"]);
    t.at(&acc("ben"));
    expect_panic(|| t.c.ask(acc("ben"), U128(1000), 7), ERR_SELF_LOAN);
    t.at(&acc("stranger"));
    expect_panic(|| t.c.ask(acc("ana"), U128(1000), 7), ERR_NOT_REGISTERED);
    t.at(&acc("ben"));
    expect_panic(
        || t.c.ask(acc("stranger"), U128(1000), 7),
        ERR_LENDER_NOT_REGISTERED,
    );
    expect_panic(|| t.c.ask(acc("ana"), U128(99), 7), ERR_AMOUNT);
    expect_panic(|| t.c.ask(acc("ana"), U128(100_001), 7), ERR_AMOUNT);
    expect_panic(|| t.c.ask(acc("ana"), U128(0), 7), ERR_AMOUNT);
    expect_panic(|| t.c.ask(acc("ana"), U128(1000), 0), ERR_DAYS);
    expect_panic(|| t.c.ask(acc("ana"), U128(1000), 1), ERR_DAYS);
    expect_panic(|| t.c.ask(acc("ana"), U128(1000), 31), ERR_DAYS);
    // Boundaries are fine.
    assert_eq!(t.c.ask(acc("ana"), U128(100), 2), 0);
    // A new pair is limited by pair credit (checked after amount and days).
    expect_panic(
        || t.c.ask(acc("ana"), U128(100_000), 30),
        "Credit between you two is at most 10.00 right now",
    );
    assert_eq!(t.c.ask(acc("ana"), U128(FIRST_LOAN_CAP), 30), 1);
    assert_eq!(t.stats().requested_loans, 2);
}

#[test]
fn ask_max_open_loans_counts_requested_and_active() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    let first = t.lend("ana", "ben", 500, 7); // Active
    for _ in 0..4 {
        t.ask("ben", "cy", 100, 7); // Requested
    }
    t.at(&acc("ben"));
    expect_panic(|| t.c.ask(acc("ana"), U128(100), 7), ERR_TOO_MANY_OPEN);
    // Repaying frees a slot.
    t.repay("ben", first);
    t.ask("ben", "ana", 100, 7);
    t.at(&acc("ben"));
    expect_panic(|| t.c.ask(acc("ana"), U128(100), 7), ERR_TOO_MANY_OPEN);
}

#[test]
fn ask_blocked_for_borrower_with_past_due_loan() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    let id = t.lend("ana", "ben", 500, 2);
    t.advance(2 * DAY_NS + 1); // past due, not marked
    t.at(&acc("ben"));
    expect_panic(|| t.c.ask(acc("cy"), U128(100), 7), ERR_BAYAD_MUNA);
    t.mark("cy", id);
    t.at(&acc("ben"));
    expect_panic(|| t.c.ask(acc("cy"), U128(100), 7), ERR_BAYAD_MUNA);
    t.repay("ben", id);
    t.ask("ben", "cy", 100, 7);
}

// ---------------------------------------------------------------------------
// decline / cancel
// ---------------------------------------------------------------------------

#[test]
fn decline_by_lender_only() {
    let mut t = T::with(&["ana", "ben"]);
    let id = t.ask("ben", "ana", 500, 7);
    t.at(&acc("ben"));
    expect_panic(|| t.c.decline(id), ERR_NOT_LENDER);
    t.advance(10);
    t.at(&acc("ana"));
    t.c.decline(id);
    assert_eq!(event_names(), vec!["loan_declined"]);
    let l = t.loan(id);
    assert_eq!(l.status, LoanStatus::Declined);
    assert_eq!(l.closed_at, Some(U64(T0 + 10)));
    assert_eq!(t.stats().requested_loans, 0);
    t.at(&acc("ana"));
    expect_panic(|| t.c.decline(id), ERR_NOT_REQUESTED);
    t.at(&acc("ana"));
    expect_panic(|| t.c.approve(id), ERR_NOT_REQUESTED);
    t.at(&acc("ben"));
    expect_panic(|| t.c.cancel(id), ERR_NOT_REQUESTED);
    t.at(&acc("ana"));
    expect_panic(|| t.c.decline(42), ERR_LOAN_NOT_FOUND);
}

#[test]
fn cancel_by_borrower_only_and_frees_slot() {
    let mut t = T::with(&["ana", "ben"]);
    let ids: Vec<u64> = (0..5).map(|_| t.ask("ben", "ana", 100, 3)).collect();
    t.at(&acc("ana"));
    expect_panic(|| t.c.cancel(ids[0]), ERR_NOT_BORROWER);
    t.at(&acc("ben"));
    t.c.cancel(ids[0]);
    assert_eq!(event_names(), vec!["loan_cancelled"]);
    assert_eq!(t.loan(ids[0]).status, LoanStatus::Cancelled);
    assert!(t.loan(ids[0]).closed_at.is_some());
    assert_eq!(t.stats().requested_loans, 4);
    t.ask("ben", "ana", 100, 3); // slot freed
    t.at(&acc("ben"));
    expect_panic(|| t.c.cancel(ids[0]), ERR_NOT_REQUESTED);
    // Cannot cancel after approval.
    t.approve("ana", ids[1]);
    t.at(&acc("ben"));
    expect_panic(|| t.c.cancel(ids[1]), ERR_NOT_REQUESTED);
}

// ---------------------------------------------------------------------------
// approve
// ---------------------------------------------------------------------------

#[test]
fn approve_mints_to_borrower() {
    let mut t = T::with(&["ana", "ben"]);
    let id = t.ask("ben", "ana", 1000, 7);
    t.at(&acc("ben"));
    expect_panic(|| t.c.approve(id), ERR_NOT_LENDER);
    t.advance(5);
    t.approve("ana", id);
    let ev = events();
    assert_eq!(ev[0]["standard"], "nep141");
    assert_eq!(ev[0]["event"], "ft_mint");
    assert_eq!(ev[0]["data"][0]["owner_id"], "ben.testnet");
    assert_eq!(ev[0]["data"][0]["amount"], "1000");
    assert_eq!(ev[1]["event"], "loan_approved");

    let l = t.loan(id);
    assert_eq!(l.status, LoanStatus::Active);
    assert_eq!(l.approved_at, Some(U64(T0 + 5)));
    assert_eq!(l.due_at, Some(U64(T0 + 5 + 7 * DAY_NS)));
    assert!(!l.past_due);
    assert_eq!(t.bal("ben"), 1000);
    assert_eq!(t.c.ft_total_supply().0, 1000);
    let a = t.prof("ana");
    assert_eq!(a.lent_out.0, 1000);
    assert_eq!(a.loans_made, 1);
    assert_eq!(t.prof("ben").borrowed_out.0, 1000);
    let s = t.stats();
    assert_eq!(s.total_lent.0, 1000);
    assert_eq!(s.outstanding.0, 1000);
    assert_eq!(s.active_loans, 1);
    assert_eq!(s.requested_loans, 0);
    t.at(&acc("ana"));
    expect_panic(|| t.c.approve(id), ERR_NOT_REQUESTED);
}

#[test]
fn approve_respects_lending_limit() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    let a = t.ask("ben", "ana", 600, 7);
    let b = t.ask("cy", "ana", 500, 7);
    let c = t.ask("cy", "ana", 400, 7);
    t.approve("ana", a);
    t.at(&acc("ana"));
    expect_panic(|| t.c.approve(b), ERR_OVER_LIMIT); // 600 + 500 > 1000
    t.approve("ana", c); // 600 + 400 == 1000 OK
    assert_eq!(t.prof("ana").lent_out.0, 1000);
    // A quick (non-counted) repay frees capacity but does not grow the limit.
    t.repay("ben", a);
    assert!(!t.loan(a).counted);
    assert_eq!(t.prof("ana").lending_limit.0, 1000);
    assert_eq!(t.prof("ana").lent_out.0, 400);
    t.approve("ana", b);
    assert_eq!(t.prof("ana").lent_out.0, 900);
    // A counted repay grows the limit by the amount.
    t.advance(2 * DAY_NS);
    t.repay("cy", c);
    assert!(t.loan(c).counted);
    assert_eq!(t.prof("ana").lending_limit.0, 1400);
    assert_eq!(t.prof("ana").lent_out.0, 500);
}

#[test]
fn approve_blocked_when_borrower_past_due() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    let first = t.lend("cy", "ben", 100, 2);
    let second = t.ask("ben", "ana", 100, 7);
    t.advance(2 * DAY_NS + 1);
    t.at(&acc("ana"));
    expect_panic(|| t.c.approve(second), ERR_BAYAD_MUNA_BORROWER);
    t.repay("ben", first);
    t.approve("ana", second);
}

// ---------------------------------------------------------------------------
// repay on time + bonus
// ---------------------------------------------------------------------------

#[test]
fn repay_on_time_with_bonus() {
    let mut t = T::with(&["ana", "ben"]);
    let id = t.lend("ana", "ben", 1000, 7);
    assert!(!t.loan(id).counted);
    t.advance(2 * DAY_NS);
    t.repay("ben", id);

    assert_eq!(
        event_names(),
        vec!["ft_burn", "loan_repaid", "ft_mint", "ft_mint", "bonus_paid"]
    );
    let ev = events();
    assert_eq!(ev[0]["standard"], "nep141");
    assert_eq!(ev[0]["data"][0]["owner_id"], "ben.testnet");
    assert_eq!(ev[0]["data"][0]["amount"], "1000");
    assert_eq!(ev[1]["data"][0]["counted"], true);
    assert_eq!(ev[4]["data"][0]["lender_bonus"], "50");
    assert_eq!(ev[4]["data"][0]["borrower_bonus"], "50");

    let l = t.loan(id);
    assert_eq!(l.status, LoanStatus::Repaid);
    assert!(l.counted);
    assert_eq!(serde_json::to_value(&l).unwrap()["counted"], true);
    assert_eq!(l.bonus_paid.0, 100);
    assert_eq!(l.closed_at, Some(U64(t.now)));
    assert_eq!(t.bal("ana"), 50);
    assert_eq!(t.bal("ben"), 50);
    let a = t.prof("ana");
    let b = t.prof("ben");
    assert_eq!((b.trust, a.trust), (10, 5));
    assert_eq!(a.lending_limit.0, 2000);
    assert_eq!(a.lent_out.0, 0);
    assert_eq!(a.loans_made_repaid, 1);
    assert_eq!(b.loans_repaid_on_time, 1);
    assert_eq!(b.borrowed_out.0, 0);
    assert_eq!(b.badges, vec!["founding_neighbour", "first_repay"]);
    let s = t.stats();
    assert_eq!(s.total_supply.0, 100);
    assert_eq!(s.bonus_minted.0, 100);
    assert_eq!(s.bonus_pool_left.0, BONUS_POOL_CAP - 100);
    assert_eq!(s.total_repaid_on_time.0, 1000);
    assert_eq!(s.outstanding.0, 0);
    assert_eq!(s.active_loans, 0);
    assert_eq!(s.trust_index_bps, 10_000);

    t.at(&acc("ben"));
    expect_panic(|| t.c.repay(id), ERR_NOT_OPEN);
}

#[test]
fn repay_at_exact_due_time_is_on_time() {
    let mut t = T::with(&["ana", "ben"]);
    let id = t.lend("ana", "ben", 1000, 3);
    t.advance(3 * DAY_NS);
    assert!(!t.loan(id).past_due);
    t.repay("ben", id);
    assert_eq!(t.loan(id).status, LoanStatus::Repaid);
}

#[test]
fn bonus_odd_centavo_goes_to_borrower() {
    let mut t = T::with(&["ana", "ben"]);
    let id = t.lend("ana", "ben", 150, 7); // bonus 15
    t.advance(2 * DAY_NS);
    t.repay("ben", id);
    assert_eq!(t.bal("ana"), 7);
    assert_eq!(t.bal("ben"), 8);
    assert_eq!(t.loan(id).bonus_paid.0, 15);
}

#[test]
fn repay_validation() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    let req = t.ask("ben", "ana", 500, 7);
    t.at(&acc("ben"));
    expect_panic(|| t.c.repay(req), ERR_NOT_OPEN);
    t.approve("ana", req);
    t.at(&acc("ana"));
    expect_panic(|| t.c.repay(req), ERR_NOT_BORROWER);
    t.transfer("ben", "cy", 1);
    t.at(&acc("ben"));
    expect_panic(|| t.c.repay(req), ERR_BALANCE);
    t.transfer("cy", "ben", 1);
    t.repay("ben", req);
}

#[test]
fn quick_repay_does_not_count() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    let id = t.lend("ana", "ben", 1000, 7);
    t.advance(BONUS_MIN_AGE_DAYS * DAY_NS - 1);
    t.repay("ben", id);
    assert_eq!(event_names(), vec!["ft_burn", "loan_repaid"]);
    assert_eq!(events()[1]["data"][0]["counted"], false);
    let l = t.loan(id);
    assert_eq!(l.status, LoanStatus::Repaid);
    assert!(!l.counted);
    assert_eq!(l.bonus_paid.0, 0);
    assert!(l.closed_at.is_some());
    assert_eq!(t.c.ft_total_supply().0, 0);
    // No trust, no limit growth, no counters; the loan is simply closed.
    let a = t.prof("ana");
    let b = t.prof("ben");
    assert_eq!((b.trust, a.trust), (0, 0));
    assert_eq!(a.lending_limit.0, STARTING_LIMIT);
    assert_eq!(a.lent_out.0, 0);
    assert_eq!(a.loans_made_repaid, 0);
    assert_eq!(b.loans_repaid_on_time, 0);
    assert_eq!(b.borrowed_out.0, 0);
    assert_eq!(b.badges, vec!["founding_neighbour"]);
    // Principal still counts as repaid on time in the global stats.
    assert_eq!(t.stats().total_repaid_on_time.0, 1000);
    assert_eq!(t.stats().active_loans, 0);

    // Exactly at min age: counts (the non-counted repay set no cooldown).
    let id2 = t.lend("ana", "ben", 1000, 7);
    t.advance(BONUS_MIN_AGE_DAYS * DAY_NS);
    t.repay("ben", id2);
    assert!(t.loan(id2).counted);
    assert_eq!(t.loan(id2).bonus_paid.0, 100);
    assert_eq!(t.prof("ben").trust, 10);
    assert_eq!(t.prof("ana").lending_limit.0, 2000);
}

#[test]
fn lend_and_repay_loop_cannot_pump_limit_or_trust() {
    let mut t = T::with(&["ana", "ben"]);
    for _ in 0..20 {
        let id = t.lend("ana", "ben", 1000, 2);
        t.advance(60_000_000_000.min(DAY_NS / 2)); // well under a day
        t.repay("ben", id);
    }
    assert_eq!(t.prof("ana").lending_limit.0, STARTING_LIMIT);
    assert_eq!(t.prof("ana").trust, 0);
    assert_eq!(t.prof("ben").trust, 0);
    assert_eq!(t.stats().bonus_minted.0, 0);
}

#[test]
fn pair_cooldown_applies_to_unordered_pair() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    // ana -> ben, counted
    let l1 = t.lend("ana", "ben", 1000, 7);
    t.advance(2 * DAY_NS);
    t.repay("ben", l1);
    assert!(t.loan(l1).counted);
    let t1 = t.now;

    // ben -> ana within the cooldown: not counted (same unordered pair).
    let l2 = t.lend("ben", "ana", 500, 7);
    t.advance(2 * DAY_NS);
    t.repay("ana", l2);
    let l = t.loan(l2);
    assert_eq!(l.status, LoanStatus::Repaid);
    assert!(!l.counted);
    assert_eq!(l.bonus_paid.0, 0);
    assert_eq!(t.prof("ana").trust, 5); // only from l1 as lender
    assert_eq!(t.prof("ben").trust, 10); // only from l1 as borrower
    assert_eq!(t.prof("ben").lending_limit.0, STARTING_LIMIT);

    // A different pair is not affected.
    let l3 = t.lend("cy", "ana", 500, 7);
    t.advance(2 * DAY_NS);
    t.repay("ana", l3);
    assert!(t.loan(l3).counted);
    assert_eq!(t.loan(l3).bonus_paid.0, 50);

    // ana -> ben repaid just before the pair cooldown ends: still not counted.
    let l4 = t.lend("ana", "ben", 100, 7);
    t.now = t1 + PAIR_COOLDOWN_DAYS * DAY_NS - 1;
    t.repay("ben", l4);
    assert!(!t.loan(l4).counted);

    // After the cooldown: counts again, in the other direction.
    let l5 = t.lend("ben", "ana", 200, 7);
    t.advance(DAY_NS);
    assert!(t.now >= t1 + PAIR_COOLDOWN_DAYS * DAY_NS);
    t.repay("ana", l5);
    assert!(t.loan(l5).counted);
    assert_eq!(t.loan(l5).bonus_paid.0, 20);
    assert_eq!(t.prof("ben").lending_limit.0, STARTING_LIMIT + 200);
}

#[test]
fn borrower_counts_at_most_one_repayment_per_day() {
    let mut t = T::with(&["ana", "ben", "cy", "dee", "eve"]);
    let la = t.lend("ana", "ben", 100, 7);
    let lc = t.lend("cy", "ben", 100, 7);
    let ld = t.lend("dee", "ben", 100, 7);
    let le = t.lend("eve", "ben", 100, 7);
    t.advance(2 * DAY_NS);
    let first = t.now;
    t.repay("ben", la);
    t.repay("ben", lc); // second counted repayment for ben within a day: no
    assert!(t.loan(la).counted);
    assert!(!t.loan(lc).counted);
    assert_eq!(t.prof("ben").trust, 10);
    assert_eq!(t.prof("cy").trust, 0);
    assert_eq!(t.prof("cy").lending_limit.0, STARTING_LIMIT);
    assert_eq!(t.prof("cy").lent_out.0, 0);
    assert_eq!(t.loan(lc).bonus_paid.0, 0);

    t.now = first + BORROWER_COUNT_COOLDOWN_DAYS * DAY_NS - 1;
    t.repay("ben", le);
    assert!(!t.loan(le).counted);

    t.now = first + BORROWER_COUNT_COOLDOWN_DAYS * DAY_NS;
    t.repay("ben", ld);
    assert!(t.loan(ld).counted);
    assert_eq!(t.prof("ben").trust, 20);
    assert_eq!(t.prof("ben").loans_repaid_on_time, 2);
    assert_eq!(t.prof("dee").lending_limit.0, STARTING_LIMIT + 100);
}

#[test]
fn bonus_is_capped_at_one_utang_per_loan() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    // Step pair credit up to 50.00 with counted repayments (each pays at most 1.00).
    for amount in [1000, 2000, 3000, 4000] {
        let id = t.settle("ana", "cy", amount);
        assert_eq!(t.loan(id).bonus_paid.0, 100);
    }
    assert_eq!(t.prof("ana").lending_limit.0, 11_000);
    assert_eq!(t.c.pair_credit(acc("ana"), acc("cy")).cap.0, 5000);
    let ana_before = t.bal("ana");
    let cy_before = t.bal("cy");

    let id = t.lend("ana", "cy", 5000, 30); // 50.00
    t.advance(PAIR_COOLDOWN_DAYS * DAY_NS);
    t.repay("cy", id);
    let l = t.loan(id);
    assert!(l.counted);
    assert_eq!(l.bonus_paid.0, 100); // 1.00, not 5.00
    assert_eq!(t.bal("ana") - ana_before, 50);
    assert_eq!(t.bal("cy") - cy_before, 50);
    assert_eq!(t.prof("ana").lending_limit.0, 16_000);
}

#[test]
fn bonus_pool_exhaustion_and_partial_last_bonus() {
    let mut t = T::with(&["ana", "ben", "cy", "dee"]);
    // Simulate a nearly empty pool (test-only direct state access; no runtime admin path).
    t.c.bonus_minted = BONUS_POOL_CAP - 15;
    assert_eq!(t.stats().bonus_pool_left.0, 15);

    let l1 = t.lend("ana", "ben", 1000, 7); // full bonus would be 100
    t.advance(2 * DAY_NS);
    t.repay("ben", l1);
    assert_eq!(t.loan(l1).bonus_paid.0, 15);
    assert_eq!(t.bal("ana"), 7);
    assert_eq!(t.bal("ben"), 8);
    let s = t.stats();
    assert_eq!(s.bonus_pool_left.0, 0);
    assert_eq!(s.bonus_minted.0, BONUS_POOL_CAP);

    // Pool empty: a counted repay still gets trust and limit growth, but no bonus.
    let l2 = t.lend("cy", "dee", 1000, 7);
    t.advance(2 * DAY_NS);
    t.repay("dee", l2);
    let l = t.loan(l2);
    assert_eq!(l.status, LoanStatus::Repaid);
    assert!(l.counted);
    assert_eq!(l.bonus_paid.0, 0);
    assert_eq!(t.prof("dee").trust, 10);
    assert_eq!(t.prof("cy").trust, 5);
    assert_eq!(t.prof("cy").lending_limit.0, 2000);
    assert_eq!(t.prof("dee").loans_repaid_on_time, 1);
    assert_eq!(t.bal("dee"), 0);
    assert_eq!(event_names(), vec!["ft_burn", "loan_repaid"]);
    assert_eq!(t.stats().bonus_minted.0, BONUS_POOL_CAP);

    // The pair cooldown is recorded even though no bonus was minted.
    let l3 = t.lend("dee", "cy", 500, 7);
    t.advance(2 * DAY_NS);
    t.repay("cy", l3);
    assert!(!t.loan(l3).counted);
    assert_eq!(t.prof("dee").lending_limit.0, STARTING_LIMIT);
}

// ---------------------------------------------------------------------------
// mark_overdue
// ---------------------------------------------------------------------------

#[test]
fn mark_overdue_preconditions() {
    let mut t = T::with(&["ana", "ben"]);
    let id = t.ask("ben", "ana", 500, 2);
    t.at(&acc("ana"));
    expect_panic(|| t.c.mark_overdue(id), ERR_NOT_ACTIVE); // Requested
    t.approve("ana", id);
    t.at(&acc("ana"));
    expect_panic(|| t.c.mark_overdue(id), ERR_NOT_DUE);
    t.advance(2 * DAY_NS); // exactly at due_at: not yet past due
    t.at(&acc("ana"));
    expect_panic(|| t.c.mark_overdue(id), ERR_NOT_DUE);
    t.advance(1);
    t.mark("ana", id);
    t.at(&acc("ana"));
    expect_panic(|| t.c.mark_overdue(id), ERR_NOT_ACTIVE); // already Overdue
    t.at(&acc("ana"));
    expect_panic(|| t.c.mark_overdue(999), ERR_LOAN_NOT_FOUND);
}

#[test]
fn mark_overdue_effects_and_no_registration_needed() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    // Build some trust first so the penalties are visible.
    for _ in 0..3 {
        t.settle("ana", "ben", 100);
    }
    assert_eq!(t.prof("ben").trust, 30);
    assert_eq!(t.prof("ana").trust, 15);
    assert_eq!(t.prof("ana").lending_limit.0, 1300);

    let id = t.lend("ana", "ben", 500, 2);
    t.advance(2 * DAY_NS + 1);
    assert!(t.loan(id).past_due);
    assert_eq!(t.loan(id).status, LoanStatus::Active);
    assert!(t.prof("ben").has_overdue);

    // A stranger with no registration marks it.
    t.mark("stranger", id);
    assert_eq!(event_names(), vec!["loan_overdue"]);
    let l = t.loan(id);
    assert_eq!(l.status, LoanStatus::Overdue);
    assert!(l.past_due);
    let a = t.prof("ana");
    let b = t.prof("ben");
    assert_eq!(b.trust, 10);
    assert_eq!(b.loans_overdue, 1);
    assert_eq!(b.borrowed_out.0, 500);
    assert!(b.has_overdue);
    assert_eq!(a.trust, 5);
    assert_eq!(a.lending_limit.0, 650);
    assert_eq!(a.lent_out.0, 0);
    assert!(t.c.profile(acc("stranger")).is_none());

    let s = t.stats();
    assert_eq!(s.outstanding.0, 500);
    assert_eq!(s.overdue_outstanding.0, 500);
    assert_eq!(s.active_loans, 0);
    // 300 on time / (300 + 0 + 500)
    assert_eq!(s.trust_index_bps, 3750);
    assert_eq!(t.c.overdue().len(), 1);
}

// ---------------------------------------------------------------------------
// transfers: bayad muna
// ---------------------------------------------------------------------------

#[test]
fn transfers_blocked_while_past_due_even_before_mark() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    let id = t.lend("ana", "ben", 1000, 2);
    t.transfer("ben", "cy", 100); // before due: fine
    assert_eq!(t.bal("cy"), 100);
    assert_eq!(event_names(), vec!["ft_transfer"]);

    t.advance(2 * DAY_NS + 1); // past due, nobody marked it
    t.at_dep(&acc("ben"), ONE_YOCTO);
    expect_panic(
        || t.c.ft_transfer(acc("cy"), U128(10), None),
        ERR_BAYAD_MUNA,
    );
    t.at_dep(&acc("ben"), ONE_YOCTO);
    expect_panic(
        || {
            t.c.ft_transfer_call(acc("cy"), U128(10), None, String::new())
        },
        ERR_BAYAD_MUNA,
    );

    // Still blocked once marked.
    t.mark("cy", id);
    t.at_dep(&acc("ben"), ONE_YOCTO);
    expect_panic(
        || t.c.ft_transfer(acc("cy"), U128(10), None),
        ERR_BAYAD_MUNA,
    );

    // Can still receive coins and repay.
    t.transfer("cy", "ben", 100);
    assert_eq!(t.bal("ben"), 1000);
    t.repay("ben", id);
    assert_eq!(t.loan(id).status, LoanStatus::RepaidLate);
    assert!(!t.prof("ben").has_overdue);

    // Allowed again after repaying (and borrowing is allowed again too).
    t.lend("cy", "ben", 100, 7);
    t.transfer("ben", "cy", 5);
    assert_eq!(t.bal("ben"), 95);
}

#[test]
fn transfers_allowed_again_after_repaying() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    let id = t.lend("ana", "ben", 1000, 2);
    let other = t.lend("cy", "ben", 500, 7);
    t.advance(2 * DAY_NS + 1);
    t.at_dep(&acc("ben"), ONE_YOCTO);
    expect_panic(
        || t.c.ft_transfer(acc("cy"), U128(10), None),
        ERR_BAYAD_MUNA,
    );
    t.repay("ben", id); // late repay of the past-due loan; `other` is still on time
    t.transfer("ben", "cy", 10);
    assert_eq!(t.bal("ben"), 490);
    assert_eq!(t.bal("cy"), 10);
    assert!(!t.loan(other).past_due);
}

#[test]
fn transfers_need_one_yocto_and_registered_receiver() {
    let mut t = T::with(&["ana", "ben"]);
    t.lend("ana", "ben", 1000, 7);
    t.at(&acc("ben"));
    expect_panic(
        || t.c.ft_transfer(acc("ana"), U128(10), None),
        "Requires attached deposit of exactly 1 yoctoNEAR",
    );
    t.at_dep(&acc("ben"), ONE_YOCTO);
    expect_panic(
        || t.c.ft_transfer(acc("stranger"), U128(10), None),
        "is not registered",
    );
}

// ---------------------------------------------------------------------------
// late repay
// ---------------------------------------------------------------------------

#[test]
fn late_repay_without_prior_mark_applies_penalty_first() {
    let mut t = T::with(&["ana", "ben"]);
    for _ in 0..3 {
        t.settle("ana", "ben", 100);
    }
    // ben 30, ana 15, ana limit 1300
    let id = t.lend("ana", "ben", 500, 2);
    t.advance(2 * DAY_NS + 1);
    t.repay("ben", id);
    assert_eq!(
        event_names(),
        vec!["loan_overdue", "ft_burn", "loan_repaid_late"]
    );
    let l = t.loan(id);
    assert_eq!(l.status, LoanStatus::RepaidLate);
    assert_eq!(l.bonus_paid.0, 0);
    assert!(!l.past_due);
    let a = t.prof("ana");
    let b = t.prof("ben");
    assert_eq!(b.trust, 30 - 20 + 5);
    assert_eq!(a.trust, 15 - 10 + 2);
    assert_eq!(b.loans_overdue, 1);
    assert_eq!(b.loans_repaid_late, 1);
    assert_eq!(b.borrowed_out.0, 0);
    assert_eq!(a.lending_limit.0, 650);
    assert_eq!(a.lent_out.0, 0);
    assert_eq!(a.loans_made_repaid, 3);
    let s = t.stats();
    assert_eq!(s.total_repaid_late.0, 500);
    assert_eq!(s.outstanding.0, 0);
    assert_eq!(s.overdue_outstanding.0, 0);
    assert_eq!(s.active_loans, 0);
    assert_eq!(s.total_supply.0, 30); // only the three 0.10 bonuses remain
    assert!(!l.counted);
    // 300 / (300 + 500)
    assert_eq!(s.trust_index_bps, 3750);
}

#[test]
fn late_repay_after_mark_does_not_double_penalise() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    for _ in 0..3 {
        t.settle("ana", "ben", 100);
    }
    let id = t.lend("ana", "ben", 500, 2);
    t.advance(3 * DAY_NS);
    t.mark("cy", id);
    t.advance(DAY_NS);
    t.repay("ben", id);
    assert_eq!(event_names(), vec!["ft_burn", "loan_repaid_late"]);
    let a = t.prof("ana");
    let b = t.prof("ben");
    assert_eq!(b.trust, 15);
    assert_eq!(a.trust, 7);
    assert_eq!(b.loans_overdue, 1);
    assert_eq!(a.lending_limit.0, 650);
    assert_eq!(t.loan(id).status, LoanStatus::RepaidLate);
    assert_eq!(t.loan(id).closed_at, Some(U64(t.now)));
}

#[test]
fn trust_never_below_zero() {
    let mut t = T::with(&["ana", "ben"]);
    let id = t.lend("ana", "ben", 100, 2);
    t.advance(2 * DAY_NS + 1);
    t.mark("ana", id);
    assert_eq!(t.prof("ben").trust, 0);
    assert_eq!(t.prof("ana").trust, 0);
    t.repay("ben", id);
    assert_eq!(t.prof("ben").trust, 5);
    assert_eq!(t.prof("ana").trust, 2);
    // Another overdue from 5 / 2 floors at 0 again.
    let id = t.lend("ana", "ben", 100, 2);
    t.advance(2 * DAY_NS + 1);
    t.mark("ana", id);
    assert_eq!(t.prof("ben").trust, 0);
    assert_eq!(t.prof("ana").trust, 0);
}

#[test]
fn lending_limit_halving_floors_at_min_limit() {
    let mut t = T::with(&["ana", "ben"]);
    let mut seen = Vec::new();
    for _ in 0..5 {
        let id = t.lend("ana", "ben", 100, 2);
        t.advance(2 * DAY_NS + 1);
        t.mark("ben", id);
        seen.push(t.prof("ana").lending_limit.0);
        t.repay("ben", id);
        assert_eq!(t.prof("ana").lent_out.0, 0);
    }
    assert_eq!(seen, vec![500, 250, 125, 100, 100]);
}

#[test]
fn lending_limit_capped_at_max_limit() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    // Grow ana's limit: each on-time repay adds the amount.
    let mut amount = 1000;
    while t.prof("ana").lending_limit.0 < MAX_LIMIT {
        let lim = t.prof("ana").lending_limit.0;
        let cap = t.c.pair_credit(acc("ana"), acc("ben")).cap.0;
        amount = lim.min(cap).min(MAX_LOAN);
        t.settle("ana", "ben", amount);
    }
    assert_eq!(t.prof("ana").lending_limit.0, MAX_LIMIT);
    assert!(amount > 0);
    t.settle("ana", "cy", 100);
    assert_eq!(t.prof("ana").lending_limit.0, MAX_LIMIT);
}

// ---------------------------------------------------------------------------
// badges, levels
// ---------------------------------------------------------------------------

#[test]
fn badges_progression() {
    let mut t = T::with(&["ana", "ben"]);
    let has = |p: &Profile, b: &str| p.badges.iter().any(|x| x == b);
    for i in 1..=10u32 {
        t.settle("ana", "ben", 100);
        let b = t.prof("ben");
        let a = t.prof("ana");
        assert!(has(&b, "first_repay"));
        assert_eq!(has(&b, "never_late"), i >= 3);
        assert_eq!(has(&b, "ten_on_time"), i >= 10);
        assert_eq!(has(&b, "trusted"), i >= 10);
        assert_eq!(has(&a, "good_lender"), i >= 5);
        assert!(!has(&a, "first_repay"));
    }
    let b = t.prof("ben");
    assert_eq!(b.trust, 100);
    assert_eq!(b.level, 3);
    assert_eq!(t.prof("ana").trust, 50);
    assert_eq!(t.prof("ana").level, 2);
    assert_eq!(
        b.badges,
        vec![
            "founding_neighbour",
            "first_repay",
            "ten_on_time",
            "never_late",
            "trusted"
        ]
    );

    // One overdue: never_late and trusted are lost.
    let id = t.lend("ana", "ben", 100, 2);
    t.advance(2 * DAY_NS + 1);
    t.mark("ana", id);
    let b = t.prof("ben");
    assert_eq!(b.trust, 80);
    assert_eq!(b.level, 2);
    assert!(!has(&b, "never_late"));
    assert!(!has(&b, "trusted"));
    assert!(has(&b, "ten_on_time"));
}

#[test]
fn founding_neighbour_only_first_fifty() {
    let mut t = T::new();
    for i in 0..51 {
        t.join(&format!("p{i}"));
    }
    assert!(t
        .prof("p49")
        .badges
        .contains(&"founding_neighbour".to_string()));
    assert!(t.prof("p50").badges.is_empty());
    assert_eq!(t.prof("p50").player_index, 50);
}

// ---------------------------------------------------------------------------
// stats
// ---------------------------------------------------------------------------

#[test]
fn stats_and_trust_index() {
    let mut t = T::with(&["ana", "ben", "cy", "dee"]);
    let s = t.stats();
    assert_eq!(s.trust_index_bps, 10_000);
    assert_eq!(s.players, 4);
    assert_eq!(s.total_supply.0, 0);
    assert_eq!(s.bonus_pool_left.0, BONUS_POOL_CAP);

    let on_time = t.lend("ana", "ben", 1000, 7);
    let late = t.lend("cy", "dee", 500, 3);
    let _req = t.ask("ben", "cy", 200, 3);
    let s = t.stats();
    assert_eq!(s.active_loans, 2);
    assert_eq!(s.requested_loans, 1);
    assert_eq!(s.outstanding.0, 1500);
    assert_eq!(s.total_lent.0, 1500);
    assert_eq!(s.total_supply.0, 1500);

    t.advance(2 * DAY_NS);
    t.repay("ben", on_time); // bonus 100
    t.advance(2 * DAY_NS); // `late` past due, unmarked: still counts as overdue outstanding
    let s = t.stats();
    assert_eq!(s.overdue_outstanding.0, 500);
    assert_eq!(s.outstanding.0, 500);
    assert_eq!(s.active_loans, 1);
    assert_eq!(s.trust_index_bps, (1000 * 10_000 / 1500) as u32); // 6666
    assert_eq!(s.total_supply.0, 500 + 100);
    assert_eq!(s.bonus_minted.0, 100);
    assert_eq!(
        t.c.overdue().iter().map(|l| l.id).collect::<Vec<_>>(),
        vec![late]
    );

    t.mark("ana", late);
    let s = t.stats();
    assert_eq!(s.active_loans, 0);
    assert_eq!(s.overdue_outstanding.0, 500);
    t.repay("dee", late);
    let s = t.stats();
    assert_eq!(s.overdue_outstanding.0, 0);
    assert_eq!(s.total_repaid_late.0, 500);
    assert_eq!(s.trust_index_bps, (1000 * 10_000 / 1500) as u32);
    assert_eq!(s.total_supply.0, 100);
    // Supply invariant: supply <= outstanding + bonus minted.
    assert!(s.total_supply.0 <= s.outstanding.0 + s.bonus_minted.0);
    assert!(t.c.overdue().is_empty());
    let v = serde_json::to_value(&s).unwrap();
    assert_eq!(v["total_supply"], "100");
    assert_eq!(v["trust_index_bps"], 6666);
}

// ---------------------------------------------------------------------------
// listahan / loans_of / players / leaderboard
// ---------------------------------------------------------------------------

#[test]
fn listahan_newest_first_with_pagination() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    for i in 0..7u64 {
        if i % 2 == 0 {
            t.ask("ben", "ana", 100 + i as u128, 3);
        } else {
            t.ask("cy", "ana", 100 + i as u128, 3);
        }
        if i == 4 {
            // keep ben under the open-loan cap
            t.at(&acc("ben"));
            t.c.cancel(0);
        }
    }
    let ids = |v: Vec<LoanView>| v.into_iter().map(|l| l.id).collect::<Vec<_>>();
    assert_eq!(ids(t.c.listahan(None, None)), vec![6, 5, 4, 3, 2, 1, 0]);
    assert_eq!(ids(t.c.listahan(Some(2), Some(3))), vec![4, 3, 2]);
    assert_eq!(ids(t.c.listahan(Some(5), Some(10))), vec![1, 0]);
    assert_eq!(ids(t.c.listahan(Some(7), None)), Vec::<u64>::new());
    assert_eq!(ids(t.c.listahan(Some(100), Some(5))), Vec::<u64>::new());
    assert_eq!(ids(t.c.listahan(None, Some(0))), Vec::<u64>::new());

    assert_eq!(ids(t.c.loans_of(acc("ben"))), vec![6, 4, 2, 0]);
    assert_eq!(ids(t.c.loans_of(acc("cy"))), vec![5, 3, 1]);
    assert_eq!(ids(t.c.loans_of(acc("ana"))), vec![6, 5, 4, 3, 2, 1, 0]);
    assert!(t.c.loans_of(acc("nobody")).is_empty());
    assert_eq!(t.c.listahan(None, None)[6].status, LoanStatus::Cancelled);
}

#[test]
fn listahan_default_limit_is_50() {
    let mut t = T::new();
    for i in 0..12 {
        t.join(&format!("p{i}"));
    }
    // 11 borrowers x 5 asks = 55 loans
    for i in 1..12 {
        for _ in 0..5 {
            t.ask(&format!("p{i}"), "p0", 100, 3);
        }
    }
    let page = t.c.listahan(None, None);
    assert_eq!(page.len(), 50);
    assert_eq!(page[0].id, 54);
    assert_eq!(page[49].id, 5);
}

#[test]
fn players_in_join_order_with_pagination() {
    let t = T::with(&["ana", "ben", "cy", "dee"]);
    let names = |v: Vec<Profile>| {
        v.into_iter()
            .map(|p| p.account_id.to_string())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        names(t.c.players(None, None)),
        vec!["ana.testnet", "ben.testnet", "cy.testnet", "dee.testnet"]
    );
    assert_eq!(
        names(t.c.players(Some(1), Some(2))),
        vec!["ben.testnet", "cy.testnet"]
    );
    assert!(t.c.players(Some(4), None).is_empty());
}

#[test]
fn leaderboard_ordering() {
    let mut t = T::with(&["ana", "ben", "cy", "dee", "eve"]);
    // ben repays ana twice: ben 20, ana 10 (0 on-time as borrower)
    for _ in 0..2 {
        t.settle("ana", "ben", 100);
    }
    // cy repays dee once: cy 10 (1 on-time), dee 5
    t.settle("dee", "cy", 100);

    let names = |v: Vec<Profile>| {
        v.into_iter()
            .map(|p| p.account_id.to_string())
            .collect::<Vec<_>>()
    };
    assert_eq!(
        names(t.c.leaderboard(None)),
        vec![
            "ben.testnet",
            "cy.testnet",
            "ana.testnet",
            "dee.testnet",
            "eve.testnet"
        ]
    );
    assert_eq!(
        names(t.c.leaderboard(Some(2))),
        vec!["ben.testnet", "cy.testnet"]
    );
}

#[test]
fn leaderboard_default_limit_is_20() {
    let mut t = T::new();
    for i in 0..25 {
        t.join(&format!("p{i}"));
    }
    let lb = t.c.leaderboard(None);
    assert_eq!(lb.len(), 20);
    // all tied at 0: join order
    assert_eq!(lb[0].player_index, 0);
    assert_eq!(lb[19].player_index, 19);
}

#[test]
fn profile_json_shape() {
    let mut t = T::with(&["ana", "ben"]);
    t.lend("ana", "ben", 300, 7);
    let v = serde_json::to_value(t.prof("ben")).unwrap();
    for k in [
        "account_id",
        "balance",
        "trust",
        "level",
        "lending_limit",
        "lent_out",
        "borrowed_out",
        "loans_repaid_on_time",
        "loans_repaid_late",
        "loans_overdue",
        "loans_made",
        "loans_made_repaid",
        "has_overdue",
        "joined_at",
        "player_index",
        "badges",
        "barangay",
    ] {
        assert!(v.get(k).is_some(), "missing {k}");
    }
    assert_eq!(v.as_object().unwrap().len(), 17);
    assert!(v["barangay"].is_null());
    assert_eq!(v["balance"], "300");
    assert_eq!(v["borrowed_out"], "300");
    assert_eq!(v["lending_limit"], "1000");
    assert_eq!(v["joined_at"], T0.to_string());
    assert_eq!(v["trust"], 0);
    assert_eq!(v["has_overdue"], false);
}

#[test]
fn day_scaled_rules_use_day_ns() {
    // Guards that every day-based rule scales with DAY_NS (both builds run this).
    let mut t = T::with(&["ana", "ben"]);
    let id = t.lend("ana", "ben", 100, 30);
    assert_eq!(t.loan(id).due_at.unwrap().0, T0 + 30 * DAY_NS);
    assert_eq!(t.c.rules().day_ns.0, DAY_NS);
    if cfg!(feature = "demo-time") {
        assert_eq!(DAY_NS, 60_000_000_000);
    } else {
        assert_eq!(DAY_NS, 86_400_000_000_000);
    }
}

#[test]
fn ask_rejects_deposit_above_one_yocto() {
    let mut t = T::with(&["ana", "ben"]);
    t.at_dep(&acc("ben"), NearToken::from_yoctonear(2));
    expect_panic(
        || t.c.ask(acc("ana"), U128(500), 3),
        "ask takes no deposit (at most 1 yoctoNEAR)",
    );
}

// ---------------------------------------------------------------------------
// step-by-step pair credit
// ---------------------------------------------------------------------------

fn credit_err(cap: &str) -> String {
    format!("Credit between you two is at most {cap} right now")
}

#[test]
fn format_utang_amounts() {
    assert_eq!(format_utang(0), "0.00");
    assert_eq!(format_utang(5), "0.05");
    assert_eq!(format_utang(1000), "10.00");
    assert_eq!(format_utang(2001), "20.01");
    assert_eq!(format_utang(100_000), "1,000.00");
    assert_eq!(format_utang(123_456_789), "1,234,567.89");
}

#[test]
fn new_pair_credit_is_ten() {
    let mut t = T::with(&["ana", "ben"]);
    t.at(&acc("ben"));
    expect_panic(
        || t.c.ask(acc("ana"), U128(FIRST_LOAN_CAP + 1), 7),
        &credit_err("10.00"),
    );
    let id = t.ask("ben", "ana", FIRST_LOAN_CAP, 7); // 10.00 is fine
                                                     // approve re-checks pair credit (defensive): force an over-cap request into state.
    t.c.loans.get_mut(id as u32).unwrap().amount = FIRST_LOAN_CAP + 1;
    t.at(&acc("ana"));
    expect_panic(|| t.c.approve(id), &credit_err("10.00"));
    t.c.loans.get_mut(id as u32).unwrap().amount = FIRST_LOAN_CAP;
    t.approve("ana", id);
    assert_eq!(t.bal("ben"), FIRST_LOAN_CAP);
}

#[test]
fn pair_credit_steps_up_with_counted_repayments_both_directions() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    t.settle("ana", "ben", 1000); // 1 counted repayment; ana limit 2000
    let pc = t.c.pair_credit(acc("ben"), acc("ana"));
    assert_eq!(pc.counted_repayments, 1);
    assert_eq!(pc.cap.0, 2000);
    assert_eq!(t.c.pair_credit(acc("ana"), acc("ben")), pc);

    // 20.00 now, in both directions.
    t.at(&acc("ben"));
    expect_panic(|| t.c.ask(acc("ana"), U128(2001), 7), &credit_err("20.00"));
    t.at(&acc("ana"));
    expect_panic(|| t.c.ask(acc("ben"), U128(2001), 7), &credit_err("20.00"));
    let x = t.ask("ben", "ana", 2000, 30);
    t.approve("ana", x);
    t.advance(PAIR_COOLDOWN_DAYS * DAY_NS);
    t.repay("ben", x);
    assert!(t.loan(x).counted);

    // 2 counted repayments: 30.00.
    let pc = t.c.pair_credit(acc("ana"), acc("ben"));
    assert_eq!(pc.counted_repayments, 2);
    assert_eq!(pc.cap.0, 3000);
    t.at(&acc("ana"));
    expect_panic(|| t.c.ask(acc("ben"), U128(3001), 7), &credit_err("30.00"));
    // Within pair credit, but the lender's limit still applies (ben's limit is 10.00).
    let rev = t.ask("ana", "ben", 3000, 7);
    t.at(&acc("ben"));
    expect_panic(|| t.c.approve(rev), ERR_OVER_LIMIT);

    // Other pairs are unaffected.
    t.at(&acc("cy"));
    expect_panic(|| t.c.ask(acc("ana"), U128(1001), 7), &credit_err("10.00"));
    assert_eq!(t.c.pair_credit(acc("ana"), acc("cy")).counted_repayments, 0);
}

#[test]
fn uncounted_and_late_repayments_do_not_raise_pair_credit() {
    let mut t = T::with(&["ana", "ben"]);
    // Quick (uncounted) repayment.
    let id = t.lend("ana", "ben", 1000, 7);
    t.advance(DAY_NS / 2);
    t.repay("ben", id);
    assert!(!t.loan(id).counted);
    assert_eq!(
        t.c.pair_credit(acc("ana"), acc("ben")).counted_repayments,
        0
    );
    t.at(&acc("ben"));
    expect_panic(|| t.c.ask(acc("ana"), U128(1001), 7), &credit_err("10.00"));
    t.at(&acc("ana"));
    expect_panic(|| t.c.ask(acc("ben"), U128(1001), 7), &credit_err("10.00"));
    // Late repayment.
    let late = t.lend("ana", "ben", 1000, 2);
    t.advance(2 * DAY_NS + 1);
    t.repay("ben", late);
    assert_eq!(t.loan(late).status, LoanStatus::RepaidLate);
    let pc = t.c.pair_credit(acc("ben"), acc("ana"));
    assert_eq!(pc.counted_repayments, 0);
    assert_eq!(pc.cap.0, FIRST_LOAN_CAP);
    t.at(&acc("ben"));
    expect_panic(|| t.c.ask(acc("ana"), U128(1001), 7), &credit_err("10.00"));
}

#[test]
fn pair_credit_view_shape_and_unregistered_accounts() {
    let t = T::with(&["ana"]);
    let v = serde_json::to_value(t.c.pair_credit(acc("ana"), acc("nobody"))).unwrap();
    assert_eq!(
        v,
        serde_json::json!({ "counted_repayments": 0, "cap": "1000" })
    );
    let v = serde_json::to_value(t.c.pair_credit(acc("x"), acc("y"))).unwrap();
    assert_eq!(
        v,
        serde_json::json!({ "counted_repayments": 0, "cap": "1000" })
    );
}

// ---------------------------------------------------------------------------
// barangays
// ---------------------------------------------------------------------------

fn names(v: Vec<Profile>) -> Vec<String> {
    v.into_iter().map(|p| p.account_id.to_string()).collect()
}

#[test]
fn rules_list_the_27_barangays_in_order() {
    let t = T::new();
    let r = serde_json::to_value(t.c.rules()).unwrap();
    let list: Vec<String> = r["barangays"]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_str().unwrap().to_string())
        .collect();
    let expected = [
        "Addition Hills",
        "Bagong Silang",
        "Barangka Drive",
        "Barangka Ibaba",
        "Barangka Ilaya",
        "Barangka Itaas",
        "Buayang Bato",
        "Burol",
        "Daang Bakal",
        "Hagdang Bato Itaas",
        "Hagdang Bato Libis",
        "Harapin ang Bukas",
        "Highway Hills",
        "Hulo",
        "Mabini-J. Rizal",
        "Malamig",
        "Mauway",
        "Namayan",
        "New Zañiga",
        "Old Zañiga",
        "Pag-asa",
        "Plainview",
        "Pleasant Hills",
        "Poblacion",
        "San Jose",
        "Vergara",
        "Wack-Wack Greenhills",
    ];
    assert_eq!(list, expected);
    // Precomposed U+00F1, as in INTERFACE.md.
    assert_eq!(list[18].as_bytes(), b"New Za\xc3\xb1iga");
}

#[test]
fn set_barangay_and_read_it_back() {
    let mut t = T::with(&["ana", "ben"]);
    assert_eq!(t.prof("ana").barangay, None);
    t.at(&acc("ana"));
    t.c.set_barangay("Hulo".to_string());
    let ev = events();
    assert_eq!(ev.len(), 1);
    assert_eq!(ev[0]["standard"], "utang");
    assert_eq!(ev[0]["event"], "barangay_set");
    assert_eq!(ev[0]["data"][0]["account_id"], "ana.testnet");
    assert_eq!(ev[0]["data"][0]["barangay"], "Hulo");
    assert_eq!(t.prof("ana").barangay.as_deref(), Some("Hulo"));
    let v = serde_json::to_value(t.prof("ana")).unwrap();
    assert_eq!(v["barangay"], "Hulo");
    let v = serde_json::to_value(t.prof("ben")).unwrap();
    assert!(v["barangay"].is_null());
    assert_eq!(
        names(t.c.players_in("Hulo".to_string(), None, None)),
        vec!["ana.testnet"]
    );
    let counts = serde_json::to_value(t.c.barangay_counts()).unwrap();
    assert_eq!(counts, serde_json::json!({ "Hulo": 1 }));
}

#[test]
fn set_barangay_rejects_unknown_names_and_unregistered_callers() {
    let mut t = T::with(&["ana"]);
    t.at(&acc("ana"));
    for bad in [
        "hulo",
        "Hulo ",
        "",
        "New Zaniga",
        "New Zan\u{303}iga",
        "Mandaluyong",
    ] {
        expect_panic(|| t.c.set_barangay(bad.to_string()), ERR_UNKNOWN_BARANGAY);
    }
    assert_eq!(t.prof("ana").barangay, None);
    t.at(&acc("stranger"));
    expect_panic(|| t.c.set_barangay("Hulo".to_string()), ERR_NOT_REGISTERED);
    assert!(t.c.barangay_counts().is_empty());
}

#[test]
fn moving_between_barangays_updates_index_and_counts() {
    let mut t = T::with(&["ana", "ben", "cy"]);
    let set = |t: &mut T, who: &str, b: &str| {
        t.at(&acc(who));
        t.c.set_barangay(b.to_string());
    };
    set(&mut t, "ben", "Hulo");
    set(&mut t, "ana", "Hulo");
    set(&mut t, "cy", "Burol");
    assert_eq!(
        names(t.c.players_in("Hulo".to_string(), None, None)),
        vec!["ana.testnet", "ben.testnet"] // join order, not the order they picked
    );
    set(&mut t, "ana", "Burol");
    assert_eq!(
        names(t.c.players_in("Hulo".to_string(), None, None)),
        vec!["ben.testnet"]
    );
    assert_eq!(
        names(t.c.players_in("Burol".to_string(), None, None)),
        vec!["ana.testnet", "cy.testnet"]
    );
    assert_eq!(
        serde_json::to_value(t.c.barangay_counts()).unwrap(),
        serde_json::json!({ "Burol": 2, "Hulo": 1 })
    );
    // Setting the same barangay again changes nothing but still emits the event.
    set(&mut t, "ana", "Burol");
    assert_eq!(event_names(), vec!["barangay_set"]);
    assert_eq!(t.c.barangay_counts().get("Burol"), Some(&2));
    // Last one leaves: the barangay disappears from the counts.
    set(&mut t, "ben", "Burol");
    assert!(t.c.players_in("Hulo".to_string(), None, None).is_empty());
    assert_eq!(
        serde_json::to_value(t.c.barangay_counts()).unwrap(),
        serde_json::json!({ "Burol": 3 })
    );
    assert_eq!(
        names(t.c.players_in("Burol".to_string(), None, None)),
        vec!["ana.testnet", "ben.testnet", "cy.testnet"]
    );
}

#[test]
fn players_in_pagination_and_unknown_barangay() {
    let mut t = T::new();
    for i in 0..7 {
        t.join(&format!("p{i}"));
    }
    t.join("other");
    for i in (0..7).rev() {
        t.at(&acc(&format!("p{i}")));
        t.c.set_barangay("Namayan".to_string());
    }
    let all = names(t.c.players_in("Namayan".to_string(), None, None));
    assert_eq!(
        all,
        (0..7).map(|i| format!("p{i}.testnet")).collect::<Vec<_>>()
    );
    assert_eq!(
        names(t.c.players_in("Namayan".to_string(), Some(2), Some(3))),
        vec!["p2.testnet", "p3.testnet", "p4.testnet"]
    );
    assert_eq!(
        names(t.c.players_in("Namayan".to_string(), Some(5), Some(10))),
        vec!["p5.testnet", "p6.testnet"]
    );
    assert!(t
        .c
        .players_in("Namayan".to_string(), Some(7), None)
        .is_empty());
    assert!(t
        .c
        .players_in("Namayan".to_string(), None, Some(0))
        .is_empty());
    assert!(t
        .c
        .players_in("Atlantis".to_string(), None, None)
        .is_empty());
    assert!(t.c.players_in("Vergara".to_string(), None, None).is_empty());
}

#[test]
fn players_in_default_limit_is_50() {
    let mut t = T::new();
    for i in 0..55 {
        let who = format!("p{i}");
        t.join(&who);
        t.at(&acc(&who));
        t.c.set_barangay("Malamig".to_string());
    }
    let page = t.c.players_in("Malamig".to_string(), None, None);
    assert_eq!(page.len(), 50);
    assert_eq!(page[49].player_index, 49);
    assert_eq!(t.c.barangay_counts().get("Malamig"), Some(&55));
}

#[test]
fn enye_barangay_names() {
    let mut t = T::with(&["ana", "ben"]);
    t.at(&acc("ana"));
    t.c.set_barangay("Old Zañiga".to_string());
    t.at(&acc("ben"));
    t.c.set_barangay("New Za\u{f1}iga".to_string());
    assert_eq!(t.prof("ana").barangay.as_deref(), Some("Old Zañiga"));
    assert_eq!(events()[0]["data"][0]["barangay"], "New Zañiga");
    assert_eq!(
        names(t.c.players_in("Old Zañiga".to_string(), None, None)),
        vec!["ana.testnet"]
    );
    assert_eq!(
        names(t.c.players_in("New Zañiga".to_string(), None, None)),
        vec!["ben.testnet"]
    );
    assert!(t
        .c
        .players_in("Old Zaniga".to_string(), None, None)
        .is_empty());
    let counts = serde_json::to_value(t.c.barangay_counts()).unwrap();
    assert_eq!(
        counts,
        serde_json::json!({ "New Zañiga": 1, "Old Zañiga": 1 })
    );
}

#[test]
fn join_deposit_covers_worst_case_player_storage() {
    let mut t = T::with(&["ana"]);
    // Worst case: 64-character account id, first player in a barangay (new index entry),
    // with the longest barangay name. Then a second move to another empty barangay.
    let long: AccountId = "a".repeat(64).parse().unwrap();
    let before = env::storage_usage();
    t.at_dep(&long, JOIN_DEPOSIT);
    t.c.storage_deposit(None, None);
    t.at(&long);
    t.c.set_barangay("Wack-Wack Greenhills".to_string());
    t.c.set_barangay("Hagdang Bato Itaas".to_string());
    // Persist cached store collections so their bytes are counted.
    t.c.profiles.flush();
    t.c.players.flush();
    t.c.barangay_members.flush();
    let used = env::storage_usage() - before;
    let cost = env::storage_byte_cost().as_yoctonear() * used as u128;
    println!("worst-case player storage: {used} bytes, {cost} yocto");
    assert!(
        cost <= JOIN_DEPOSIT.as_yoctonear(),
        "{used} bytes exceed the join deposit"
    );
}

// ---------------------------------------------------------------------------
// minimum term
// ---------------------------------------------------------------------------

#[test]
fn shortest_loan_can_count() {
    assert_eq!(MIN_DAYS, 2);
    assert!(MIN_DAYS as u64 > BONUS_MIN_AGE_DAYS);
    assert_eq!(ERR_DAYS, "Days must be between 2 and 30");
    let mut t = T::with(&["ana", "ben"]);
    let id = t.lend("ana", "ben", 500, MIN_DAYS);
    t.advance(BONUS_MIN_AGE_DAYS * DAY_NS); // age exactly 1 day, still a day before due
    assert!(!t.loan(id).past_due);
    t.repay("ben", id);
    let l = t.loan(id);
    assert_eq!(l.status, LoanStatus::Repaid);
    assert!(l.counted);
    assert_eq!(l.bonus_paid.0, 50);
    assert_eq!(t.prof("ben").trust, 10);
    assert_eq!(t.prof("ana").lending_limit.0, 1500);

    // Repaid on the due date itself also counts.
    t.advance(PAIR_COOLDOWN_DAYS * DAY_NS);
    let id = t.lend("ana", "ben", 500, MIN_DAYS);
    t.advance(MIN_DAYS as u64 * DAY_NS);
    t.repay("ben", id);
    assert!(t.loan(id).counted);
}
