//! $UTANG: the neighbourhood trust game.
//!
//! A NEP-141 token with no starting supply. Coins are minted only when one
//! neighbour approves a loan to another, burned when the loan is repaid, and a
//! small capped bonus is minted for on-time repayments. Trust is a
//! non-transferable score stored per player.
//!
//! There is no owner, no admin and no method that changes parameters.
//! See `docs/INTERFACE.md` for the authoritative interface.

use near_contract_standards::fungible_token::events::{FtBurn, FtMint};
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::{
    FungibleToken, FungibleTokenCore, FungibleTokenResolver,
};
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::{U128, U64};
use near_sdk::store::{IterableSet, LazyOption, LookupMap, Vector};
use near_sdk::{
    env, near, require, serde_json, AccountId, BorshStorageKey, NearToken, PanicOnDefault, Promise,
    PromiseOrValue,
};
use std::collections::BTreeMap;

#[cfg(test)]
mod tests;

// ---------------------------------------------------------------------------
// Constants (fixed at deploy, returned by `rules()`)
// ---------------------------------------------------------------------------

/// One "day" in nanoseconds. 24 h normally, 60 s with the `demo-time` feature.
#[cfg(not(feature = "demo-time"))]
pub const DAY_NS: u64 = 86_400_000_000_000;
#[cfg(feature = "demo-time")]
pub const DAY_NS: u64 = 60_000_000_000;
pub const DEMO_TIME: bool = cfg!(feature = "demo-time");

/// 0.01 NEAR.
pub const JOIN_DEPOSIT: NearToken = NearToken::from_yoctonear(10_000_000_000_000_000_000_000);

pub const STARTING_LIMIT: u128 = 1_000; // 10.00
pub const MAX_LIMIT: u128 = 100_000; // 1,000.00
pub const MIN_LIMIT: u128 = 100; // 1.00
pub const MIN_LOAN: u128 = 100; // 1.00
pub const MAX_LOAN: u128 = 100_000; // 1,000.00
pub const MIN_DAYS: u32 = 2;
pub const MAX_DAYS: u32 = 30;
pub const MAX_OPEN_LOANS_PER_BORROWER: u32 = 5;
/// Pair credit step (10.00): a pair may borrow at most FIRST_LOAN_CAP * (1 + counted repayments).
pub const FIRST_LOAN_CAP: u128 = 1_000;
pub const BONUS_BPS: u128 = 1_000; // 10%
pub const BONUS_POOL_CAP: u128 = 10_000_000; // 100,000.00
/// The bonus is computed on at most this much of a loan (10.00), so at most 1.00 per loan.
pub const BONUS_BASE_CAP: u128 = 1_000;
pub const BONUS_MIN_AGE_DAYS: u64 = 1;
pub const PAIR_COOLDOWN_DAYS: u64 = 7;
pub const BORROWER_COUNT_COOLDOWN_DAYS: u64 = 1;
pub const TRUST_ON_TIME_BORROWER: i32 = 10;
pub const TRUST_ON_TIME_LENDER: i32 = 5;
pub const TRUST_OVERDUE_BORROWER: i32 = -20;
pub const TRUST_OVERDUE_LENDER: i32 = -10;
pub const TRUST_LATE_REPAY_BORROWER: i32 = 5;
pub const TRUST_LATE_REPAY_LENDER: i32 = 2;
pub const LEVEL_STEP: u32 = 50;

/// The 27 barangays of Mandaluyong City (names as in OpenStreetMap). Order is part of the interface.
pub const BARANGAYS: [&str; 27] = [
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
    "New Za\u{f1}iga",
    "Old Za\u{f1}iga",
    "Pag-asa",
    "Plainview",
    "Pleasant Hills",
    "Poblacion",
    "San Jose",
    "Vergara",
    "Wack-Wack Greenhills",
];

pub const DEFAULT_PAGE_LIMIT: u64 = 50;
pub const DEFAULT_LEADERBOARD_LIMIT: u64 = 20;

pub const EVENT_STANDARD: &str = "utang";
pub const EVENT_VERSION: &str = "1.0.0";

// Panic messages
pub const ERR_BAYAD_MUNA: &str = "Bayad muna: you have an overdue loan";
pub const ERR_BAYAD_MUNA_BORROWER: &str = "Bayad muna: the borrower has an overdue loan";
pub const ERR_LEAVING: &str = "Leaving the neighbourhood is not supported";
pub const ERR_NOT_REGISTERED: &str = "You are not registered: call storage_deposit first";
pub const ERR_LENDER_NOT_REGISTERED: &str = "The lender is not registered";
pub const ERR_SELF_LOAN: &str = "You cannot borrow from yourself";
pub const ERR_AMOUNT: &str = "Amount must be between 1.00 and 1,000.00 UTANG";
pub const ERR_DAYS: &str = "Days must be between 2 and 30";
pub const ERR_TOO_MANY_OPEN: &str = "Too many open loans: at most 5 requested or active";
pub const ERR_LOAN_NOT_FOUND: &str = "Loan not found";
pub const ERR_NOT_LENDER: &str = "Only the lender can do this";
pub const ERR_NOT_BORROWER: &str = "Only the borrower can do this";
pub const ERR_NOT_REQUESTED: &str = "Loan is not in Requested status";
pub const ERR_NOT_OPEN: &str = "Loan is not Active or Overdue";
pub const ERR_NOT_ACTIVE: &str = "Loan is not Active";
pub const ERR_NOT_DUE: &str = "Loan is not past its due date yet";
pub const ERR_OVER_LIMIT: &str = "Over your lending limit";
/// Followed by the cap formatted like `20.00` and " right now".
pub const ERR_PAIR_CREDIT_PREFIX: &str = "Credit between you two is at most ";
pub const ERR_UNKNOWN_BARANGAY: &str = "Unknown barangay";
pub const ERR_BALANCE: &str = "Not enough UTANG to repay this loan";
pub const ERR_DEPOSIT: &str = "The join deposit is 0.01 NEAR";

const ICON: &str = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Ccircle cx='8' cy='8' r='7' fill='%23f2b705' stroke='%237a4a00'/%3E%3Ctext x='8' y='12' font-size='10' text-anchor='middle' font-family='monospace' fill='%237a4a00'%3EU%3C/text%3E%3C/svg%3E";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

#[derive(BorshStorageKey)]
#[near]
enum StorageKey {
    Token,
    Metadata,
    Players,
    Profiles,
    Loans,
    AccountLoans,
    OpenLoans,
    Pairs,
    BarangayMembers,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LoanStatus {
    Requested,
    Active,
    Overdue,
    Repaid,
    RepaidLate,
    Declined,
    Cancelled,
}

/// Loan as stored on chain.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Loan {
    pub id: u64,
    pub lender: AccountId,
    pub borrower: AccountId,
    pub amount: u128,
    pub days: u32,
    pub status: LoanStatus,
    pub requested_at: u64,
    pub approved_at: Option<u64>,
    pub due_at: Option<u64>,
    pub closed_at: Option<u64>,
    pub bonus_paid: u128,
    /// True if the repayment was a counted repayment.
    pub counted: bool,
}

impl Loan {
    /// Active and past its due date, or already marked Overdue.
    pub fn is_past_due(&self, now: u64) -> bool {
        match self.status {
            LoanStatus::Overdue => true,
            LoanStatus::Active => self.due_at.is_some_and(|due| now > due),
            _ => false,
        }
    }

    fn view(&self, now: u64) -> LoanView {
        LoanView {
            id: self.id,
            lender: self.lender.clone(),
            borrower: self.borrower.clone(),
            amount: U128(self.amount),
            days: self.days,
            status: self.status,
            requested_at: U64(self.requested_at),
            approved_at: self.approved_at.map(U64),
            due_at: self.due_at.map(U64),
            closed_at: self.closed_at.map(U64),
            bonus_paid: U128(self.bonus_paid),
            counted: self.counted,
            past_due: self.is_past_due(now),
        }
    }
}

/// Loan as returned by views (INTERFACE.md `Loan`).
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct LoanView {
    pub id: u64,
    pub lender: AccountId,
    pub borrower: AccountId,
    pub amount: U128,
    pub days: u32,
    pub status: LoanStatus,
    pub requested_at: U64,
    pub approved_at: Option<U64>,
    pub due_at: Option<U64>,
    pub closed_at: Option<U64>,
    pub bonus_paid: U128,
    pub counted: bool,
    pub past_due: bool,
}

/// Player record as stored on chain.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct Player {
    pub trust: u32,
    pub lending_limit: u128,
    pub lent_out: u128,
    pub borrowed_out: u128,
    pub loans_repaid_on_time: u32,
    pub loans_repaid_late: u32,
    pub loans_overdue: u32,
    pub loans_made: u32,
    pub loans_made_repaid: u32,
    pub joined_at: u64,
    pub player_index: u32,
    /// Loans where this player is the borrower and status is Requested, Active or Overdue.
    pub open_borrowed: Vec<u64>,
    /// Time of this player's last counted repayment as borrower.
    pub last_counted_at: Option<u64>,
    /// Index into `BARANGAYS`, or None until the player picks one.
    pub barangay: Option<u8>,
}

impl Player {
    fn add_trust(&mut self, delta: i32) {
        self.trust = if delta >= 0 {
            self.trust.saturating_add(delta as u32)
        } else {
            self.trust.saturating_sub(delta.unsigned_abs())
        };
    }
}

/// INTERFACE.md `Profile`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Profile {
    pub account_id: AccountId,
    pub balance: U128,
    pub trust: u32,
    pub level: u32,
    pub lending_limit: U128,
    pub lent_out: U128,
    pub borrowed_out: U128,
    pub loans_repaid_on_time: u32,
    pub loans_repaid_late: u32,
    pub loans_overdue: u32,
    pub loans_made: u32,
    pub loans_made_repaid: u32,
    pub has_overdue: bool,
    pub joined_at: U64,
    pub player_index: u32,
    pub badges: Vec<String>,
    pub barangay: Option<String>,
}

/// Stored per unordered pair.
#[near(serializers = [borsh])]
#[derive(Clone, Debug)]
pub struct PairRecord {
    pub last_counted_at: u64,
    pub counted_repayments: u32,
}

/// INTERFACE.md `pair_credit` result.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct PairCredit {
    pub counted_repayments: u32,
    pub cap: U128,
}

/// INTERFACE.md `Stats`.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Stats {
    pub total_supply: U128,
    pub total_lent: U128,
    pub total_repaid_on_time: U128,
    pub total_repaid_late: U128,
    pub outstanding: U128,
    pub overdue_outstanding: U128,
    pub active_loans: u32,
    pub requested_loans: u32,
    pub players: u32,
    pub bonus_minted: U128,
    pub bonus_pool_left: U128,
    pub trust_index_bps: u32,
}

/// INTERFACE.md constants object.
#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq)]
pub struct Rules {
    pub demo_time: bool,
    pub day_ns: U64,
    pub join_deposit: U128,
    pub starting_limit: U128,
    pub max_limit: U128,
    pub min_limit: U128,
    pub min_loan: U128,
    pub max_loan: U128,
    pub min_days: u32,
    pub max_days: u32,
    pub max_open_loans_per_borrower: u32,
    pub first_loan_cap: U128,
    pub bonus_bps: u32,
    pub bonus_base_cap: U128,
    pub bonus_pool_cap: U128,
    pub bonus_min_age_days: u32,
    pub pair_cooldown_days: u32,
    pub borrower_count_cooldown_days: u32,
    pub trust_on_time_borrower: i32,
    pub trust_on_time_lender: i32,
    pub trust_overdue_borrower: i32,
    pub trust_overdue_lender: i32,
    pub trust_late_repay_borrower: i32,
    pub trust_late_repay_lender: i32,
    pub level_step: u32,
    pub barangays: Vec<String>,
}

// ---------------------------------------------------------------------------
// Contract
// ---------------------------------------------------------------------------

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    metadata: LazyOption<FungibleTokenMetadata>,
    /// Players in join order.
    players: Vector<AccountId>,
    profiles: LookupMap<AccountId, Player>,
    /// All loans; index == loan id.
    loans: Vector<Loan>,
    /// Loan ids where the account is lender or borrower, oldest first.
    account_loans: LookupMap<AccountId, Vec<u64>>,
    /// Loans with status Active or Overdue.
    open_loans: IterableSet<u64>,
    /// Unordered pair (smaller id, larger id) -> counted repayments between them.
    pairs: LookupMap<(AccountId, AccountId), PairRecord>,
    /// Barangay index -> player indexes living there, sorted (= join order).
    barangay_members: LookupMap<u8, Vec<u32>>,
    /// Players per barangay, indexed like `BARANGAYS`.
    barangay_counts: Vec<u32>,
    total_lent: u128,
    total_repaid_on_time: u128,
    total_repaid_late: u128,
    /// Active + Overdue principal.
    outstanding: u128,
    bonus_minted: u128,
    requested_loans: u32,
    /// Loans whose stored status is Active.
    active_loans: u32,
}

fn emit_event(event: &str, data: serde_json::Value) {
    let ev = serde_json::json!({
        "standard": EVENT_STANDARD,
        "version": EVENT_VERSION,
        "event": event,
        "data": [data],
    });
    env::log_str(&format!("EVENT_JSON:{}", ev));
}

/// Formats centavos as UTANG with 2 decimals and thousands separators: 123456 -> "1,234.56".
pub fn format_utang(centavos: u128) -> String {
    let whole = (centavos / 100).to_string();
    let mut grouped = String::new();
    for (i, ch) in whole.chars().enumerate() {
        if i > 0 && (whole.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(ch);
    }
    format!("{}.{:02}", grouped, centavos % 100)
}

fn barangay_index(name: &str) -> Option<u8> {
    BARANGAYS.iter().position(|b| *b == name).map(|i| i as u8)
}

fn pair_key(a: &AccountId, b: &AccountId) -> (AccountId, AccountId) {
    if a <= b {
        (a.clone(), b.clone())
    } else {
        (b.clone(), a.clone())
    }
}

fn badges_for(p: &Player) -> Vec<String> {
    let mut b = Vec::new();
    if p.player_index < 50 {
        b.push("founding_neighbour");
    }
    if p.loans_repaid_on_time >= 1 {
        b.push("first_repay");
    }
    if p.loans_repaid_on_time >= 10 {
        b.push("ten_on_time");
    }
    if p.loans_repaid_on_time >= 3 && p.loans_overdue == 0 {
        b.push("never_late");
    }
    if p.loans_made_repaid >= 5 {
        b.push("good_lender");
    }
    if p.trust >= 100 {
        b.push("trusted");
    }
    b.into_iter().map(String::from).collect()
}

#[near]
impl Contract {
    #[init]
    pub fn new() -> Self {
        let metadata = FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Utang".to_string(),
            symbol: "UTANG".to_string(),
            icon: Some(ICON.to_string()),
            reference: None,
            reference_hash: None,
            decimals: 2,
        };
        metadata.assert_valid();
        Self {
            token: FungibleToken::new(StorageKey::Token),
            metadata: LazyOption::new(StorageKey::Metadata, Some(metadata)),
            players: Vector::new(StorageKey::Players),
            profiles: LookupMap::new(StorageKey::Profiles),
            loans: Vector::new(StorageKey::Loans),
            account_loans: LookupMap::new(StorageKey::AccountLoans),
            open_loans: IterableSet::new(StorageKey::OpenLoans),
            pairs: LookupMap::new(StorageKey::Pairs),
            barangay_members: LookupMap::new(StorageKey::BarangayMembers),
            barangay_counts: vec![0; BARANGAYS.len()],
            total_lent: 0,
            total_repaid_on_time: 0,
            total_repaid_late: 0,
            outstanding: 0,
            bonus_minted: 0,
            requested_loans: 0,
            active_loans: 0,
        }
    }

    // ------------------------------------------------------------------
    // Loan lifecycle
    // ------------------------------------------------------------------

    /// Borrower asks `lender` for `amount` centavos for `days` days. Returns the loan id.
    #[payable]
    pub fn ask(&mut self, lender: AccountId, amount: U128, days: u32) -> u64 {
        let borrower = env::predecessor_account_id();
        let amount = amount.0;
        let now = env::block_timestamp();
        require!(
            env::attached_deposit() <= NearToken::from_yoctonear(1),
            "ask takes no deposit (at most 1 yoctoNEAR)"
        );
        require!(borrower != lender, ERR_SELF_LOAN);
        require!(self.profiles.contains_key(&borrower), ERR_NOT_REGISTERED);
        require!(
            self.profiles.contains_key(&lender),
            ERR_LENDER_NOT_REGISTERED
        );
        require!((MIN_LOAN..=MAX_LOAN).contains(&amount), ERR_AMOUNT);
        require!((MIN_DAYS..=MAX_DAYS).contains(&days), ERR_DAYS);
        require!(!self.has_past_due(&borrower, now), ERR_BAYAD_MUNA);
        let open = self.profiles.get(&borrower).unwrap().open_borrowed.len() as u32;
        require!(open < MAX_OPEN_LOANS_PER_BORROWER, ERR_TOO_MANY_OPEN);
        self.assert_pair_credit(&lender, &borrower, amount);

        let id = self.loans.len() as u64;
        self.loans.push(Loan {
            id,
            lender: lender.clone(),
            borrower: borrower.clone(),
            amount,
            days,
            status: LoanStatus::Requested,
            requested_at: now,
            approved_at: None,
            due_at: None,
            closed_at: None,
            bonus_paid: 0,
            counted: false,
        });
        self.index_loan(&borrower, id);
        self.index_loan(&lender, id);
        self.profiles
            .get_mut(&borrower)
            .unwrap()
            .open_borrowed
            .push(id);
        self.requested_loans += 1;

        emit_event(
            "loan_asked",
            serde_json::json!({
                "loan_id": id,
                "lender": lender,
                "borrower": borrower,
                "amount": U128(amount),
                "days": days,
            }),
        );
        id
    }

    /// Lender turns down a request.
    pub fn decline(&mut self, loan_id: u64) {
        let mut loan = self.loan(loan_id);
        require!(env::predecessor_account_id() == loan.lender, ERR_NOT_LENDER);
        require!(loan.status == LoanStatus::Requested, ERR_NOT_REQUESTED);
        loan.status = LoanStatus::Declined;
        loan.closed_at = Some(env::block_timestamp());
        self.close_request(&loan);
        emit_event(
            "loan_declined",
            serde_json::json!({ "loan_id": loan_id, "lender": loan.lender, "borrower": loan.borrower }),
        );
        self.save_loan(loan);
    }

    /// Borrower withdraws a request before approval.
    pub fn cancel(&mut self, loan_id: u64) {
        let mut loan = self.loan(loan_id);
        require!(
            env::predecessor_account_id() == loan.borrower,
            ERR_NOT_BORROWER
        );
        require!(loan.status == LoanStatus::Requested, ERR_NOT_REQUESTED);
        loan.status = LoanStatus::Cancelled;
        loan.closed_at = Some(env::block_timestamp());
        self.close_request(&loan);
        emit_event(
            "loan_cancelled",
            serde_json::json!({ "loan_id": loan_id, "lender": loan.lender, "borrower": loan.borrower }),
        );
        self.save_loan(loan);
    }

    /// Lender approves: mints `amount` to the borrower and starts the term.
    pub fn approve(&mut self, loan_id: u64) {
        let mut loan = self.loan(loan_id);
        let now = env::block_timestamp();
        require!(env::predecessor_account_id() == loan.lender, ERR_NOT_LENDER);
        require!(loan.status == LoanStatus::Requested, ERR_NOT_REQUESTED);
        self.assert_pair_credit(&loan.lender, &loan.borrower, loan.amount);
        {
            let lender = self.profiles.get(&loan.lender).unwrap();
            require!(
                lender.lent_out + loan.amount <= lender.lending_limit,
                ERR_OVER_LIMIT
            );
        }
        require!(
            !self.has_past_due(&loan.borrower, now),
            ERR_BAYAD_MUNA_BORROWER
        );

        let due_at = now + loan.days as u64 * DAY_NS;
        loan.status = LoanStatus::Active;
        loan.approved_at = Some(now);
        loan.due_at = Some(due_at);

        {
            let lender = self.profiles.get_mut(&loan.lender).unwrap();
            lender.lent_out += loan.amount;
            lender.loans_made += 1;
        }
        self.profiles.get_mut(&loan.borrower).unwrap().borrowed_out += loan.amount;
        self.requested_loans -= 1;
        self.active_loans += 1;
        self.total_lent += loan.amount;
        self.outstanding += loan.amount;
        self.open_loans.insert(loan_id);

        self.mint(&loan.borrower, loan.amount, "loan");
        emit_event(
            "loan_approved",
            serde_json::json!({
                "loan_id": loan_id,
                "lender": loan.lender,
                "borrower": loan.borrower,
                "amount": U128(loan.amount),
                "due_at": U64(due_at),
            }),
        );
        self.save_loan(loan);
    }

    /// Borrower repays: burns `amount`. On time earns trust, limit growth and maybe a bonus.
    pub fn repay(&mut self, loan_id: u64) {
        let loan = self.loan(loan_id);
        let now = env::block_timestamp();
        require!(
            env::predecessor_account_id() == loan.borrower,
            ERR_NOT_BORROWER
        );
        require!(
            matches!(loan.status, LoanStatus::Active | LoanStatus::Overdue),
            ERR_NOT_OPEN
        );
        require!(
            self.token.accounts.get(&loan.borrower).unwrap_or(0) >= loan.amount,
            ERR_BALANCE
        );

        let on_time = loan.status == LoanStatus::Active && !loan.is_past_due(now);
        if !on_time && loan.status == LoanStatus::Active {
            // Past due but nobody called mark_overdue: apply the penalty first.
            self.apply_overdue(loan_id, now);
        }
        let mut loan = self.loan(loan_id);

        self.burn(&loan.borrower, loan.amount, "repay");
        self.open_loans.remove(&loan_id);
        self.outstanding -= loan.amount;
        loan.closed_at = Some(now);
        {
            let borrower = self.profiles.get_mut(&loan.borrower).unwrap();
            borrower.borrowed_out = borrower.borrowed_out.saturating_sub(loan.amount);
            borrower.open_borrowed.retain(|&id| id != loan_id);
        }

        if on_time {
            loan.status = LoanStatus::Repaid;
            self.active_loans -= 1;
            self.total_repaid_on_time += loan.amount;
            {
                let lender = self.profiles.get_mut(&loan.lender).unwrap();
                lender.lent_out = lender.lent_out.saturating_sub(loan.amount);
            }
            loan.counted = self.counts(&loan, now);
            if loan.counted {
                {
                    let borrower = self.profiles.get_mut(&loan.borrower).unwrap();
                    borrower.add_trust(TRUST_ON_TIME_BORROWER);
                    borrower.loans_repaid_on_time += 1;
                    borrower.last_counted_at = Some(now);
                }
                {
                    let lender = self.profiles.get_mut(&loan.lender).unwrap();
                    lender.add_trust(TRUST_ON_TIME_LENDER);
                    lender.loans_made_repaid += 1;
                    lender.lending_limit = MAX_LIMIT.min(lender.lending_limit + loan.amount);
                }
                let key = pair_key(&loan.lender, &loan.borrower);
                let counted = self.pairs.get(&key).map_or(0, |r| r.counted_repayments);
                self.pairs.insert(
                    key,
                    PairRecord {
                        last_counted_at: now,
                        counted_repayments: counted + 1,
                    },
                );
            }
            emit_event(
                "loan_repaid",
                serde_json::json!({
                    "loan_id": loan_id,
                    "lender": loan.lender,
                    "borrower": loan.borrower,
                    "amount": U128(loan.amount),
                    "counted": loan.counted,
                }),
            );
            if loan.counted {
                loan.bonus_paid = self.pay_bonus(&loan);
            }
        } else {
            loan.status = LoanStatus::RepaidLate;
            self.total_repaid_late += loan.amount;
            {
                let borrower = self.profiles.get_mut(&loan.borrower).unwrap();
                borrower.add_trust(TRUST_LATE_REPAY_BORROWER);
                borrower.loans_repaid_late += 1;
            }
            self.profiles
                .get_mut(&loan.lender)
                .unwrap()
                .add_trust(TRUST_LATE_REPAY_LENDER);
            emit_event(
                "loan_repaid_late",
                serde_json::json!({
                    "loan_id": loan_id,
                    "lender": loan.lender,
                    "borrower": loan.borrower,
                    "amount": U128(loan.amount),
                }),
            );
        }
        self.save_loan(loan);
    }

    /// Picks (or changes) the caller's barangay. Must exactly match one of `BARANGAYS`.
    pub fn set_barangay(&mut self, barangay: String) {
        let account_id = env::predecessor_account_id();
        let new = barangay_index(&barangay).unwrap_or_else(|| env::panic_str(ERR_UNKNOWN_BARANGAY));
        let player = self
            .profiles
            .get_mut(&account_id)
            .unwrap_or_else(|| env::panic_str(ERR_NOT_REGISTERED));
        let old = player.barangay.replace(new);
        let player_index = player.player_index;
        if old != Some(new) {
            if let Some(old) = old {
                if let Some(members) = self.barangay_members.get_mut(&old) {
                    if let Ok(pos) = members.binary_search(&player_index) {
                        members.remove(pos);
                    }
                }
                self.barangay_counts[old as usize] -= 1;
            }
            match self.barangay_members.get_mut(&new) {
                Some(members) => {
                    if let Err(pos) = members.binary_search(&player_index) {
                        members.insert(pos, player_index);
                    }
                }
                None => {
                    self.barangay_members.insert(new, vec![player_index]);
                }
            }
            self.barangay_counts[new as usize] += 1;
        }
        emit_event(
            "barangay_set",
            serde_json::json!({ "account_id": account_id, "barangay": BARANGAYS[new as usize] }),
        );
    }

    /// Anyone (registered or not) can mark an Active loan past its due date as Overdue.
    pub fn mark_overdue(&mut self, loan_id: u64) {
        let loan = self.loan(loan_id);
        let now = env::block_timestamp();
        require!(loan.status == LoanStatus::Active, ERR_NOT_ACTIVE);
        require!(loan.is_past_due(now), ERR_NOT_DUE);
        self.apply_overdue(loan_id, now);
    }

    // ------------------------------------------------------------------
    // Views
    // ------------------------------------------------------------------

    pub fn rules(&self) -> Rules {
        Rules {
            demo_time: DEMO_TIME,
            day_ns: U64(DAY_NS),
            join_deposit: U128(JOIN_DEPOSIT.as_yoctonear()),
            starting_limit: U128(STARTING_LIMIT),
            max_limit: U128(MAX_LIMIT),
            min_limit: U128(MIN_LIMIT),
            min_loan: U128(MIN_LOAN),
            max_loan: U128(MAX_LOAN),
            min_days: MIN_DAYS,
            max_days: MAX_DAYS,
            max_open_loans_per_borrower: MAX_OPEN_LOANS_PER_BORROWER,
            first_loan_cap: U128(FIRST_LOAN_CAP),
            bonus_bps: BONUS_BPS as u32,
            bonus_base_cap: U128(BONUS_BASE_CAP),
            bonus_pool_cap: U128(BONUS_POOL_CAP),
            bonus_min_age_days: BONUS_MIN_AGE_DAYS as u32,
            pair_cooldown_days: PAIR_COOLDOWN_DAYS as u32,
            borrower_count_cooldown_days: BORROWER_COUNT_COOLDOWN_DAYS as u32,
            trust_on_time_borrower: TRUST_ON_TIME_BORROWER,
            trust_on_time_lender: TRUST_ON_TIME_LENDER,
            trust_overdue_borrower: TRUST_OVERDUE_BORROWER,
            trust_overdue_lender: TRUST_OVERDUE_LENDER,
            trust_late_repay_borrower: TRUST_LATE_REPAY_BORROWER,
            trust_late_repay_lender: TRUST_LATE_REPAY_LENDER,
            level_step: LEVEL_STEP,
            barangays: BARANGAYS.iter().map(|b| b.to_string()).collect(),
        }
    }

    /// Counted repayments between `a` and `b` (either order) and the current pair credit cap.
    pub fn pair_credit(&self, a: AccountId, b: AccountId) -> PairCredit {
        PairCredit {
            counted_repayments: self.pair_counted(&a, &b),
            cap: U128(self.pair_cap(&a, &b)),
        }
    }

    pub fn get_loan(&self, loan_id: u64) -> Option<LoanView> {
        let now = env::block_timestamp();
        self.loans
            .get(u32::try_from(loan_id).ok()?)
            .map(|l| l.view(now))
    }

    /// Loans where `account_id` is lender or borrower, newest first.
    pub fn loans_of(&self, account_id: AccountId) -> Vec<LoanView> {
        let now = env::block_timestamp();
        self.account_loans
            .get(&account_id)
            .map(|ids| {
                ids.iter()
                    .rev()
                    .filter_map(|&id| self.loans.get(id as u32))
                    .map(|l| l.view(now))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// All loans, newest first. `from_index` counts from the newest loan (0 = newest).
    pub fn listahan(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<LoanView> {
        let now = env::block_timestamp();
        let n = self.loans.len() as u64;
        let from = from_index.unwrap_or(0);
        let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT);
        (0..n)
            .rev()
            .skip(from.min(n) as usize)
            .take(limit.min(n) as usize)
            .filter_map(|i| self.loans.get(i as u32))
            .map(|l| l.view(now))
            .collect()
    }

    /// Loans that are past due (marked Overdue, or Active past their due date), oldest id first.
    pub fn overdue(&self) -> Vec<LoanView> {
        let now = env::block_timestamp();
        let mut out: Vec<LoanView> = self
            .open_loans
            .iter()
            .filter_map(|&id| self.loans.get(id as u32))
            .filter(|l| l.is_past_due(now))
            .map(|l| l.view(now))
            .collect();
        out.sort_by_key(|l| l.id);
        out
    }

    pub fn profile(&self, account_id: AccountId) -> Option<Profile> {
        let now = env::block_timestamp();
        self.profiles
            .get(&account_id)
            .map(|p| self.profile_view(&account_id, p, now))
    }

    /// Registered players in join order.
    pub fn players(&self, from_index: Option<u64>, limit: Option<u64>) -> Vec<Profile> {
        let now = env::block_timestamp();
        let n = self.players.len() as u64;
        let from = from_index.unwrap_or(0).min(n);
        let limit = limit.unwrap_or(DEFAULT_PAGE_LIMIT);
        (from..n)
            .take(limit.min(n) as usize)
            .filter_map(|i| self.players.get(i as u32))
            .filter_map(|a| self.profiles.get(a).map(|p| self.profile_view(a, p, now)))
            .collect()
    }

    /// Players whose barangay is `barangay`, in join order. Unknown names give an empty list.
    pub fn players_in(
        &self,
        barangay: String,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<Profile> {
        let now = env::block_timestamp();
        let Some(b) = barangay_index(&barangay) else {
            return Vec::new();
        };
        let Some(members) = self.barangay_members.get(&b) else {
            return Vec::new();
        };
        members
            .iter()
            .skip(from_index.unwrap_or(0).min(members.len() as u64) as usize)
            .take(
                limit
                    .unwrap_or(DEFAULT_PAGE_LIMIT)
                    .min(members.len() as u64) as usize,
            )
            .filter_map(|&i| self.players.get(i))
            .filter_map(|a| self.profiles.get(a).map(|p| self.profile_view(a, p, now)))
            .collect()
    }

    /// Players per barangay, only barangays with at least one player.
    pub fn barangay_counts(&self) -> BTreeMap<String, u32> {
        self.barangay_counts
            .iter()
            .enumerate()
            .filter(|(_, &n)| n > 0)
            .map(|(i, &n)| (BARANGAYS[i].to_string(), n))
            .collect()
    }

    /// Players by trust desc, then loans_repaid_on_time desc, then join order.
    pub fn leaderboard(&self, limit: Option<u64>) -> Vec<Profile> {
        let now = env::block_timestamp();
        let limit = limit.unwrap_or(DEFAULT_LEADERBOARD_LIMIT) as usize;
        let mut all: Vec<(&AccountId, &Player)> = self
            .players
            .iter()
            .filter_map(|a| self.profiles.get(a).map(|p| (a, p)))
            .collect();
        all.sort_by(|(_, a), (_, b)| {
            b.trust
                .cmp(&a.trust)
                .then(b.loans_repaid_on_time.cmp(&a.loans_repaid_on_time))
                .then(a.player_index.cmp(&b.player_index))
        });
        all.into_iter()
            .take(limit)
            .map(|(a, p)| self.profile_view(a, p, now))
            .collect()
    }

    pub fn stats(&self) -> Stats {
        let now = env::block_timestamp();
        let overdue_outstanding: u128 = self
            .open_loans
            .iter()
            .filter_map(|&id| self.loans.get(id as u32))
            .filter(|l| l.is_past_due(now))
            .map(|l| l.amount)
            .sum();
        let denom = self.total_repaid_on_time + self.total_repaid_late + overdue_outstanding;
        let trust_index_bps = (self.total_repaid_on_time * 10_000)
            .checked_div(denom)
            .map_or(10_000, |bps| bps as u32);
        Stats {
            total_supply: U128(self.token.total_supply),
            total_lent: U128(self.total_lent),
            total_repaid_on_time: U128(self.total_repaid_on_time),
            total_repaid_late: U128(self.total_repaid_late),
            outstanding: U128(self.outstanding),
            overdue_outstanding: U128(overdue_outstanding),
            active_loans: self.active_loans,
            requested_loans: self.requested_loans,
            players: self.players.len(),
            bonus_minted: U128(self.bonus_minted),
            bonus_pool_left: U128(self.bonus_pool_left()),
            trust_index_bps,
        }
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    fn loan(&self, loan_id: u64) -> Loan {
        u32::try_from(loan_id)
            .ok()
            .and_then(|i| self.loans.get(i))
            .cloned()
            .unwrap_or_else(|| env::panic_str(ERR_LOAN_NOT_FOUND))
    }

    fn save_loan(&mut self, loan: Loan) {
        let idx = loan.id as u32;
        self.loans.set(idx, loan);
    }

    fn index_loan(&mut self, account: &AccountId, loan_id: u64) {
        match self.account_loans.get_mut(account) {
            Some(ids) => ids.push(loan_id),
            None => {
                self.account_loans.insert(account.clone(), vec![loan_id]);
            }
        }
    }

    /// Decline / cancel bookkeeping.
    fn close_request(&mut self, loan: &Loan) {
        self.requested_loans -= 1;
        self.profiles
            .get_mut(&loan.borrower)
            .unwrap()
            .open_borrowed
            .retain(|&id| id != loan.id);
    }

    fn has_past_due(&self, account: &AccountId, now: u64) -> bool {
        self.profiles.get(account).is_some_and(|p| {
            p.open_borrowed
                .iter()
                .filter_map(|&id| self.loans.get(id as u32))
                .any(|l| l.is_past_due(now))
        })
    }

    fn pair_counted(&self, a: &AccountId, b: &AccountId) -> u32 {
        self.pairs
            .get(&pair_key(a, b))
            .map_or(0, |r| r.counted_repayments)
    }

    fn pair_cap(&self, a: &AccountId, b: &AccountId) -> u128 {
        FIRST_LOAN_CAP.saturating_mul(1 + self.pair_counted(a, b) as u128)
    }

    /// Step-by-step pair credit: amount <= FIRST_LOAN_CAP * (1 + counted repayments in the pair).
    fn assert_pair_credit(&self, lender: &AccountId, borrower: &AccountId, amount: u128) {
        let cap = self.pair_cap(lender, borrower);
        if amount > cap {
            env::panic_str(&format!(
                "{}{} right now",
                ERR_PAIR_CREDIT_PREFIX,
                format_utang(cap)
            ));
        }
    }

    fn assert_not_past_due(&self, account: &AccountId) {
        require!(
            !self.has_past_due(account, env::block_timestamp()),
            ERR_BAYAD_MUNA
        );
    }

    fn bonus_pool_left(&self) -> u128 {
        BONUS_POOL_CAP.saturating_sub(self.bonus_minted)
    }

    /// Overdue penalty, shared by `mark_overdue` and late `repay`.
    fn apply_overdue(&mut self, loan_id: u64, now: u64) {
        let mut loan = self.loan(loan_id);
        loan.status = LoanStatus::Overdue;
        self.active_loans -= 1;
        {
            let borrower = self.profiles.get_mut(&loan.borrower).unwrap();
            borrower.add_trust(TRUST_OVERDUE_BORROWER);
            borrower.loans_overdue += 1;
        }
        {
            let lender = self.profiles.get_mut(&loan.lender).unwrap();
            lender.add_trust(TRUST_OVERDUE_LENDER);
            lender.lending_limit = MIN_LIMIT.max(lender.lending_limit / 2);
            lender.lent_out = lender.lent_out.saturating_sub(loan.amount);
        }
        emit_event(
            "loan_overdue",
            serde_json::json!({
                "loan_id": loan_id,
                "lender": loan.lender,
                "borrower": loan.borrower,
                "amount": U128(loan.amount),
                "marked_at": U64(now),
            }),
        );
        self.save_loan(loan);
    }

    /// Whether an on-time repayment of `loan` at `now` is a counted repayment.
    fn counts(&self, loan: &Loan, now: u64) -> bool {
        let approved_at = loan.approved_at.unwrap_or(now);
        if now < approved_at + BONUS_MIN_AGE_DAYS * DAY_NS {
            return false;
        }
        let key = pair_key(&loan.lender, &loan.borrower);
        if let Some(rec) = self.pairs.get(&key) {
            if now < rec.last_counted_at + PAIR_COOLDOWN_DAYS * DAY_NS {
                return false;
            }
        }
        if let Some(last) = self
            .profiles
            .get(&loan.borrower)
            .and_then(|p| p.last_counted_at)
        {
            if now < last + BORROWER_COUNT_COOLDOWN_DAYS * DAY_NS {
                return false;
            }
        }
        true
    }

    /// Pays the bonus for a counted repayment while the pool lasts. Returns the total minted.
    fn pay_bonus(&mut self, loan: &Loan) -> u128 {
        let bonus =
            (loan.amount.min(BONUS_BASE_CAP) * BONUS_BPS / 10_000).min(self.bonus_pool_left());
        if bonus == 0 {
            return 0;
        }
        let lender_bonus = bonus / 2;
        let borrower_bonus = bonus - lender_bonus;
        self.bonus_minted += bonus;
        if lender_bonus > 0 {
            self.mint(&loan.lender, lender_bonus, "bonus");
        }
        self.mint(&loan.borrower, borrower_bonus, "bonus");
        emit_event(
            "bonus_paid",
            serde_json::json!({
                "loan_id": loan.id,
                "lender": loan.lender,
                "borrower": loan.borrower,
                "lender_bonus": U128(lender_bonus),
                "borrower_bonus": U128(borrower_bonus),
                "bonus_pool_left": U128(self.bonus_pool_left()),
            }),
        );
        bonus
    }

    fn mint(&mut self, account: &AccountId, amount: u128, memo: &str) {
        self.token.internal_deposit(account, amount);
        FtMint {
            owner_id: account,
            amount: U128(amount),
            memo: Some(memo),
        }
        .emit();
    }

    fn burn(&mut self, account: &AccountId, amount: u128, memo: &str) {
        self.token.internal_withdraw(account, amount);
        FtBurn {
            owner_id: account,
            amount: U128(amount),
            memo: Some(memo),
        }
        .emit();
    }

    fn profile_view(&self, account_id: &AccountId, p: &Player, now: u64) -> Profile {
        Profile {
            account_id: account_id.clone(),
            balance: U128(self.token.accounts.get(account_id).unwrap_or(0)),
            trust: p.trust,
            level: p.trust / LEVEL_STEP + 1,
            lending_limit: U128(p.lending_limit),
            lent_out: U128(p.lent_out),
            borrowed_out: U128(p.borrowed_out),
            loans_repaid_on_time: p.loans_repaid_on_time,
            loans_repaid_late: p.loans_repaid_late,
            loans_overdue: p.loans_overdue,
            loans_made: p.loans_made,
            loans_made_repaid: p.loans_made_repaid,
            has_overdue: self.has_past_due(account_id, now),
            joined_at: U64(p.joined_at),
            player_index: p.player_index,
            badges: badges_for(p),
            barangay: p.barangay.map(|b| BARANGAYS[b as usize].to_string()),
        }
    }
}

// ---------------------------------------------------------------------------
// NEP-141 core, wrapped with the "bayad muna" rule
// ---------------------------------------------------------------------------

#[near]
impl FungibleTokenCore for Contract {
    #[payable]
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.assert_not_past_due(&env::predecessor_account_id());
        self.token.ft_transfer(receiver_id, amount, memo)
    }

    #[payable]
    fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.assert_not_past_due(&env::predecessor_account_id());
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }
}

#[near]
impl FungibleTokenResolver for Contract {
    #[private]
    fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used, burned) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        // Accounts can never unregister, so `burned` is always 0 in practice.
        debug_assert_eq!(burned, 0);
        used.into()
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        self.metadata.get().clone().unwrap()
    }
}

// ---------------------------------------------------------------------------
// NEP-145 storage management: fixed 0.01 NEAR join deposit, no leaving
// ---------------------------------------------------------------------------

fn fixed_storage_balance() -> StorageBalance {
    StorageBalance {
        total: JOIN_DEPOSIT,
        available: NearToken::from_yoctonear(0),
    }
}

#[near]
impl StorageManagement for Contract {
    /// Registers the FT account and the player profile. Excess deposit is refunded.
    /// Re-registering is a no-op that refunds the whole deposit.
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        let _ = registration_only; // min == max, so both modes behave the same
        let predecessor = env::predecessor_account_id();
        let account_id = account_id.unwrap_or_else(|| predecessor.clone());
        let deposit = env::attached_deposit();

        if self.profiles.contains_key(&account_id) {
            if !deposit.is_zero() {
                Promise::new(predecessor).transfer(deposit).detach();
            }
            return fixed_storage_balance();
        }

        require!(deposit >= JOIN_DEPOSIT, ERR_DEPOSIT);
        let now = env::block_timestamp();
        let player_index = self.players.len();
        self.token.internal_register_account(&account_id);
        self.players.push(account_id.clone());
        self.profiles.insert(
            account_id.clone(),
            Player {
                trust: 0,
                lending_limit: STARTING_LIMIT,
                lent_out: 0,
                borrowed_out: 0,
                loans_repaid_on_time: 0,
                loans_repaid_late: 0,
                loans_overdue: 0,
                loans_made: 0,
                loans_made_repaid: 0,
                joined_at: now,
                player_index,
                open_borrowed: Vec::new(),
                last_counted_at: None,
                barangay: None,
            },
        );
        emit_event(
            "player_joined",
            serde_json::json!({ "account_id": account_id, "player_index": player_index }),
        );

        let refund = deposit.saturating_sub(JOIN_DEPOSIT);
        if !refund.is_zero() {
            Promise::new(predecessor).transfer(refund).detach();
        }
        fixed_storage_balance()
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        let _ = amount;
        env::panic_str(ERR_LEAVING)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        let _ = force;
        env::panic_str(ERR_LEAVING)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        StorageBalanceBounds {
            min: JOIN_DEPOSIT,
            max: Some(JOIN_DEPOSIT),
        }
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.profiles
            .contains_key(&account_id)
            .then(fixed_storage_balance)
    }
}
