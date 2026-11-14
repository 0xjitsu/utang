#!/usr/bin/env python3
"""
$UTANG 60-day neighbourhood simulation.

Python 3 standard library only. Deterministic (fixed seed per scenario).
Run:  cd sim && python3 simulate.py        -> writes sim/output/

Structure
---------
* `Contract` is a line-by-line model of the rules in docs/INTERFACE.md, in integer
  centavos. Agents can only change state through its methods, which raise
  `ContractError` exactly where the real contract would panic.
* `Sim` is a discrete-event simulation (time unit: 1 minute, DAY = 1440) so the
  1-day bonus age, the 7-day pair cooldown and due dates are exact, not rounded
  to whole days.
* Agent behaviours are documented next to the code that implements them and in
  sim/README.md.
"""

import copy
import heapq
import json
import math
import os
import random
import statistics
import sys
import time

# --------------------------------------------------------------------------
# Contract constants (docs/INTERFACE.md, rules())
# --------------------------------------------------------------------------
DAY = 1440                      # minutes; plays the role of DAY_NS
HOUR = 60
UNIT = 100                      # centavos per UTANG (decimals 2)

JOIN_DEPOSIT_YOCTO = 10 ** 22   # 0.01 NEAR
JOIN_DEPOSIT_NEAR = 0.01
STARTING_LIMIT = 1000           # 10.00
MAX_LIMIT = 100000              # 1,000.00
MIN_LIMIT = 100                 # 1.00
MIN_LOAN = 100                  # 1.00
MAX_LOAN = 100000               # 1,000.00
MIN_DAYS = 2                    # 2: a repayment only counts once the loan is 1 day old
MIN_DAYS_V1 = 1                 # original spec, used only for the "before" runs
MAX_DAYS = 30
MAX_OPEN_LOANS = 5
BONUS_BPS = 1000
BONUS_BASE_CAP = 1000           # bonus computed on at most 10.00 of a loan (v2)
BONUS_POOL_CAP = 10_000_000     # 100,000.00
FIRST_LOAN_CAP = 1000           # v2: pair credit step, cap = 10.00 x (1 + counted repayments)
BONUS_MIN_AGE_DAYS = 1
PAIR_COOLDOWN_DAYS = 7
BORROWER_COUNT_COOLDOWN_DAYS = 1  # v2: at most one counted repayment per borrower per day
TRUST_ON_TIME_BORROWER = 10
TRUST_ON_TIME_LENDER = 5
TRUST_OVERDUE_BORROWER = -20
TRUST_OVERDUE_LENDER = -10
TRUST_LATE_BORROWER = 5
TRUST_LATE_LENDER = 2
LEVEL_STEP = 50

SIM_DAYS = 60

CONTRACT_PARAMS = {
    "day_minutes": DAY,
    "join_deposit_near": JOIN_DEPOSIT_NEAR,
    "starting_limit": STARTING_LIMIT,
    "max_limit": MAX_LIMIT,
    "min_limit": MIN_LIMIT,
    "min_loan": MIN_LOAN,
    "max_loan": MAX_LOAN,
    "min_days": MIN_DAYS,
    "max_days": MAX_DAYS,
    "max_open_loans_per_borrower": MAX_OPEN_LOANS,
    "first_loan_cap": FIRST_LOAN_CAP,
    "bonus_bps": BONUS_BPS,
    "bonus_base_cap": BONUS_BASE_CAP,
    "bonus_pool_cap": BONUS_POOL_CAP,
    "bonus_min_age_days": BONUS_MIN_AGE_DAYS,
    "pair_cooldown_days": PAIR_COOLDOWN_DAYS,
    "borrower_count_cooldown_days": BORROWER_COUNT_COOLDOWN_DAYS,
    "trust_on_time_borrower": TRUST_ON_TIME_BORROWER,
    "trust_on_time_lender": TRUST_ON_TIME_LENDER,
    "trust_overdue_borrower": TRUST_OVERDUE_BORROWER,
    "trust_overdue_lender": TRUST_OVERDUE_LENDER,
    "trust_late_repay_borrower": TRUST_LATE_BORROWER,
    "trust_late_repay_lender": TRUST_LATE_LENDER,
    "level_step": LEVEL_STEP,
}

REQUESTED, ACTIVE, OVERDUE, REPAID, REPAID_LATE, DECLINED, CANCELLED = (
    "Requested", "Active", "Overdue", "Repaid", "RepaidLate", "Declined", "Cancelled")


# None = the official rules (rule C: pair credit step). The others are what-ifs used only
# in the rule comparison.
PROPOSALS = (None, "no_first_loan_cap", "cap_lifts_after_one", "pair_history_cap_no_first_growth")


class ContractError(Exception):
    pass


class InvariantError(AssertionError):
    pass


class Player:
    __slots__ = ("pid", "balance", "trust", "limit", "lent_out", "borrowed_out",
                 "repaid_on_time", "repaid_late", "overdue_count", "loans_made",
                 "loans_made_repaid", "joined_at", "open_ids", "bonus_received",
                 "counted_repayments", "last_counted")

    def __init__(self, pid, now):
        self.pid = pid
        self.balance = 0
        self.trust = 0
        self.limit = STARTING_LIMIT
        self.lent_out = 0
        self.borrowed_out = 0
        self.repaid_on_time = 0
        self.repaid_late = 0
        self.overdue_count = 0
        self.loans_made = 0
        self.loans_made_repaid = 0
        self.joined_at = now
        self.open_ids = []          # loans as borrower: Requested / Active / Overdue
        self.bonus_received = 0
        self.counted_repayments = 0     # as borrower (sim bookkeeping)
        self.last_counted = None        # time of last counted repayment as borrower (v2)


class Loan:
    __slots__ = ("id", "lender", "borrower", "amount", "days", "status", "requested_at",
                 "approved_at", "due_at", "closed_at", "bonus_paid", "counted")

    def __init__(self, lid, lender, borrower, amount, days, now):
        self.id = lid
        self.lender = lender
        self.borrower = borrower
        self.amount = amount
        self.days = days
        self.status = REQUESTED
        self.requested_at = now
        self.approved_at = None
        self.due_at = None
        self.closed_at = None
        self.bonus_paid = 0
        self.counted = False


def add_trust(p, delta):
    p.trust = max(0, p.trust + delta)       # trust never below 0


class Contract:
    """Model of the $UTANG contract (docs/INTERFACE.md). Amounts in centavos.

    rules="v2" (default) is the current INTERFACE.md: an on-time repayment only
    *counts* (trust, limit growth, bonus) if the loan is >= 1 day old, the unordered
    pair had no counted repayment in 7 days and the borrower had none in 1 day; bonus
    is 10% of min(amount, 10.00). rules="v1" is the original spec (every on-time
    repayment earns trust and limit growth; bonus 10% of the full amount if >= 1 day
    old and the pair had no *bonus* in 7 days), kept only for the before/after report.
    """

    def __init__(self, rules="v2", proposal=None):
        assert rules in ("v1", "v2")
        assert proposal in PROPOSALS
        self.rules = rules
        # Official (proposal=None): a pair may borrow at most
        #     first_loan_cap * (1 + counted repayments between them)   [rule C]
        # What-if variants for the rule comparison (NOT in INTERFACE.md):
        #  "no_first_loan_cap": no pair cap at all                     [A]
        #  "cap_lifts_after_one": 10.00 until the pair's first counted
        #      repayment, then no cap (the previous rule)              [B]
        #  "pair_history_cap_no_first_growth": C, and a pair's first counted
        #      repayment gives trust but no lender limit growth        [D]
        self.proposal = proposal
        self.pair_counted_count = {}
        self.players = []
        self.loans = []
        self.open_loans = {}            # id -> Loan for Active + Overdue
        self.total_supply = 0
        self.bonus_minted = 0
        self.total_lent = 0
        self.total_repaid_on_time = 0
        self.total_repaid_late = 0
        self.outstanding = 0
        self.pair_last_bonus = {}       # v1: (min, max) -> time of last bonus
        self.pair_last_counted = {}     # v2: (min, max) -> time of last counted repayment
        self.counted_repayments = 0
        self.uncounted_on_time = 0
        self.deposits_yocto = 0
        self.calls = {}                 # pid -> number of change calls (gas estimate)
        self.day = {"approved": 0, "repaid": 0, "repaid_late": 0, "overdue": 0}

    # ---- helpers -------------------------------------------------------
    @property
    def bonus_pool_left(self):
        return BONUS_POOL_CAP - self.bonus_minted

    def _call(self, pid):
        self.calls[pid] = self.calls.get(pid, 0) + 1

    def _player(self, pid):
        if pid is None or not (0 <= pid < len(self.players)):
            raise ContractError("Not registered")
        return self.players[pid]

    @staticmethod
    def past_due(loan, now):
        return loan.status == OVERDUE or (loan.status == ACTIVE and now > loan.due_at)

    def pair_cap(self, a, b):
        """Largest amount `a` may ask `b` for (v2): the pair credit step, i.e.
        first_loan_cap * (1 + counted repayments between the unordered pair)."""
        if self.rules == "v1":
            return MAX_LOAN
        pair = (min(a, b), max(a, b))
        if self.proposal == "no_first_loan_cap":
            return MAX_LOAN
        if self.proposal == "cap_lifts_after_one":
            return MAX_LOAN if pair in self.pair_last_counted else FIRST_LOAN_CAP
        return min(MAX_LOAN, FIRST_LOAN_CAP * (1 + self.pair_counted_count.get(pair, 0)))

    def has_past_due(self, pid, now):
        loans = self.loans
        for lid in self.players[pid].open_ids:
            ln = loans[lid]
            if ln.status == OVERDUE or (ln.status == ACTIVE and now > ln.due_at):
                return True
        return False

    def _mint(self, p, amount):
        p.balance += amount
        self.total_supply += amount

    def _burn(self, p, amount):
        if p.balance < amount:
            raise ContractError("Not enough balance")
        p.balance -= amount
        self.total_supply -= amount

    # ---- change methods ------------------------------------------------
    def storage_deposit(self, deposit_yocto, now):
        if deposit_yocto < JOIN_DEPOSIT_YOCTO:
            raise ContractError("Deposit too small")
        pid = len(self.players)
        self.players.append(Player(pid, now))
        self.deposits_yocto += JOIN_DEPOSIT_YOCTO      # excess refunded
        self._call(pid)
        return pid

    def ask(self, caller, lender, amount, days, now):
        self._call(caller)
        b = self._player(caller)
        self._player(lender)
        if caller == lender:
            raise ContractError("Cannot borrow from yourself")
        if self.has_past_due(caller, now):
            raise ContractError("Bayad muna: you have an overdue loan")
        if not (MIN_LOAN <= amount <= MAX_LOAN):
            raise ContractError("Bad amount")
        if not ((MIN_DAYS_V1 if self.rules == "v1" else MIN_DAYS) <= days <= MAX_DAYS):
            raise ContractError("Bad term")
        if len(b.open_ids) >= MAX_OPEN_LOANS:
            raise ContractError("Too many open loans")
        if amount > self.pair_cap(caller, lender):
            cap = self.pair_cap(caller, lender)
            raise ContractError(f"Credit between you two is at most {cap // 100}.{cap % 100:02d} right now")
        loan = Loan(len(self.loans), lender, caller, amount, days, now)
        self.loans.append(loan)
        b.open_ids.append(loan.id)
        return loan.id

    def decline(self, caller, lid, now):
        self._call(caller)
        ln = self.loans[lid]
        if caller != ln.lender or ln.status != REQUESTED:
            raise ContractError("Cannot decline")
        ln.status = DECLINED
        ln.closed_at = now
        self.players[ln.borrower].open_ids.remove(lid)

    def cancel(self, caller, lid, now):
        self._call(caller)
        ln = self.loans[lid]
        if caller != ln.borrower or ln.status != REQUESTED:
            raise ContractError("Cannot cancel")
        ln.status = CANCELLED
        ln.closed_at = now
        self.players[ln.borrower].open_ids.remove(lid)

    def approve(self, caller, lid, now):
        self._call(caller)
        ln = self.loans[lid]
        if caller != ln.lender or ln.status != REQUESTED:
            raise ContractError("Cannot approve")
        lender = self.players[ln.lender]
        if lender.lent_out + ln.amount > lender.limit:
            raise ContractError("Over lending limit")
        if self.has_past_due(ln.borrower, now):
            raise ContractError("Borrower has an overdue loan")
        b = self.players[ln.borrower]
        self._mint(b, ln.amount)
        ln.status = ACTIVE
        ln.approved_at = now
        ln.due_at = now + ln.days * DAY
        lender.lent_out += ln.amount
        lender.loans_made += 1
        b.borrowed_out += ln.amount
        self.outstanding += ln.amount
        self.total_lent += ln.amount
        self.open_loans[lid] = ln
        self.day["approved"] += 1

    def _overdue_penalty(self, ln):
        b = self.players[ln.borrower]
        lender = self.players[ln.lender]
        add_trust(b, TRUST_OVERDUE_BORROWER)
        b.overdue_count += 1
        add_trust(lender, TRUST_OVERDUE_LENDER)
        lender.limit = max(MIN_LIMIT, lender.limit // 2)
        lender.lent_out -= ln.amount
        ln.status = OVERDUE
        self.day["overdue"] += 1

    def mark_overdue(self, caller, lid, now):
        # anyone may call; registration not required
        ln = self.loans[lid]
        if not (ln.status == ACTIVE and now > ln.due_at):
            raise ContractError("Not overdue")
        self._overdue_penalty(ln)

    def repay(self, caller, lid, now):
        """Returns ('on_time', bonus) or ('late', 0, penalty_applied_now)."""
        self._call(caller)
        ln = self.loans[lid]
        if caller != ln.borrower or ln.status not in (ACTIVE, OVERDUE):
            raise ContractError("Cannot repay")
        b = self.players[ln.borrower]
        lender = self.players[ln.lender]
        self._burn(b, ln.amount)
        self.outstanding -= ln.amount
        b.borrowed_out -= ln.amount
        b.open_ids.remove(lid)
        del self.open_loans[lid]
        ln.closed_at = now
        self.day["repaid"] += 1
        if ln.status == ACTIVE and now <= ln.due_at:
            ln.status = REPAID
            lender.lent_out -= ln.amount
            self.total_repaid_on_time += ln.amount        # global: every on-time repayment
            pair = (min(ln.lender, ln.borrower), max(ln.lender, ln.borrower))
            old_enough = now >= ln.approved_at + BONUS_MIN_AGE_DAYS * DAY
            if self.rules == "v1":
                counted = True
            else:
                lp = self.pair_last_counted.get(pair)
                lb = b.last_counted
                counted = (old_enough
                           and (lp is None or now - lp >= PAIR_COOLDOWN_DAYS * DAY)
                           and (lb is None or now - lb >= BORROWER_COUNT_COOLDOWN_DAYS * DAY))
            bonus = 0
            if counted:
                ln.counted = True
                self.counted_repayments += 1
                b.counted_repayments += 1
                # profile counters (badges) move only on counted repayments
                lender.loans_made_repaid += 1
                b.repaid_on_time += 1
                add_trust(b, TRUST_ON_TIME_BORROWER)
                add_trust(lender, TRUST_ON_TIME_LENDER)
                if not (self.proposal == "pair_history_cap_no_first_growth"
                        and self.pair_counted_count.get(pair, 0) == 0):
                    lender.limit = min(MAX_LIMIT, lender.limit + ln.amount)
                if self.rules == "v1":
                    last = self.pair_last_bonus.get(pair)
                    if (old_enough and (last is None or now - last >= PAIR_COOLDOWN_DAYS * DAY)
                            and self.bonus_pool_left > 0):
                        bonus = min(ln.amount * BONUS_BPS // 10000, self.bonus_pool_left)
                        self.pair_last_bonus[pair] = now
                else:
                    self.pair_last_counted[pair] = now      # recorded on every counted repayment
                    self.pair_counted_count[pair] = self.pair_counted_count.get(pair, 0) + 1
                    b.last_counted = now
                    if self.bonus_pool_left > 0:
                        bonus = min(min(ln.amount, BONUS_BASE_CAP) * BONUS_BPS // 10000,
                                    self.bonus_pool_left)
            else:
                self.uncounted_on_time += 1
            if bonus > 0:
                lender_half = bonus // 2
                borrower_half = bonus - lender_half          # odd centavo to borrower
                self._mint(lender, lender_half)
                self._mint(b, borrower_half)
                lender.bonus_received += lender_half
                b.bonus_received += borrower_half
                self.bonus_minted += bonus
                ln.bonus_paid = bonus
            return ("on_time", bonus, False)
        penalty_now = False
        if ln.status == ACTIVE:                      # past due but never marked
            self._overdue_penalty(ln)
            penalty_now = True
        ln.status = REPAID_LATE
        add_trust(b, TRUST_LATE_BORROWER)
        add_trust(lender, TRUST_LATE_LENDER)
        b.repaid_late += 1
        self.total_repaid_late += ln.amount
        self.day["repaid_late"] += 1
        return ("late", 0, penalty_now)

    def ft_transfer(self, sender, receiver, amount, now):
        self._call(sender)
        s = self._player(sender)
        r = self._player(receiver)
        if sender == receiver:
            raise ContractError("Sender and receiver should be different")
        if amount <= 0:
            raise ContractError("Amount must be positive")
        if self.has_past_due(sender, now):
            raise ContractError("Bayad muna: you have an overdue loan")
        if s.balance < amount:
            raise ContractError("Not enough balance")
        s.balance -= amount
        r.balance += amount

    # ---- views -----------------------------------------------------------
    def stats(self, now):
        overdue_out = 0
        active = 0
        for ln in self.open_loans.values():
            if ln.status == ACTIVE:
                active += 1
            if ln.status == OVERDUE or now > ln.due_at:
                overdue_out += ln.amount
        denom = self.total_repaid_on_time + self.total_repaid_late + overdue_out
        tidx = 10000 if denom == 0 else self.total_repaid_on_time * 10000 // denom
        return {
            "total_supply": self.total_supply,
            "outstanding": self.outstanding,
            "overdue_outstanding": overdue_out,
            "bonus_minted": self.bonus_minted,
            "bonus_pool_left": self.bonus_pool_left,
            "trust_index_bps": tidx,
            "active_loans": active,
            "total_lent": self.total_lent,
        }

    # ---- invariants ------------------------------------------------------
    def check_invariants(self, now):
        def need(cond, msg):
            if not cond:
                raise InvariantError(f"t={now}: {msg}")
        bal_sum = 0
        lent = {}
        owed = {}
        for ln in self.open_loans.values():
            need(ln.status in (ACTIVE, OVERDUE), "open loan with closed status")
            owed[ln.borrower] = owed.get(ln.borrower, 0) + ln.amount
            if ln.status == ACTIVE:
                lent[ln.lender] = lent.get(ln.lender, 0) + ln.amount
        for p in self.players:
            need(p.balance >= 0, f"negative balance for {p.pid}")
            need(p.trust >= 0, f"negative trust for {p.pid}")
            need(MIN_LIMIT <= p.limit <= MAX_LIMIT, f"limit out of range for {p.pid}")
            need(p.lent_out == lent.get(p.pid, 0), f"lent_out mismatch for {p.pid}")
            need(p.borrowed_out == owed.get(p.pid, 0), f"borrowed_out mismatch for {p.pid}")
            need(len(p.open_ids) <= MAX_OPEN_LOANS, f"too many open loans for {p.pid}")
            bal_sum += p.balance
        need(bal_sum == self.total_supply, "sum of balances != total_supply")
        need(self.total_supply >= 0, "negative supply")
        need(0 <= self.bonus_minted <= BONUS_POOL_CAP, "bonus minted out of range")
        need(self.bonus_pool_left >= 0, "negative bonus pool")
        need(self.outstanding == sum(ln.amount for ln in self.open_loans.values()),
             "outstanding mismatch")
        # supply = minted principal - burned principal + bonus = outstanding + bonus
        need(self.total_supply <= self.outstanding + self.bonus_minted,
             "supply exceeds outstanding + bonus minted")
        need(self.total_supply == self.outstanding + self.bonus_minted,
             "supply != outstanding + bonus minted")
        need(self.total_supply <= self.outstanding + BONUS_POOL_CAP,
             "supply exceeds outstanding + pool cap")

    def check_loan_invariants(self):
        """End-of-run audit of every loan against the counted-repayment rules."""
        def need(cond, msg):
            if not cond:
                raise InvariantError(msg)
        bonus_sum = 0
        by_borrower = {}
        by_pair = {}
        for ln in self.loans:
            bonus_sum += ln.bonus_paid
            if self.rules == "v2":
                need(MIN_DAYS <= ln.days <= MAX_DAYS, f"loan {ln.id} term out of range")
            if ln.bonus_paid:
                need(ln.counted and ln.status == REPAID, f"bonus on uncounted loan {ln.id}")
            if ln.counted:
                need(ln.status == REPAID, f"counted loan {ln.id} not Repaid")
                if self.rules == "v2":
                    need(ln.bonus_paid <= BONUS_BASE_CAP * BONUS_BPS // 10000,
                         f"bonus above 1.00 on loan {ln.id}")
                    need(ln.closed_at - ln.approved_at >= BONUS_MIN_AGE_DAYS * DAY,
                         f"counted loan {ln.id} younger than 1 day")
                    by_borrower.setdefault(ln.borrower, []).append(ln.closed_at)
                    pair = (min(ln.lender, ln.borrower), max(ln.lender, ln.borrower))
                    by_pair.setdefault(pair, []).append(ln.closed_at)
        need(bonus_sum == self.bonus_minted, "sum of bonus_paid != bonus_minted")
        for ts in by_borrower.values():
            ts.sort()
            need(all(b - a >= BORROWER_COUNT_COOLDOWN_DAYS * DAY for a, b in zip(ts, ts[1:])),
                 "borrower counted twice within 1 day")
        for ts in by_pair.values():
            ts.sort()
            need(all(b - a >= PAIR_COOLDOWN_DAYS * DAY for a, b in zip(ts, ts[1:])),
                 "pair counted twice within 7 days")
        need(self.counted_repayments + self.uncounted_on_time
             == sum(1 for ln in self.loans if ln.status == REPAID), "counted bookkeeping")
        need(sum(p.repaid_on_time for p in self.players) == self.counted_repayments
             and sum(p.loans_made_repaid for p in self.players) == self.counted_repayments,
             "profile on-time counters must equal counted repayments")
        need(self.total_repaid_on_time == sum(ln.amount for ln in self.loans if ln.status == REPAID),
             "total_repaid_on_time must include every on-time repayment")


# --------------------------------------------------------------------------
# Behaviour parameters (documented in sim/README.md)
# --------------------------------------------------------------------------
BASE_BEHAVIOUR = {
    "n_agents": 40,
    "p_ask_range": [0.15, 0.45],            # daily chance an agent asks for a loan
    "ask_damping_if_in_debt": 0.5,          # multiplier on p_ask if already owing
    "personal_open_cap": 2,                 # agent's own cap on open loans (contract cap 5)
    "amount_menu_utang": {5: 0.35, 10: 0.35, 20: 0.20, 50: 0.07, 100: 0.03},
    "term_menu_days": {2: 0.05, 3: 0.20, 7: 0.40, 14: 0.25, 30: 0.10},
    "lenders_considered": 12,               # random neighbours looked at per ask (+ past partners)
    "partner_weight": 3,                    # extra weight per past on-time loan with that lender
    "random_lender_share": 0.15,            # share of asks to a uniformly random candidate
    "approve_base": 0.45,
    "approve_trust_per_point": 1 / 200,     # +0.005 per trust point ...
    "approve_trust_max": 0.35,              # ... capped at +0.35
    "approve_per_good_history": 0.08,       # per past on-time loan with this lender (max 3)
    "approve_per_lifetime_overdue": -0.15,  # per time borrower was marked overdue (max 3)
    "approve_stranger_after_burn": 0.6,     # multiplier on strangers once a lender was burned
    "approve_generosity_range": [-0.10, 0.10],
    "response_delay_hours": [0.2, 12],
    "spend_borrowed_fraction": [0.5, 1.0],  # share of a loan spent at neighbours' stores
    "daily_spend_fraction": [0.3, 0.7],     # share of free coins spent per day
    "seller_bias": 0.35,                    # chance a purchase goes to a neighbour raising cash
    "avoid_overdue_store": 0.8,             # chance to skip a store whose owner is past due
    "repay_time_fraction": [0.35, 1.0],     # on-time payers aim to repay at this share of term
    "repay_not_before_days": 1,             # ... but not before the loan is 1 day old (UI hint)
    "retry_hours_before_due": 3,
    "retry_hours_after_due": 6,
    "late_share_of_misses": 0.6,            # of loans not repaid on time: 60% late, 40% never
    "late_delay_days": [1, 10],
    "refinance_window_hours": 24,           # short within 24h of due -> borrow the shortfall
    "notice_delay_hours": [0, 24],          # mark_overdue called this long after due date
}

SCENARIOS = [
    {
        "scenario": "honest",
        "description": "Honest barangay: 40 neighbours, 95% of loans repaid on time.",
        "seed": 101,
        "reliability": {"type": "constant", "on_time": 0.95},
    },
    {
        "scenario": "deadbeats",
        "description": ("A few deadbeats: 40 neighbours, 25% of them repay on time only 10% "
                        "of the time, the rest 90%: 70% on time on average."),
        "seed": 202,
        "reliability": {"type": "deadbeats", "deadbeat_share": 0.25,
                        "deadbeat_on_time": 0.10, "others_on_time": 0.90},
    },
    {
        "scenario": "collapse",
        "description": ("Trust collapse: 95% on time for loans due before day 30, 40% for loans "
                        "due on day 30 or later."),
        "seed": 303,
        "reliability": {"type": "collapse", "before": 0.95, "after": 0.40, "from_day": 30},
    },
    {
        "scenario": "sybil",
        "description": ("Sybil farm: the honest barangay (40 neighbours, 95% on time) plus one "
                        "attacker with 50 accounts who self-lends to farm bonus and trust, then "
                        "borrows from honest neighbours and runs."),
        "seed": 404,
        "reliability": {"type": "constant", "on_time": 0.95},
        "attacker": {
            "accounts": 50,
            "cashout_accounts": 5,          # never borrow from honest players; receive the loot
            "farm_term_days": 2,            # minimum term; repaid exactly 24 h later so it counts
            "farm_loans_per_lender": 4,
            "pump_limits_on_day": 1,        # instant lend+repay loops to max out limits
            "prime_from_day": 2,            # build counted history with honest lenders...
            "prime_mode": "focus",          # ... re-priming 5 lenders (best under rule C)
            "run_from_day": 36,             # start borrow-and-run against honest lenders
            "run_term_days": 7,
            "gas_near_per_call": 0.0005,    # ASSUMPTION: ~5 Tgas at 100 Mgas price
        },
    },
    {
        "scenario": "pool_stress",
        "description": ("Pool stress: 10,000 very active neighbours (95% on time) borrowing "
                        "bigger amounts on short terms, to show the 100,000.00 bonus pool "
                        "running out and supply staying bounded."),
        "seed": 505,
        "reliability": {"type": "constant", "on_time": 0.95},
        "behaviour": {
            "n_agents": 10000,
            "p_ask_range": [0.6, 0.95],
            "ask_damping_if_in_debt": 0.9,
            "personal_open_cap": 4,
            "amount_menu_utang": {10: 0.2, 20: 0.2, 50: 0.25, 100: 0.2, 200: 0.1, 500: 0.05},
            "term_menu_days": {2: 0.3, 3: 0.3, 5: 0.2, 7: 0.2},
            "lenders_considered": 20,
            "random_lender_share": 0.4,
            "approve_base": 0.6,
        },
    },
]


def weighted_menu(rng, menu):
    keys = list(menu.keys())
    return rng.choices(keys, weights=[menu[k] for k in keys])[0]


class Agent:
    __slots__ = ("pid", "kind", "p_ask", "generosity", "popularity", "deadbeat",
                 "good_with", "lent_good", "burned_by", "was_burned", "declined_by", "gone")

    def __init__(self, pid, kind):
        self.pid = pid
        self.kind = kind            # "honest" | "attacker"
        self.p_ask = 0.0
        self.generosity = 0.0
        self.popularity = 1.0
        self.deadbeat = False
        self.good_with = {}         # lender pid -> on-time loans I repaid to them
        self.lent_good = {}         # borrower pid -> on-time loans they repaid to me
        self.burned_by = set()      # borrowers who went overdue on me
        self.was_burned = False
        self.declined_by = {}       # lender pid -> day they last declined me
        self.gone = False           # walked away after defaulting: store closed, no actions


class LoanMeta:
    __slots__ = ("fate", "purpose", "refinanced", "liquidity_late")

    def __init__(self, purpose):
        self.fate = None
        self.purpose = purpose      # need | refi | farm | pump | run
        self.refinanced = False
        self.liquidity_late = False


class Sim:
    def __init__(self, cfg, rules="v2", proposal=None):
        self.cfg = cfg
        self.name = cfg["scenario"]
        self.b = dict(BASE_BEHAVIOUR)
        self.b.update(cfg.get("behaviour", {}))
        self.rel = cfg["reliability"]
        self.rng = random.Random(cfg["seed"])
        self.c = Contract(rules, proposal)
        self.heap = []
        self.seq = 0
        self.now = 0
        self.today = 1
        self.agents = []
        self.meta = {}
        self.honest = []
        self.sellers = []
        self.days = []
        self.invariant_checks = 0
        self.counts = {"requested": 0, "declined": 0, "approve_failed": 0, "refinance": 0,
                       "liquidity_late": 0, "fate_on_time": 0, "fate_late": 0, "fate_never": 0,
                       "transfers": 0, "transfer_blocked": 0, "ask_blocked": 0,
                       "cancelled": 0, "gone": 0}
        self.bonus_empty_day = None
        # attacker state
        self.att = cfg.get("attacker")
        self.att_ids = []
        self.att_cash = []
        self.att_runners = []
        self.att_set = set()
        self.att_extracted = 0
        self.att_run_loans = []
        self.att_farm_loans_today = []
        self.att_trust_at_run = None
        self.att_farm_bonus = 0
        self.att_prime_loans = []
        self.att_runner_set = set()

        n = self.b["n_agents"]
        for _ in range(n):
            pid = self.c.storage_deposit(JOIN_DEPOSIT_YOCTO, 0)
            a = Agent(pid, "honest")
            a.p_ask = self.rng.uniform(*self.b["p_ask_range"])
            a.generosity = self.rng.uniform(*self.b["approve_generosity_range"])
            a.popularity = self.rng.uniform(0.5, 2.0)
            self.agents.append(a)
            self.honest.append(pid)
        if self.rel["type"] == "deadbeats":
            k = round(n * self.rel["deadbeat_share"])
            for pid in self.rng.sample(self.honest, k):
                self.agents[pid].deadbeat = True
        self.pop_cum = []
        acc = 0.0
        for pid in self.honest:
            acc += self.agents[pid].popularity
            self.pop_cum.append(acc)
        if self.att:
            for i in range(self.att["accounts"]):
                pid = self.c.storage_deposit(JOIN_DEPOSIT_YOCTO, 0)
                self.agents.append(Agent(pid, "attacker"))
                self.att_ids.append(pid)
            self.att_set = set(self.att_ids)
            nc = self.att["cashout_accounts"]
            self.att_cash = self.att_ids[-nc:]
            self.att_runners = self.att_ids[:-nc]
            self.att_runner_set = set(self.att_runners)

    # ---- event plumbing ----------------------------------------------------
    def at(self, t, fn, *args):
        self.seq += 1
        heapq.heappush(self.heap, (t, self.seq, fn, args))

    def hours(self, lo, hi):
        return int(self.rng.uniform(lo, hi) * HOUR)

    # ---- helpers ------------------------------------------------------------
    def blocked(self, pid):
        return self.c.has_past_due(pid, self.now)

    def need(self, pid):
        """Coins this agent is keeping aside to repay loans it intends to repay."""
        s = 0
        for lid in self.c.players[pid].open_ids:
            ln = self.c.loans[lid]
            if ln.status in (ACTIVE, OVERDUE) and self.meta[lid].fate in ("on_time", "late"):
                s += ln.amount
        return s

    def on_time_prob(self, agent, due_day):
        r = self.rel
        if r["type"] == "constant":
            return r["on_time"]
        if r["type"] == "deadbeats":
            return r["deadbeat_on_time"] if agent.deadbeat else r["others_on_time"]
        if r["type"] == "collapse":
            return r["before"] if due_day < r["from_day"] else r["after"]
        raise ValueError(r)

    def transfer(self, src, dst, amount):
        try:
            self.c.ft_transfer(src, dst, amount, self.now)
            self.counts["transfers"] += 1
            return True
        except ContractError:
            self.counts["transfer_blocked"] += 1
            return False

    def pick_store(self, src):
        """Whom an agent buys from (honest neighbourhood stores only)."""
        for _ in range(6):
            if self.sellers and self.rng.random() < self.b["seller_bias"]:
                t = self.rng.choice(self.sellers)
            else:
                t = self.rng.choices(self.honest, cum_weights=self.pop_cum)[0]
                if (self.c.has_past_due(t, self.now)
                        and self.rng.random() < self.b["avoid_overdue_store"]):
                    continue
            if t != src and not self.agents[t].gone:
                return t
        return None

    def spend(self, pid, amount):
        """Spend `amount` centavos at 1-2 neighbours' stores (ft_transfer)."""
        if amount <= 0:
            return
        parts = 1 if amount < 2 * UNIT or self.rng.random() < 0.5 else 2
        for i in range(parts):
            amt = amount // parts if i < parts - 1 else amount - (amount // parts) * (parts - 1)
            amt = min(amt, self.c.players[pid].balance)
            if amt <= 0:
                return
            t = self.pick_store(pid)
            if t is not None:
                self.transfer(pid, t, amt)

    # ---- honest agent behaviour --------------------------------------------
    def choose_lender(self, a, want):
        b = self.b
        pool = list(a.good_with.keys())
        pool += self.rng.sample(self.honest, min(b["lenders_considered"], len(self.honest)))
        seen = set()
        cand, w, avail = [], [], []
        pending = {self.c.loans[lid].lender for lid in self.c.players[a.pid].open_ids
                   if self.c.loans[lid].status == REQUESTED}
        for l in pool:
            if l == a.pid or l in seen or l in pending or self.agents[l].gone:
                continue
            seen.add(l)
            P = self.c.players[l]
            av = P.limit - P.lent_out
            if av < MIN_LOAN:
                continue
            wt = 1 + b["partner_weight"] * min(a.good_with.get(l, 0), 5)
            if a.declined_by.get(l, -99) >= self.today - 3:
                wt *= 0.2
            cand.append(l)
            w.append(wt)
            avail.append(av)
        if not cand:
            return None, 0
        if self.rng.random() < b["random_lender_share"]:
            i = self.rng.randrange(len(cand))
        else:
            i = self.rng.choices(range(len(cand)), weights=w)[0]
        amount = min(want, avail[i], self.c.pair_cap(a.pid, cand[i])) // UNIT * UNIT
        if amount < MIN_LOAN:
            return None, 0
        return cand[i], amount

    def ask(self, a, want, days, purpose):
        lender, amount = self.choose_lender(a, want)
        if lender is None:
            return None
        try:
            lid = self.c.ask(a.pid, lender, amount, days, self.now)
        except ContractError:
            self.counts["ask_blocked"] += 1
            return None
        self.counts["requested"] += 1
        self.meta[lid] = LoanMeta(purpose)
        lo, hi = self.b["response_delay_hours"]
        if purpose == "refi":
            hi = min(hi, 6)
        self.at(self.now + self.hours(lo, hi), self.respond, lid)
        return lid

    def daily_tick(self, pid):
        a = self.agents[pid]
        if a.gone:
            return
        b = self.b
        P = self.c.players[pid]
        blocked = self.blocked(pid)
        # 1. maybe ask for a loan
        if not blocked and len(P.open_ids) < b["personal_open_cap"]:
            p = a.p_ask * (b["ask_damping_if_in_debt"] if P.borrowed_out > 0 else 1.0)
            if self.rng.random() < p:
                want = weighted_menu(self.rng, b["amount_menu_utang"]) * UNIT
                days = weighted_menu(self.rng, b["term_menu_days"])
                self.ask(a, want, days, "need")
        # 2. everyday shopping with coins not set aside for repayments
        if not blocked:
            free = P.balance - self.need(pid)
            if free >= UNIT:
                self.spend(pid, int(free * self.rng.uniform(*b["daily_spend_fraction"])))

    def approve_prob(self, lender, borrower_pid):
        b = self.b
        if borrower_pid in lender.burned_by:
            return 0.02
        bp = self.c.players[borrower_pid]
        hist = min(lender.lent_good.get(borrower_pid, 0), 3)
        p = b["approve_base"] + min(b["approve_trust_max"], bp.trust * b["approve_trust_per_point"])
        p += b["approve_per_good_history"] * hist
        p += b["approve_per_lifetime_overdue"] * min(bp.overdue_count, 3)
        p += lender.generosity
        if lender.was_burned and hist == 0:
            p *= b["approve_stranger_after_burn"]
        return max(0.02, min(0.97, p))

    def respond(self, lid):
        ln = self.c.loans[lid]
        if ln.status != REQUESTED:
            return
        lender = self.agents[ln.lender]
        if lender.gone:                           # no answer: borrower withdraws the ask
            self.c.cancel(ln.borrower, lid, self.now)
            self.counts["cancelled"] += 1
            return
        if lender.kind == "attacker":
            self.c.decline(ln.lender, lid, self.now)
            self.counts["declined"] += 1
            return
        if self.rng.random() < self.approve_prob(lender, ln.borrower):
            try:
                self.c.approve(ln.lender, lid, self.now)
            except ContractError:
                self.counts["approve_failed"] += 1
                self.c.decline(ln.lender, lid, self.now)
                self.counts["declined"] += 1
                return
            self.on_approved(ln)
        else:
            self.c.decline(ln.lender, lid, self.now)
            self.counts["declined"] += 1
            self.agents[ln.borrower].declined_by[ln.lender] = self.today

    def on_approved(self, ln):
        m = self.meta[ln.id]
        borrower = self.agents[ln.borrower]
        if borrower.kind == "attacker" and m.purpose == "prime":
            # priming: repay exactly 24 h later so it counts and lifts the first-loan cap
            m.fate = "on_time"
            self.att_prime_loans.append(ln.id)
            self.at(ln.approved_at + BONUS_MIN_AGE_DAYS * DAY, self.att_repay_prime, ln.id)
            return
        if borrower.kind == "attacker":           # borrow-and-run
            m.fate = "never"
            self.att_extracted += ln.amount
            self.att_run_loans.append(ln.id)
            cash = self.rng.choice(self.att_cash)
            self.c.ft_transfer(ln.borrower, cash, ln.amount, self.now)
            self.at(ln.due_at + 1 + self.hours(*self.b["notice_delay_hours"]), self.notice, ln.id)
            return
        due_day = ln.due_at // DAY + 1
        r = self.rng.random()
        if r < self.on_time_prob(borrower, due_day):
            m.fate = "on_time"
        elif self.rng.random() < self.b["late_share_of_misses"]:
            m.fate = "late"
        else:
            m.fate = "never"
        self.counts["fate_" + m.fate] += 1
        # spend what was borrowed (that's why they borrowed)
        frac = 1.0 if m.fate == "never" else self.rng.uniform(*self.b["spend_borrowed_fraction"])
        if m.purpose == "refi":
            frac = 0.0                            # refinance coins are kept to repay
        if frac > 0:
            self.at(self.now + self.hours(0, 12), self.spend_borrowed, ln.borrower,
                    int(ln.amount * frac))
        # schedule repayment attempt
        if m.fate == "on_time":
            f = self.rng.uniform(*self.b["repay_time_fraction"])
            t = ln.approved_at + int(f * ln.days * DAY)
            # the game tells players a repayment only counts after 24 h
            t = max(t, ln.approved_at + int(self.b["repay_not_before_days"] * DAY))
            self.at(min(t, ln.due_at), self.try_repay, ln.id)
        elif m.fate == "late":
            self.at(ln.due_at + int(self.rng.uniform(*self.b["late_delay_days"]) * DAY),
                    self.try_repay, ln.id)
        else:
            self.at(ln.due_at + 1, self.abandon, ln.borrower)
        self.at(ln.due_at + 1 + self.hours(*self.b["notice_delay_hours"]), self.notice, ln.id)

    def spend_borrowed(self, pid, amount):
        if self.blocked(pid):
            return
        self.spend(pid, min(amount, self.c.players[pid].balance))

    def learn_from_repay(self, ln, result):
        kind, bonus, penalty_now = result
        lender = self.agents[ln.lender]
        borrower = self.agents[ln.borrower]
        if kind == "on_time":
            lender.lent_good[ln.borrower] = lender.lent_good.get(ln.borrower, 0) + 1
            borrower.good_with[ln.lender] = borrower.good_with.get(ln.lender, 0) + 1
        elif penalty_now:
            lender.burned_by.add(ln.borrower)
            lender.was_burned = True

    def try_repay(self, lid):
        ln = self.c.loans[lid]
        if ln.status not in (ACTIVE, OVERDUE):
            return
        if self.agents[ln.borrower].gone:
            return
        P = self.c.players[ln.borrower]
        m = self.meta[lid]
        if P.balance >= ln.amount:
            result = self.c.repay(ln.borrower, lid, self.now)
            self.learn_from_repay(ln, result)
            if result[0] == "late" and m.fate == "on_time" and not m.liquidity_late:
                m.liquidity_late = True
                self.counts["liquidity_late"] += 1
            return
        # short of coins
        if self.now <= ln.due_at:
            if (not m.refinanced and ln.due_at - self.now <= self.b["refinance_window_hours"] * HOUR
                    and m.purpose != "refi"):
                m.refinanced = True
                short = ln.amount - P.balance
                want = max(MIN_LOAN, -(-short // UNIT) * UNIT)
                if not self.blocked(ln.borrower) and len(P.open_ids) < MAX_OPEN_LOANS:
                    if self.ask(self.agents[ln.borrower], want, 7, "refi") is not None:
                        self.counts["refinance"] += 1
            nxt = min(self.now + self.b["retry_hours_before_due"] * HOUR, ln.due_at)
            if nxt <= self.now:
                nxt = self.now + self.b["retry_hours_after_due"] * HOUR
        else:
            if m.fate == "on_time" and not m.liquidity_late:
                m.liquidity_late = True
                self.counts["liquidity_late"] += 1
            nxt = self.now + self.b["retry_hours_after_due"] * HOUR
        self.at(nxt, self.try_repay, lid)

    def abandon(self, pid):
        """A borrower who never meant to repay walks away once past due: their store
        closes, they stop answering requests and stop repaying anything else."""
        a = self.agents[pid]
        if a.gone:
            return
        a.gone = True
        self.counts["gone"] += 1
        for lid in list(self.c.players[pid].open_ids):
            ln = self.c.loans[lid]
            if ln.status == REQUESTED:
                self.c.cancel(pid, lid, self.now)
                self.counts["cancelled"] += 1
        for lid in self.c.players[pid].open_ids:
            m = self.meta[lid]
            if m.fate != "never":
                m.fate = "never"

    def notice(self, lid):
        ln = self.c.loans[lid]
        if ln.status == ACTIVE and self.now > ln.due_at:
            self.c.mark_overdue(None, lid, self.now)
            lender = self.agents[ln.lender]
            lender.burned_by.add(ln.borrower)
            lender.was_burned = True

    # ---- attacker behaviour (sybil scenario) ---------------------------------
    def att_self_loan(self, lender, borrower, amount, days, purpose):
        lid = self.c.ask(borrower, lender, amount, days, self.now)
        self.meta[lid] = LoanMeta(purpose)
        self.meta[lid].fate = "on_time"
        self.c.approve(lender, lid, self.now)
        return lid

    def att_daily(self):
        A = self.att
        c = self.c
        # 1. repay yesterday's farm loans exactly 24 h after approval (bonus-eligible)
        for lid in self.att_farm_loans_today:
            ln = c.loans[lid]
            if ln.status == ACTIVE:
                before = c.bonus_minted
                c.repay(ln.borrower, lid, self.now)
                self.att_farm_bonus += c.bonus_minted - before
        self.att_farm_loans_today = []
        if c.rules == "v2":
            self.att_ring_v2()
            return
        # 2. (v1 rules) day 1: pump every lending limit to the maximum with instant loops
        #    (lend the whole limit, repay in the same minute: on time, so the
        #    limit grows by the amount; no bonus because the loan is < 24 h old)
        if self.today == A["pump_limits_on_day"]:
            ids = self.att_ids
            for i, l in enumerate(ids):
                partner = ids[(i + 1) % len(ids)]
                while c.players[l].limit < MAX_LIMIT:
                    amt = min(c.players[l].limit - c.players[l].lent_out, MAX_LOAN)
                    lid = self.att_self_loan(l, partner, amt, A["farm_term_days"], "pump")
                    c.repay(partner, lid, self.now)
        # 3. new farm loans (2-day term, repaid after 24 h) on unordered pairs whose 7-day cooldown will
        #    have expired by repay time. Stop once the pool is empty.
        if c.bonus_pool_left <= 0:
            return
        repay_at = self.now + BONUS_MIN_AGE_DAYS * DAY
        used = set()
        lenders = list(self.att_ids)
        self.rng.shuffle(lenders)
        borrowers_ok = [p for p in self.att_ids
                        if not c.has_past_due(p, self.now)
                        and (self.today < A["run_from_day"] or p in self.att_cash)]
        for l in lenders:
            room = c.players[l].limit - c.players[l].lent_out
            if room < MIN_LOAN:
                continue
            picks = []
            cands = list(borrowers_ok)
            self.rng.shuffle(cands)
            for bpid in cands:
                if bpid == l:
                    continue
                pair = (min(l, bpid), max(l, bpid))
                last = c.pair_last_bonus.get(pair)
                if pair in used or (last is not None and repay_at - last < PAIR_COOLDOWN_DAYS * DAY):
                    continue
                if len(c.players[bpid].open_ids) >= MAX_OPEN_LOANS:
                    continue
                picks.append(bpid)
                used.add(pair)
                if len(picks) >= A["farm_loans_per_lender"]:
                    break
            if not picks:
                continue
            each = min(MAX_LOAN, room // len(picks)) // UNIT * UNIT
            if each < MIN_LOAN:
                continue
            for bpid in picks:
                lid = self.att_self_loan(l, bpid, each, A["farm_term_days"], "farm")
                self.att_farm_loans_today.append(lid)

    def att_ring_v2(self):
        """Best play under the v2 rules: every account borrows exactly once a day (the
        borrower cooldown), from the account `k` places ahead in a ring, and repays exactly
        24 h later. `k` cycles through 1..(N-1)//2, so an unordered pair repeats only every
        24 days (> 7-day pair cooldown) and no pair is used twice on one day. Each loan is
        the lender's whole free limit (>= 10.00 earns the full 1.00 bonus; the size grows
        the lender's limit). Keeps going after the pool is empty because counted
        repayments still earn trust."""
        c = self.c
        ids = self.att_ids
        n = len(ids)
        k = (self.today - 1) % ((n - 1) // 2) + 1
        repay_at = self.now + BONUS_MIN_AGE_DAYS * DAY
        priming = self.priming_active()
        for i, bpid in enumerate(ids):
            l = ids[(i + k) % n]
            bp = c.players[bpid]
            if priming and bpid in self.att_runner_set:
                continue                     # their one counted slot a day goes to priming
            if c.has_past_due(bpid, self.now) or len(bp.open_ids) >= MAX_OPEN_LOANS:
                continue
            pair = (min(l, bpid), max(l, bpid))
            lp = c.pair_last_counted.get(pair)
            if lp is not None and repay_at - lp < PAIR_COOLDOWN_DAYS * DAY:
                continue
            if bp.last_counted is not None and repay_at - bp.last_counted < BORROWER_COUNT_COOLDOWN_DAYS * DAY:
                continue
            amt = min(c.players[l].limit - c.players[l].lent_out,
                      c.pair_cap(bpid, l)) // UNIT * UNIT
            if amt < MIN_LOAN:
                continue
            lid = self.att_self_loan(l, bpid, amt, self.att["farm_term_days"], "farm")
            self.att_farm_loans_today.append(lid)

    def priming_active(self):
        A = self.att
        return (A.get("prime_from_day") is not None
                and A["prime_from_day"] <= self.today < A["run_from_day"])

    def att_prime(self):
        """Before the run, each runner borrows 10.00 from an honest lender once a day and
        repays it 24 h later (a counted repayment). That lifts or raises the pair cap and
        gives the runner a good history with the lender.
        prime_mode "spread": a new lender every day (best when one counted repayment
        lifts the cap fully). "focus": 5 target lenders per runner (spread over the
        honest lenders), re-primed whenever the 7-day pair cooldown allows, so the cap
        climbs on exactly the pairs used in the run (best when the cap grows step by step;
        a runner can only have 5 loans open in the run anyway)."""
        c = self.c
        mode = self.att.get("prime_mode", "spread")
        nh = len(self.honest)
        for idx, r in enumerate(self.att_runners):
            P = c.players[r]
            if c.has_past_due(r, self.now) or len(P.open_ids) >= MAX_OPEN_LOANS:
                continue
            if any(self.meta[lid].purpose == "prime" for lid in P.open_ids):
                continue
            free = lambda x: c.players[x].limit - c.players[x].lent_out
            if mode == "focus":
                targets = [self.honest[(5 * idx + j) % nh] for j in range(MAX_OPEN_LOANS)]
                cands = []
                for l in targets:
                    pair = (min(r, l), max(r, l))
                    lp = c.pair_last_counted.get(pair)
                    if lp is not None and self.now + DAY - lp < PAIR_COOLDOWN_DAYS * DAY:
                        continue
                    if free(l) >= FIRST_LOAN_CAP and not self.agents[l].gone:
                        cands.append(l)
                if not cands:
                    continue
                l = min(cands, key=lambda x: (c.pair_counted_count.get((min(r, x), max(r, x)), 0),
                                              -free(x), x))
            else:
                cands = [l for l in self.honest
                         if (min(r, l), max(r, l)) not in c.pair_last_counted
                         and free(l) >= FIRST_LOAN_CAP
                         and not self.agents[l].gone]
                if not cands:
                    continue
                l = max(cands, key=lambda x: (free(x), -x))
            try:
                lid = c.ask(r, l, FIRST_LOAN_CAP, 2, self.now)
            except ContractError:
                continue
            self.counts["requested"] += 1
            self.meta[lid] = LoanMeta("prime")
            self.at(self.now + self.hours(*self.b["response_delay_hours"]), self.respond, lid)

    def att_repay_prime(self, lid):
        ln = self.c.loans[lid]
        last = self.c.players[ln.borrower].last_counted
        if (ln.status == ACTIVE and last is not None
                and self.now - last < BORROWER_COUNT_COOLDOWN_DAYS * DAY):
            # wait until the borrower cooldown allows this one to count too
            self.at(last + BORROWER_COUNT_COOLDOWN_DAYS * DAY, self.att_repay_prime, lid)
            return
        if ln.status == ACTIVE and self.c.players[ln.borrower].balance >= ln.amount:
            result = self.c.repay(ln.borrower, lid, self.now)
            self.learn_from_repay(ln, result)

    def att_run(self):
        """Borrow from honest neighbours with farmed trust; coins go to cash-out accounts."""
        A = self.att
        c = self.c
        if self.att_trust_at_run is None:
            self.att_trust_at_run = [c.players[p].trust for p in self.att_runners]
            # before running, sweep farmed coins (beyond what open farm loans need)
            # out of the runner accounts so they are not frozen later
            for r in self.att_runners:
                keep = c.players[r].borrowed_out
                spare = c.players[r].balance - keep
                if spare > 0:
                    c.ft_transfer(r, self.rng.choice(self.att_cash), spare, self.now)
        for r in self.att_runners:
            if c.has_past_due(r, self.now):
                continue
            # with the first-loan cap, ask lenders this runner has primed for the most
            # (their whole free limit) and everyone else for 10.00
            lenders = sorted(self.honest, key=lambda l: (
                -min(c.players[l].limit - c.players[l].lent_out, c.pair_cap(r, l)), l))
            asked = {c.loans[lid].lender for lid in c.players[r].open_ids}
            for l in lenders:
                if len(c.players[r].open_ids) >= MAX_OPEN_LOANS:
                    break
                if l in asked:
                    continue
                room = c.players[l].limit - c.players[l].lent_out
                amt = min(room, c.pair_cap(r, l)) // UNIT * UNIT
                if amt < MIN_LOAN:
                    break
                try:
                    lid = c.ask(r, l, amt, A["run_term_days"], self.now)
                except ContractError:
                    break
                self.counts["requested"] += 1
                self.meta[lid] = LoanMeta("run")
                asked.add(l)
                self.at(self.now + self.hours(*self.b["response_delay_hours"]), self.respond, lid)

    # ---- main loop ---------------------------------------------------------
    def start_of_day(self, d):
        day0 = (d - 1) * DAY
        # neighbours currently raising cash (short of coins with a loan due within 3 days
        # or already past due and meaning to pay)
        sellers = []
        for pid in self.honest:
            P = self.c.players[pid]
            if not P.open_ids or self.agents[pid].gone:
                continue
            nd = self.need(pid)
            if nd > P.balance:
                for lid in P.open_ids:
                    ln = self.c.loans[lid]
                    if ln.status in (ACTIVE, OVERDUE) and ln.due_at - day0 <= 3 * DAY:
                        sellers.append(pid)
                        break
        self.sellers = sellers
        for pid in self.honest:
            self.at(day0 + self.rng.randrange(DAY), self.daily_tick, pid)
        if self.att:
            self.at(day0 + 1, self.att_daily)
            if self.priming_active():
                self.at(day0 + 3 * HOUR, self.att_prime)
            if d >= self.att["run_from_day"]:
                self.at(day0 + 2 * HOUR, self.att_run)

    def run(self):
        c = self.c
        for d in range(1, SIM_DAYS + 1):
            self.today = d
            c.day = {"approved": 0, "repaid": 0, "repaid_late": 0, "overdue": 0}
            self.start_of_day(d)
            end = d * DAY
            while self.heap and self.heap[0][0] < end:
                t, _, fn, args = heapq.heappop(self.heap)
                self.now = t
                fn(*args)
            self.now = end - 1
            c.check_invariants(self.now)
            self.invariant_checks += 1
            self.snapshot(d)
        c.check_loan_invariants()

    def snapshot(self, d):
        c = self.c
        s = c.stats(self.now)
        if self.bonus_empty_day is None and s["bonus_pool_left"] == 0:
            self.bonus_empty_day = d
        with_overdue = 0
        frozen = 0
        for p in c.players:
            if p.open_ids and c.has_past_due(p.pid, self.now):
                with_overdue += 1
                frozen += p.balance
        row = {
            "day": d,
            "total_supply": s["total_supply"],
            "outstanding": s["outstanding"],
            "overdue_outstanding": s["overdue_outstanding"],
            "bonus_minted": s["bonus_minted"],
            "bonus_pool_left": s["bonus_pool_left"],
            "trust_index_bps": s["trust_index_bps"],
            "active_loans": s["active_loans"],
            "players_with_overdue": with_overdue,
            "avg_trust": round(sum(p.trust for p in c.players) / len(c.players), 2),
            "loans_approved_today": c.day["approved"],
            "loans_repaid_today": c.day["repaid"],
            "loans_overdue_today": c.day["overdue"],
            # extras
            "loans_repaid_late_today": c.day["repaid_late"],
            "total_lent": s["total_lent"],
            "frozen_balance": frozen,
            "players_walked_away": self.counts["gone"],
            "players": len(c.players),
        }
        if self.att:
            row["attacker_bonus_received"] = sum(c.players[p].bonus_received for p in self.att_ids)
            row["attacker_extracted"] = self.att_extracted
            row["honest_avg_trust"] = round(
                sum(c.players[p].trust for p in self.honest) / len(self.honest), 2)
            row["attacker_avg_trust"] = round(
                sum(c.players[p].trust for p in self.att_ids) / len(self.att_ids), 2)
        # sanity on the published row
        assert row["total_supply"] >= 0 and row["bonus_pool_left"] >= 0
        assert row["total_supply"] <= row["outstanding"] + row["bonus_minted"]
        self.days.append(row)

    # ---- results -----------------------------------------------------------
    def summary(self):
        c = self.c
        now = self.now
        loans = c.loans
        approved = [ln for ln in loans if ln.approved_at is not None]

        def group(pids):
            pids = set(pids)
            ls = [ln for ln in approved if ln.borrower in pids]
            on_time = sum(1 for ln in ls if ln.status == REPAID)
            late = sum(1 for ln in ls if ln.status == REPAID_LATE)
            unpaid_due = [ln for ln in ls if c.past_due(ln, now)]
            not_due = sum(1 for ln in ls if ln.status == ACTIVE and now <= ln.due_at)
            settled = on_time + late + len(unpaid_due)
            players = [c.players[p] for p in pids]
            limits = sorted(p.limit for p in players)
            return {
                "players": len(players),
                "loans_approved": len(ls),
                "total_lent": sum(ln.amount for ln in ls),
                "loans_repaid_on_time": on_time,
                "counted_repayments": sum(1 for ln in ls if ln.counted),
                "loans_repaid_late": late,
                "loans_past_due_unpaid_at_end": len(unpaid_due),
                "past_due_unpaid_principal_at_end": sum(ln.amount for ln in unpaid_due),
                "loans_not_yet_due_at_end": not_due,
                "realized_on_time_share": round(on_time / settled, 4) if settled else None,
                "bonus_received": sum(p.bonus_received for p in players),
                "avg_trust": round(sum(p.trust for p in players) / len(players), 2),
                "max_trust": max(p.trust for p in players),
                "median_lending_limit": int(statistics.median(limits)),
                "max_lending_limit": limits[-1],
                "players_at_max_limit": sum(1 for x in limits if x == MAX_LIMIT),
            }

        hon = group(self.honest)
        supplies = [r["total_supply"] for r in self.days]
        peak = max(supplies)
        last = self.days[-1]
        fates = self.counts["fate_on_time"] + self.counts["fate_late"] + self.counts["fate_never"]
        out = {
            "scenario": self.name,
            "rules": c.rules,
            "players": len(c.players),
            "join_deposits_near": round(len(c.players) * JOIN_DEPOSIT_NEAR, 4),
            "loans_requested": len(loans),
            "loans_approved": len(approved),
            "loans_declined": self.counts["declined"],
            "total_lent": c.total_lent,
            "total_repaid_on_time": c.total_repaid_on_time,
            "total_repaid_late": c.total_repaid_late,
            "counted_repayments": c.counted_repayments,
            "uncounted_on_time_repayments": c.uncounted_on_time,
            "loans_marked_overdue": sum(c.players[p].overdue_count for p in range(len(c.players))),
            "intended_on_time_share": (round(self.counts["fate_on_time"] / fates, 4)
                                       if fates else None),
            "players_walked_away": self.counts["gone"],
            "refinance_asks": self.counts["refinance"],
            "late_for_lack_of_coins": self.counts["liquidity_late"],
            "transfers": self.counts["transfers"],
            "final_total_supply": last["total_supply"],
            "peak_total_supply": peak,
            "peak_supply_day": supplies.index(peak) + 1,
            "final_outstanding": last["outstanding"],
            "final_overdue_outstanding": last["overdue_outstanding"],
            "final_frozen_balance": last["frozen_balance"],
            "bonus_minted": c.bonus_minted,
            "bonus_pool_left": c.bonus_pool_left,
            "bonus_pool_empty_day": self.bonus_empty_day,
            "final_trust_index_bps": last["trust_index_bps"],
            "min_trust_index_bps": min(r["trust_index_bps"] for r in self.days),
            "final_players_with_overdue": last["players_with_overdue"],
            "honest": hon,
            "trust_distribution": self.trust_distribution(),
            "leaderboard_top10": self.leaderboard(10),
            "supply_bound_holds": all(r["total_supply"] <= r["outstanding"] + r["bonus_minted"]
                                      and r["total_supply"] <= r["outstanding"] + BONUS_POOL_CAP
                                      for r in self.days),
            "invariant_checks_passed": self.invariant_checks,
        }
        if self.rel["type"] == "collapse":
            d29 = self.days[28]
            out["collapse"] = {
                "supply_day_29": d29["total_supply"],
                "trust_index_bps_day_29": d29["trust_index_bps"],
                "loans_approved_days_1_29": sum(r["loans_approved_today"] for r in self.days[:29]),
                "loans_approved_days_30_60": sum(r["loans_approved_today"] for r in self.days[29:]),
                "players_with_overdue_day_29": d29["players_with_overdue"],
                "players_with_overdue_day_60": last["players_with_overdue"],
            }
        if self.att:
            A = self.att
            calls = sum(c.calls.get(p, 0) for p in self.att_ids)
            farm = [ln for ln in approved if self.meta[ln.id].purpose == "farm"]
            run = [c.loans[lid] for lid in self.att_run_loans]
            run_asks = [ln for ln in loans if self.meta.get(ln.id) and self.meta[ln.id].purpose == "run"]
            honest_lenders_hit = sorted({ln.lender for ln in run})
            att_players = [c.players[p] for p in self.att_ids]
            trust_run = self.att_trust_at_run or [0]
            n = A["accounts"]
            pairs = n * (n - 1) // 2
            if c.rules == "v1":
                # limited by lender limits (1,000.00 out, loans repaid after 24 h) and pair cooldown
                max_rate = min(n * MAX_LIMIT,
                               pairs * MAX_LOAN // PAIR_COOLDOWN_DAYS) * BONUS_BPS // 10000
            else:
                # one counted repayment per borrower per day, one per pair per 7 days,
                # at most 1.00 bonus each
                max_counted = min(n, pairs // PAIR_COOLDOWN_DAYS)
                max_rate = max_counted * (BONUS_BASE_CAP * BONUS_BPS // 10000)
            bonus_farmed = sum(p.bonus_received for p in att_players)
            farm_days = len({ln.closed_at // DAY for ln in farm if ln.bonus_paid})
            per_loan_bonus = BONUS_BASE_CAP * BONUS_BPS // 10000
            need_accts = math.ceil(BONUS_POOL_CAP / (SIM_DAYS * per_loan_bonus))
            calls_to_drain = 3 * (BONUS_POOL_CAP // per_loan_bonus)
            ranked = self.leaderboard(len(c.players))
            best_honest_rank = next(i + 1 for i, r in enumerate(ranked) if r["kind"] == "honest")
            out["attacker"] = {
                "accounts": n,
                "join_deposits_near": round(n * JOIN_DEPOSIT_NEAR, 4),
                "contract_calls": calls,
                "gas_near_per_call_assumed": A["gas_near_per_call"],
                "estimated_gas_near": round(calls * A["gas_near_per_call"], 3),
                "total_cost_near_estimate": round(n * JOIN_DEPOSIT_NEAR
                                                  + calls * A["gas_near_per_call"], 3),
                "farm_loans": len(farm),
                "farm_volume": sum(ln.amount for ln in farm),
                "bonus_farmed": sum(p.bonus_received for p in att_players),
                "bonus_farmed_share_of_all_bonus": (round(sum(p.bonus_received for p in att_players)
                                                          / c.bonus_minted, 4)
                                                    if c.bonus_minted else 0),
                "max_farm_bonus_per_day_theoretical": max_rate,
                "farm_bonus_per_day_observed": (bonus_farmed // farm_days) if farm_days else 0,
                "days_to_empty_full_pool_at_max_rate": (math.ceil(BONUS_POOL_CAP / max_rate)
                                                        if max_rate else None),
                "days_to_empty_remaining_pool_at_max_rate": (math.ceil(c.bonus_pool_left / max_rate)
                                                             if max_rate else None),
                "estimated_gas_near_per_utang_farmed": (round(calls * A["gas_near_per_call"]
                                                              / (bonus_farmed / UNIT), 5)
                                                        if bonus_farmed else None),
                "accounts_needed_to_empty_pool_in_60_days": (need_accts if c.rules == "v2" else None),
                "cost_near_to_empty_pool_in_60_days": (
                    round(need_accts * JOIN_DEPOSIT_NEAR + calls_to_drain * A["gas_near_per_call"], 1)
                    if c.rules == "v2" else None),
                "best_honest_leaderboard_rank": best_honest_rank,
                "attacker_accounts_in_top10": sum(1 for r in ranked[:10] if r["kind"] == "attacker"),
                "prime_loans_approved": len(self.att_prime_loans),
                "prime_loans_counted": sum(1 for lid in self.att_prime_loans if c.loans[lid].counted),
                "honest_limit_growth_from_attacker_repayments": sum(
                    c.loans[lid].amount for lid in self.att_prime_loans if c.loans[lid].counted),
                "extracted_on_primed_pairs": sum(ln.amount for ln in run if ln.amount > FIRST_LOAN_CAP),
                "extracted_at_first_loan_cap": sum(ln.amount for ln in run if ln.amount <= FIRST_LOAN_CAP),
                "unprimed_extraction_bound": len(self.att_runners) * MAX_OPEN_LOANS * FIRST_LOAN_CAP,
                "run_asks": len(run_asks),
                "run_loans_approved_by_honest": len(run),
                "honest_lenders_hit": len(honest_lenders_hit),
                "coins_extracted_borrow_and_run": self.att_extracted,
                "extracted_still_unpaid": sum(ln.amount for ln in run
                                              if ln.status in (ACTIVE, OVERDUE)),
                "runner_trust_at_run_start_avg": round(sum(trust_run) / len(trust_run), 1),
                "runner_trust_at_run_start_max": max(trust_run),
                "attacker_trust_final_avg": round(sum(p.trust for p in att_players) / n, 1),
                "attacker_trust_final_max": max(p.trust for p in att_players),
                "attacker_accounts_blocked_at_end": sum(1 for p in self.att_ids
                                                        if c.has_past_due(p, now)),
                "honest_max_trust_final": hon["max_trust"],
                "attacker_coins_held_final": sum(p.balance for p in att_players),
                "attacker_cashout_balance_final": sum(c.players[p].balance for p in self.att_cash),
            }
        return out

    def kind_of(self, pid):
        return self.agents[pid].kind

    def leaderboard(self, limit):
        c = self.c
        order = sorted(c.players, key=lambda p: (-p.trust, -p.repaid_on_time, p.pid))
        return [{"id": p.pid, "kind": self.kind_of(p.pid), "trust": p.trust,
                 "level": p.trust // LEVEL_STEP + 1, "loans_repaid_on_time": p.repaid_on_time}
                for p in order[:limit]]

    def trust_distribution(self):
        """Players per level (trust // 50 + 1), honest vs attacker, plus trust percentiles."""
        out = {}
        for kind in ("honest", "attacker"):
            ts = sorted(p.trust for p in self.c.players if self.kind_of(p.pid) == kind)
            if not ts:
                continue
            levels = {}
            for t in ts:
                lv = t // LEVEL_STEP + 1
                levels[str(lv)] = levels.get(str(lv), 0) + 1
            pct = lambda q: ts[min(len(ts) - 1, int(q * len(ts)))]
            out[kind] = {"players": len(ts), "levels": dict(sorted(levels.items(),
                                                                   key=lambda kv: int(kv[0]))),
                         "trust_p10": pct(0.1), "trust_p50": pct(0.5), "trust_p90": pct(0.9),
                         "trust_max": ts[-1]}
        return out

    def players_out(self):
        """Per-player final state (only for small scenarios, to keep files small)."""
        c = self.c
        if len(c.players) > 200:
            return None
        now = self.now
        return [{"id": p.pid, "kind": self.kind_of(p.pid), "trust": p.trust,
                 "level": p.trust // LEVEL_STEP + 1, "lending_limit": p.limit,
                 "balance": p.balance, "borrowed_out": p.borrowed_out,
                 "loans_repaid_on_time": p.repaid_on_time,
                 "counted_repayments": p.counted_repayments,
                 "loans_repaid_late": p.repaid_late, "loans_overdue": p.overdue_count,
                 "loans_made": p.loans_made, "loans_made_repaid": p.loans_made_repaid,
                 "bonus_received": p.bonus_received,
                 "has_overdue": c.has_past_due(p.pid, now),
                 "walked_away": self.agents[p.pid].gone}
                for p in c.players]

    def params(self):
        p = {"rules": self.c.rules, "contract": CONTRACT_PARAMS, "behaviour": self.b, "reliability": self.rel,
             "seed": self.cfg["seed"], "days": SIM_DAYS, "time_unit": "minute"}
        if self.att:
            p["attacker"] = self.att
        return p


def baseline_honest_bonus(results):
    for r in results:
        if r["scenario"] == "honest":
            return r["summary"]["honest"]["bonus_received"]
    return None


def fmt(c):
    """centavos -> '1,234.56'"""
    sign = "-" if c < 0 else ""
    c = abs(c)
    return f"{sign}{c // 100:,}.{c % 100:02d}"


def pct(x):
    return f"{x * 100:.1f}%"


def pool_day(s):
    return f"day {s['bonus_pool_empty_day']}" if s["bonus_pool_empty_day"] else "not empty"


def write_markdown(results, before_after, path):
    S = {r["scenario"]: r["summary"] for r in results}
    L = []
    L.append("# $UTANG 60-day simulation: results\n")
    L.append("Generated by `python3 simulate.py` (deterministic seeds) with the official rules in "
             "`docs/INTERFACE.md`: **counted repayments** (an on-time repayment earns trust, limit "
             "growth and bonus only if the loan is at least 1 day old, the pair had no counted "
             "repayment in 7 days and the borrower had none in the last day; bonus = 10% of at most "
             "10.00) and the **pair credit step** (a pair may borrow at most 10.00 x (1 + counted "
             "repayments between them)). Amounts in UTANG. Invariants (supply = outstanding + bonus "
             "minted, supply <= outstanding + 100,000.00, pool/balances/trust never negative, "
             "lent_out and borrowed_out consistent, and an end-of-run audit of every loan against "
             "the counted-repayment rules, the 1.00 bonus cap and the profile counters) held in "
             "every run.\n")
    L.append("| Scenario | Players | Loans approved | Lent | On time (realized) | Counted repayments | "
             "Peak supply | Overdue unpaid at end | Bonus minted | Pool empty on | Trust index end |")
    L.append("|---|---|---|---|---|---|---|---|---|---|---|")
    for r in results:
        s = r["summary"]
        h = s["honest"]
        L.append(
            f"| {s['scenario']} | {s['players']:,} | {s['loans_approved']:,} | {fmt(s['total_lent'])} | "
            f"{pct(h['realized_on_time_share'])} (intended {s['intended_on_time_share'] * 100:.0f}%) | "
            f"{s['counted_repayments']:,} of {s['counted_repayments'] + s['uncounted_on_time_repayments']:,} on time | "
            f"{fmt(s['peak_total_supply'])} (day {s['peak_supply_day']}) | "
            f"{fmt(s['final_overdue_outstanding'])} | {fmt(s['bonus_minted'])} | {pool_day(s)} | "
            f"{s['final_trust_index_bps'] / 100:.1f}% |")
    L.append("\n*On time (realized)* counts non-attacker loans that were due by day 60. In `sybil`, "
             "lent, counted repayments, supply and trust index include the attacker's own farm.\n")

    a = S["sybil"]["attacker"]
    hb = baseline_honest_bonus(results)
    L.append("## Sybil attacker (50 accounts, best play we found under the official rules)\n")
    L.append("1. **Ring farm.** Every account borrows once a day from the account k places ahead and "
             "repays exactly 24 h later; k cycles 1..24 so no pair repeats within 7 days. Loans are "
             "as large as the pair credit allows (10.00 for a new pair, also the size that earns "
             "the full 1.00 bonus).\n"
             "2. **Priming (days 2-35).** Each of 45 runner accounts picks 5 honest lenders and, once "
             "a day, borrows 10.00 from one of them and repays exactly 24 h later, re-priming each "
             "lender whenever the 7-day pair cooldown allows. Every counted repayment raises that "
             "pair's credit by 10.00, gives the runner a good history with the lender and grows "
             "the lender's limit. (Best of the 7 strategies we tried under these rules.)\n"
             "3. **Run (day 36 on).** Runners ask each lender for as much as the pair credit and "
             "the lender's free limit allow, move the coins to 5 clean accounts and never repay.\n")
    L.append("| | |\n|---|---|")
    L.append(f"| Cost | {a['join_deposits_near']} NEAR deposits + ~{a['estimated_gas_near']} NEAR gas "
             f"({a['contract_calls']:,} calls at an assumed {a['gas_near_per_call_assumed']} NEAR) |")
    L.append(f"| Bonus farmed | {fmt(a['bonus_farmed'])} UTANG in 60 days "
             f"(ceiling {fmt(a['max_farm_bonus_per_day_theoretical'])}/day) |")
    L.append(f"| Days to empty the pool at that ceiling | {a['days_to_empty_full_pool_at_max_rate']:,} days |")
    L.append(f"| To empty it in 60 days instead | ~{a['accounts_needed_to_empty_pool_in_60_days']:,} accounts, "
             f"~{a['cost_near_to_empty_pool_in_60_days']} NEAR (deposits + gas) |")
    L.append(f"| Honest neighbours' bonus | {fmt(S['sybil']['honest']['bonus_received'])} "
             f"(honest scenario: {fmt(hb)}) |")
    L.append(f"| Priming repayments to honest lenders | {a['prime_loans_counted']} counted |")
    L.append(f"| Borrow-and-run | **{fmt(a['coins_extracted_borrow_and_run'])} UTANG** from "
             f"{a['run_loans_approved_by_honest']} loans / {a['honest_lenders_hit']} honest lenders |")
    L.append(f"| Runner trust at day 36 | {a['runner_trust_at_run_start_avg']:.0f} (best honest "
             f"player at day 60: {a['honest_max_trust_final']}) |")
    L.append(f"| Leaderboard | **best honest player ranks #{a['best_honest_leaderboard_rank']}**; "
             f"{a['attacker_accounts_in_top10']} of the top 10 are attacker accounts |")
    L.append(f"| Attacker accounts blocked at end | {a['attacker_accounts_blocked_at_end']} of {a['accounts']} |")
    L.append("")
    L.append("**Trust cannot prove identity, and the leaderboard is sybil-able.** Trust measures how "
             "accounts treated each other, nothing more. Any always-on group of accounts that repay "
             "each other every day will outrank real neighbours, who borrow a few times a month. "
             "Lenders should judge a borrower by their own history with them, not by the trust "
             "number or leaderboard rank.\n")
    L.append(before_after_md(before_after))
    L.append(findings(results, before_after))
    with open(path, "w") as f:
        f.write("\n".join(L) + "\n")


def before_after_md(ba):
    sb, sa = ba["sybil"]["before"], ba["sybil"]["after"]
    sn = ba["sybil"]["after_naive_attacker"]
    ab, aa = sb["attacker"], sa["attacker"]
    cmp_ = ba["rule_comparison"]
    L = ["## Before vs after\n",
         "Same behaviour model and seeds. For every rule set the attacker uses the strategy that "
         "extracts the most out of the 7 we try (no priming; priming a new lender a day or "
         "re-priming 5 fixed lenders, starting on day 2, 8 or 15; the run always starts on day "
         "36). *Before* = original rules, *after* = official rules (C). Raw numbers and daily "
         "series in `before_after.json`.\n"]
    L.append("| sybil (40 honest + 50 attacker accounts) | Before | After |\n|---|---|---|")
    rows = [
        ("Attacker strategy", cmp_["original"]["best_attacker_strategy"], cmp_["C"]["best_attacker_strategy"]),
        ("Bonus farmed by the attacker", fmt(ab["bonus_farmed"]), fmt(aa["bonus_farmed"])),
        ("Bonus pool emptied", pool_day(sb), pool_day(sa)),
        ("Days for 50 accounts to empty a full pool", f"{ab['days_to_empty_full_pool_at_max_rate']:,}",
         f"{aa['days_to_empty_full_pool_at_max_rate']:,}"),
        ("Honest neighbours' bonus", fmt(sb["honest"]["bonus_received"]), fmt(sa["honest"]["bonus_received"])),
        ("**Borrow-and-run, patient attacker**", f"**{fmt(ab['coins_extracted_borrow_and_run'])}**",
         f"**{fmt(aa['coins_extracted_borrow_and_run'])}**"),
        ("Borrow-and-run, attacker without priming",
         fmt(cmp_["original"]["attacker_strategies"][0]["extracted"]),
         fmt(sn["attacker"]["coins_extracted_borrow_and_run"])),
        ("**Best honest leaderboard rank**", f"**#{ab['best_honest_leaderboard_rank']}**",
         f"**#{aa['best_honest_leaderboard_rank']}**"),
        ("Supply at day 60", fmt(sb["final_total_supply"]), fmt(sa["final_total_supply"])),
    ]
    L += [f"| {r[0]} | {r[1]} | {r[2]} |" for r in rows]
    pb, pa = ba["pool_stress"]["before"], ba["pool_stress"]["after"]
    rows = [
        ("Honest median limit, 40-player honest run", fmt(cmp_["original"]["honest_scenario_median_limit"]),
         fmt(cmp_["C"]["honest_scenario_median_limit"])),
        ("Bonus minted (60 days), 2,000 players", fmt(pb["bonus_minted"]), fmt(pa["bonus_minted"])),
        ("Bonus pool emptied, 2,000 players", pool_day(pb), pool_day(pa)),
        ("On-time repayments that counted, 2,000 players", f"{pb['counted_repayments']:,} of {pb['counted_repayments'] + pb['uncounted_on_time_repayments']:,}",
         f"{pa['counted_repayments']:,} of {pa['counted_repayments'] + pa['uncounted_on_time_repayments']:,}"),
        ("Median trust / median lending limit, 2,000 players", f"{pb['trust_distribution']['honest']['trust_p50']} / {fmt(pb['honest']['median_lending_limit'])}",
         f"{pa['trust_distribution']['honest']['trust_p50']} / {fmt(pa['honest']['median_lending_limit'])}"),
    ]
    L.append("\n| Honest players (no attacker) | Before | After |\n|---|---|---|")
    L += [f"| {r[0]} | {r[1]} | {r[2]} |" for r in rows]
    L.append("\n" + rule_comparison_md(cmp_))
    return "\n".join(L) + "\n"


def rule_comparison_md(cmp_):
    keys = ["original", "A", "B", "C", "D"]
    head = lambda k: "C (adopted)" if cmp_[k].get("adopted") else k
    L = ["## Rule comparison: borrow-and-run vs honest progress\n",
         "How the official rule was chosen. Each column is a full rerun with the same seeds and "
         "the attacker's best strategy for that rule set. Honest cost is measured without any "
         "attacker. A, B and D are what-ifs, not the contract.\n"]
    for k in keys:
        L.append(f"- **{head(k)}**: {cmp_[k]['label'].split(': ', 1)[-1]}")
    L.append("")
    L.append("| | " + " | ".join(head(k) for k in keys) + " |")
    L.append("|---|" + "---|" * len(keys))

    def row(label, f):
        L.append(f"| {label} | " + " | ".join(f(cmp_[k]) for k in keys) + " |")
    row("Attacker's best strategy", lambda c: c["best_attacker_strategy"])
    row("**Borrow-and-run extracted**", lambda c: f"**{fmt(c['borrow_and_run_extracted'])}**")
    row("Same, attacker without priming", lambda c: fmt(c["attacker_strategies"][0]["extracted"]))
    row("Attacker bonus", lambda c: fmt(c["attacker_bonus"]))
    row("Honest players' bonus (sybil run)", lambda c: fmt(c["honest_bonus_in_sybil_run"]))
    row("**Best honest leaderboard rank**", lambda c: f"**#{c['best_honest_rank']}**")
    row("Honest median limit, sybil run", lambda c: fmt(c["sybil_run_honest_median_limit"]))
    row("Honest median limit, 40-player honest run", lambda c: fmt(c["honest_scenario_median_limit"]))
    row("Honest median limit, 2,000-player pool_stress", lambda c: fmt(c["stress2000_median_limit"]))
    row("On-time repayments that counted, pool_stress", lambda c: pct(c["stress2000_counted_share"]))
    row("Median trust, pool_stress", lambda c: str(c["stress2000_median_trust"]))
    L.append("\nExtraction by attacker strategy:\n")
    strategies = [r["strategy"] for r in cmp_["C"]["attacker_strategies"]]
    L.append("| Strategy | " + " | ".join(head(k) for k in keys) + " |")
    L.append("|---|" + "---|" * len(keys))
    for i, st in enumerate(strategies):
        L.append(f"| {st} | " + " | ".join(fmt(cmp_[k]["attacker_strategies"][i]["extracted"])
                                          for k in keys) + " |")
    return "\n".join(L) + "\n"


def findings(results, ba):
    S = {r["scenario"]: r["summary"] for r in results}
    h, d, co, sy, ps = S["honest"], S["deadbeats"], S["collapse"], S["sybil"], S["pool_stress"]
    a = sy["attacker"]
    col = co["collapse"]
    cm = ba["rule_comparison"]
    sb = ba["sybil"]["before"]["attacker"]
    pa = ba["pool_stress"]["after"]
    unc = lambda s: s["uncounted_on_time_repayments"] / max(1, s["counted_repayments"] + s["uncounted_on_time_repayments"])
    naive = ba["sybil"]["after_naive_attacker"]["attacker"]
    ex = lambda k: fmt(cm[k]["borrow_and_run_extracted"])
    out = ["## Findings\n"]
    out.append(
        f"1. **The bonus pool is safe.** A 50-account farm earns at most "
        f"{fmt(a['max_farm_bonus_per_day_theoretical'])} UTANG/day (one counted repayment per "
        f"account per day, 1.00 each) instead of {fmt(sb['max_farm_bonus_per_day_theoretical'])}; "
        f"it farmed {fmt(a['bonus_farmed'])} in 60 days instead of {fmt(sb['bonus_farmed'])}, and "
        f"would need {a['days_to_empty_full_pool_at_max_rate']:,} days to empty the pool. Emptying it "
        f"in 60 days would take ~{a['accounts_needed_to_empty_pool_in_60_days']:,} accounts and "
        f"~{a['cost_near_to_empty_pool_in_60_days']} NEAR. Same-minute loops no longer grow limits, "
        f"trust or badges.")
    out.append(
        f"2. **Borrow-and-run is reduced, not solved.** Without priming the attacker gets 10.00 per "
        f"pair ({fmt(naive['coins_extracted_borrow_and_run'])}). A patient attacker who repays honest "
        f"lenders on time for weeks raises its credit 10.00 per counted repayment per pair and took "
        f"{ex('C')} under the official rule, vs {ex('original')} under the original rules and "
        f"{ex('B')} under the previous rule (B). It is bounded per account (5 open loans x pair "
        f"credit, and pair credit grows at most 10.00 per week), so more accounts and more "
        f"patience mean more.")
    out.append(
        f"3. **Honest cost of the official rule is small in a barangay, real for heavy users.** "
        f"Median honest limit in the 40-player run: {fmt(cm['C']['honest_scenario_median_limit'])} "
        f"(original rules: {fmt(cm['original']['honest_scenario_median_limit'])}). In a 2,000-player "
        f"community: {fmt(cm['C']['stress2000_median_limit'])} vs "
        f"{fmt(cm['original']['stress2000_median_limit'])}, and {pct(unc(pa))} of on-time repayments "
        f"did not count ({pct(unc(h))} in the barangay). D would cut extraction to {ex('D')} but "
        f"leave the 2,000-player median limit at {fmt(cm['D']['stress2000_median_limit'])}.")
    out.append(
        f"4. **Trust cannot prove identity; the leaderboard is sybil-able.** The best honest "
        f"player ranked between #{min(cm[k]['best_honest_rank'] for k in cm)} and "
        f"#{max(cm[k]['best_honest_rank'] for k in cm)} out of 90 in every rule set; no rule "
        f"we tried changes that.")
    out.append(
        f"5. **Supply and trust index can still be inflated** by ring volume: sybil-run supply "
        f"peaked at {fmt(sy['peak_total_supply'])} vs {fmt(h['peak_total_supply'])} for the "
        f"honest barangay, and the trust index read {sy['final_trust_index_bps'] / 100:.1f}%.")
    out.append(
        f"6. **Pool cap and supply bound hold.** {ps['players']:,} very active players emptied "
        f"the pool on day {ps['bonus_pool_empty_day']}; 2,000 players minted "
        f"{fmt(pa['bonus_minted'])} in 60 days. A 40-player barangay mints "
        f"~{fmt(h['bonus_minted'] // 60)} UTANG of bonus a day, so in the demo the pool will look "
        f"untouched.")
    out.append(
        f"7. **Unchanged from the first run.** Deadbeats are contained (trust index "
        f"{d['final_trust_index_bps'] / 100:.1f}%). The collapse shows in the trust index the "
        f"next day ({col['trust_index_bps_day_29'] / 100:.1f}% on day 29 -> "
        f"{co['final_trust_index_bps'] / 100:.1f}% on day 60) while supply barely moves, so lead "
        f"the Economy screen with the trust index. Repaying is partly a liquidity problem "
        f"(principal is burned), and coins sent to past-due players freeze "
        f"({fmt(ps['final_frozen_balance'])} UTANG in pool_stress, an upper bound).")
    out.append("\n## Still worth saying in the game\n")
    out.append(
        "- Trust shows how accounts treated each other, not who is a real neighbour; judge "
        "borrowers by your own history with them.\n"
        "- A repayment only counts after 24 h, once per pair per week and once per borrower per "
        "day; each counted repayment between two players lets them borrow 10.00 more from each "
        "other.")
    return "\n\n".join(out)


RULE_VARIANTS = [
    # (key, contract rules, proposal, label)
    ("original", "v1", None, "Original rules (no counted repayments, no first-loan cap)"),
    ("A", "v2", "no_first_loan_cap", "A: counted repayments, no first-loan cap"),
    ("B", "v2", "cap_lifts_after_one", "B: cap lifts fully after 1 counted repayment (previous rule)"),
    ("C", "v2", None, "C: pair cap = 10.00 x (1 + counted repayments in the pair) (ADOPTED)"),
    ("D", "v2", "pair_history_cap_no_first_growth",
     "D: C + a pair's first counted repayment gives no limit growth"),
]

ATTACKER_STRATEGIES = [
    # (label, prime_from_day, prime_mode); run always starts on day 36
    ("no priming", None, "spread"),
    ("spread from day 2", 2, "spread"),
    ("focus from day 2", 2, "focus"),
    ("spread from day 8", 8, "spread"),
    ("focus from day 8", 8, "focus"),
    ("spread from day 15", 15, "spread"),
    ("focus from day 15", 15, "focus"),
]


def best_attack(rules, proposal):
    """Run the sybil scenario with every attacker strategy; return the one that extracts
    the most (ties: more bonus) plus the per-strategy results."""
    base = [c for c in SCENARIOS if c["scenario"] == "sybil"][0]
    best, best_key, best_label, rows = None, None, None, []
    for label, pf, mode in ATTACKER_STRATEGIES:
        cfg = copy.deepcopy(base)
        cfg["attacker"]["prime_from_day"] = pf
        cfg["attacker"]["prime_mode"] = mode
        sim = run_one(cfg, rules, proposal)
        a = sim.summary()["attacker"]
        rows.append({"strategy": label, "extracted": a["coins_extracted_borrow_and_run"],
                     "bonus_farmed": a["bonus_farmed"], "pairs_primed": a["prime_loans_counted"]})
        key = (a["coins_extracted_borrow_and_run"], a["bonus_farmed"])
        if best_key is None or key > best_key:
            best, best_key, best_label = sim, key, label
    return best, best_label, rows


def counted_share(s):
    tot = s["counted_repayments"] + s["uncounted_on_time_repayments"]
    return round(s["counted_repayments"] / tot, 4) if tot else None


def rule_comparison():
    honest_cfg = [c for c in SCENARIOS if c["scenario"] == "honest"][0]
    stress_cfg = copy.deepcopy([c for c in SCENARIOS if c["scenario"] == "pool_stress"][0])
    stress_cfg["behaviour"]["n_agents"] = 2000
    out, sims = {}, {}
    for key, rules, proposal, label in RULE_VARIANTS:
        t1 = time.time()
        sim, strat, rows = best_attack(rules, proposal)
        sims[key] = sim
        s = sim.summary()
        a = s["attacker"]
        hs = run_one(honest_cfg, rules, proposal).summary()
        st_sim = run_one(stress_cfg, rules, proposal)
        st = st_sim.summary()
        sims[key + "_stress"] = st_sim
        out[key] = {
            "label": label, "rules": rules, "proposal": proposal, "adopted": key == "C",
            "best_attacker_strategy": strat,
            "attacker_strategies": rows,
            "borrow_and_run_extracted": a["coins_extracted_borrow_and_run"],
            "attacker_bonus": a["bonus_farmed"],
            "honest_bonus_in_sybil_run": s["honest"]["bonus_received"],
            "best_honest_rank": a["best_honest_leaderboard_rank"],
            "sybil_run_honest_median_limit": s["honest"]["median_lending_limit"],
            "honest_scenario_median_limit": hs["honest"]["median_lending_limit"],
            "honest_scenario_counted_share": counted_share(hs),
            "stress2000_median_limit": st["honest"]["median_lending_limit"],
            "stress2000_median_trust": st["trust_distribution"]["honest"]["trust_p50"],
            "stress2000_counted_share": counted_share(st),
            "stress2000_bonus_minted": st["bonus_minted"],
        }
        print(f"rules {key:8s} best attack={strat:18s} extracted={fmt(a['coins_extracted_borrow_and_run']):>9s} "
              f"stress median limit={fmt(st['honest']['median_lending_limit'])} ({time.time() - t1:.1f}s)")
    return out, sims


BEFORE_AFTER = [
    # (scenario, behaviour overrides, label)
    ("sybil", None, "sybil (40 honest + 50 attacker accounts)"),
    ("pool_stress", {"n_agents": 2000}, "pool_stress at 2,000 players (the size used in the first run)"),
]

SERIES_KEYS = ("day", "total_supply", "bonus_minted", "bonus_pool_left", "trust_index_bps",
               "avg_trust", "honest_avg_trust", "attacker_avg_trust", "attacker_bonus_received",
               "attacker_extracted")


def run_one(cfg, rules="v2", proposal=None):
    sim = Sim(cfg, rules, proposal)
    sim.run()
    return sim


def compact(sim):
    s = sim.summary()
    keep = ("rules", "players", "loans_approved", "total_lent", "counted_repayments",
            "uncounted_on_time_repayments", "peak_total_supply", "final_total_supply",
            "bonus_minted", "bonus_pool_left", "bonus_pool_empty_day", "final_trust_index_bps",
            "trust_distribution", "attacker")
    out = {k: s[k] for k in keep if k in s}
    out["honest"] = {k: s["honest"][k] for k in ("realized_on_time_share", "bonus_received",
                                                  "avg_trust", "max_trust",
                                                  "median_lending_limit", "counted_repayments")}
    out["days"] = [{k: d[k] for k in SERIES_KEYS if k in d} for d in sim.days]
    return out


def main():
    t0 = time.time()
    here = os.path.dirname(os.path.abspath(__file__))
    out_dir = os.path.join(here, "output")
    os.makedirs(out_dir, exist_ok=True)
    only = set(sys.argv[1:])
    results = []
    sims = {}
    for cfg in SCENARIOS:
        if only and cfg["scenario"] not in only:
            continue
        t1 = time.time()
        sim = run_one(cfg)
        sims[cfg["scenario"]] = sim
        res = {
            "scenario": cfg["scenario"],
            "description": cfg["description"],
            "params": sim.params(),
            "days": sim.days,
            "summary": sim.summary(),
        }
        players = sim.players_out()
        if players is not None:
            res["players"] = players
        results.append(res)
        with open(os.path.join(out_dir, cfg["scenario"] + ".json"), "w") as f:
            json.dump(res, f, indent=1)
        s = res["summary"]
        print(f"{cfg['scenario']:12s} players={s['players']:6d} loans={s['loans_approved']:7d} "
              f"peak_supply={fmt(s['peak_total_supply']):>14s} bonus={fmt(s['bonus_minted']):>12s} "
              f"pool_empty_day={s['bonus_pool_empty_day']} trust_index={s['final_trust_index_bps']} "
              f"({time.time() - t1:.1f}s)")
    if only:
        print(f"done in {time.time() - t0:.1f}s -> {out_dir}")
        return
    comparison, csims = rule_comparison()
    main_b = sims["sybil"].summary()["attacker"]["coins_extracted_borrow_and_run"]
    if main_b != comparison["C"]["borrow_and_run_extracted"]:
        print("WARNING: the main sybil attacker is not the best strategy found for rule C")
    before_after = {
        "sybil": {
            "setup": "sybil (40 honest + 50 attacker accounts), best attacker strategy for each rule set",
            "before": compact(csims["original"]),
            "after": compact(sims["sybil"]),
            "after_naive_attacker": compact(run_one(
                dict(copy.deepcopy([c for c in SCENARIOS if c["scenario"] == "sybil"][0]),
                     attacker=dict([c for c in SCENARIOS if c["scenario"] == "sybil"][0]["attacker"],
                                   prime_from_day=None)), "v2")),
            "what_if_pair_history_cap": compact(csims["C"]),
        },
        "pool_stress": {
            "setup": "pool_stress at 2,000 players (the size used in the first run)",
            "before": compact(csims["original_stress"]),
            "after": compact(csims["C_stress"]),
        },
        "rule_comparison": comparison,
    }
    with open(os.path.join(out_dir, "before_after.json"), "w") as f:
        json.dump(before_after, f, indent=1)
    with open(os.path.join(out_dir, "summary.json"), "w") as f:
        json.dump({r["scenario"]: r["summary"] for r in results}, f, indent=1)
    write_markdown(results, before_after, os.path.join(out_dir, "summary.md"))
    print(f"done in {time.time() - t0:.1f}s -> {out_dir}")


if __name__ == "__main__":
    main()
