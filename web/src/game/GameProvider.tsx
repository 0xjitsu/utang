// Holds all game state, polls the contract (or preview mock), and exposes typed actions.
// Actions are also exported for non-React layers via `externalApi` and `window.utang`.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { createBackend, type Backend, type PreviewControls } from "../near";
import { friendlyError } from "../near/errors";
import { fmtUtang } from "../near/format";
import { BLOCKER_TEXT, countBlocker, pairCreditFromLoans } from "../near/rules";
import type { BarangayCounts, Loan, PairCredit, Profile, Rules, Stats } from "../near/types";
import { bus } from "./bus";
import { BADGES } from "../art/icons";

export interface Toast {
  id: number;
  kind: "ok" | "err" | "info" | "coin";
  title: string;
  body?: string;
}

export interface GameActions {
  refresh(): Promise<void>;
  signIn(): void;
  signOut(): Promise<void>;
  join(): Promise<boolean>;
  ask(lender: string, amount: string, days: number): Promise<number | undefined | false>;
  approve(loanId: number): Promise<boolean>;
  decline(loanId: number): Promise<boolean>;
  cancel(loanId: number): Promise<boolean>;
  repay(loanId: number): Promise<boolean>;
  markOverdue(loanId: number): Promise<boolean>;
  transfer(receiverId: string, amount: string): Promise<boolean>;
  loadMoreListahan(): Promise<void>;
  /** Pick or change my barangay (set_barangay). */
  setBarangay(barangay: string): Promise<boolean>;
  /** Players living in a barangay (players_in). */
  playersIn(barangay: string): Promise<Profile[]>;
  /** Credit between me and `other` (pair_credit view; computed from loans_of if the view is unavailable). */
  pairCredit(other: string): Promise<PairCredit | null>;
  /** Preview only: pretend to be this account. */
  previewSignInAs(accountId: string): void;
  previewSkipDays(days: number): void;
  previewReset(): void;
}

export interface GameState {
  status: "booting" | "ready" | "error";
  bootError?: string;
  loadError?: string;
  mode: "preview" | "live";
  accountId: string | null;
  rules: Rules | null;
  stats: Stats | null;
  me: Profile | null;
  myLoans: Loan[];
  players: Profile[];
  listahan: Loan[];
  listahanDone: boolean;
  leaderboard: Profile[];
  barangayCounts: BarangayCounts;
  now: bigint;
  busy: string | null;
  loaded: boolean;
  toasts: Toast[];
  coinPops: { id: number; text: string }[];
}

interface Ctx extends GameState {
  actions: GameActions;
  dismissToast(id: number): void;
  preview?: PreviewControls;
  /** Start of the neighbourhood (first player's join) for "Day N" labels. */
  originNs: bigint | null;
}

const GameContext = createContext<Ctx | null>(null);

/** For non-React layers (e.g. a Phaser scene): the latest actions and state. */
export const externalApi: { actions: GameActions | null; getState: () => GameState | null; bus: typeof bus } = {
  actions: null,
  getState: () => null,
  bus,
};
if (typeof window !== "undefined") (window as any).utang = externalApi;

const PAGE = 100;
let toastSeq = 1;

export function GameProvider({ children, backendFactory }: { children: ReactNode; backendFactory?: () => Promise<Backend> }) {
  const [backend, setBackend] = useState<Backend | null>(null);
  const [state, setState] = useState<GameState>({
    status: "booting",
    mode: "preview",
    accountId: null,
    rules: null,
    stats: null,
    me: null,
    myLoans: [],
    players: [],
    listahan: [],
    listahanDone: false,
    leaderboard: [],
    barangayCounts: {},
    now: BigInt(Date.now()) * 1_000_000n,
    busy: null,
    loaded: false,
    toasts: [],
    coinPops: [],
  });
  const stateRef = useRef(state);
  stateRef.current = state;
  const listLimit = useRef(PAGE);
  const refreshing = useRef<Promise<void> | null>(null);
  const refreshQueued = useRef(false);
  const prevMe = useRef<Profile | null>(null);
  const seenRequests = useRef<Set<number> | null>(null);
  const actionDepth = useRef(0);

  // Toasts are a queue shown one at a time by <Toasts/> (it auto-dismisses after ~3 s).
  const toast = useCallback((t: Omit<Toast, "id">) => {
    const id = toastSeq++;
    setState((s) => ({ ...s, toasts: [...s.toasts, { ...t, id }].slice(-5) }));
  }, []);

  const dismissToast = useCallback((id: number) => setState((s) => ({ ...s, toasts: s.toasts.filter((t) => t.id !== id) })), []);

  const coinPop = useCallback((text: string) => {
    const id = toastSeq++;
    setState((s) => ({ ...s, coinPops: [...s.coinPops, { id, text }] }));
    setTimeout(() => setState((s) => ({ ...s, coinPops: s.coinPops.filter((x) => x.id !== id) })), 1800);
  }, []);

  // ------------------------------------------------------------------ boot
  useEffect(() => {
    let cancelled = false;
    (backendFactory ?? createBackend)()
      .then((b) => {
        if (cancelled) return;
        setBackend(b);
        setState((s) => ({ ...s, mode: b.mode, accountId: b.getAccountId(), status: "ready", now: b.now() }));
      })
      .catch((e) => {
        if (!cancelled) setState((s) => ({ ...s, status: "error", bootError: friendlyError(e) }));
      });
    return () => {
      cancelled = true;
    };
  }, [backendFactory]);

  // Wallet redirect results (MyNearWallet returns to the page with these params).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const q = new URLSearchParams(window.location.search);
    const hashes = q.get("transactionHashes");
    const err = q.get("errorCode");
    if (hashes || err) {
      if (hashes) toast({ kind: "ok", title: "Transaction sent", body: "The listahan will update in a moment." });
      if (err) toast({ kind: "err", title: "The wallet did not send it", body: decodeURIComponent(q.get("errorMessage") ?? err) });
      window.history.replaceState(null, "", window.location.pathname + window.location.hash);
    }
  }, [toast]);

  // ------------------------------------------------------------------ data
  const doRefresh = useCallback(async () => {
    if (!backend) return;
    const c = backend.client;
    const acct = backend.getAccountId();
    try {
      const [rules, stats, players, listahan, leaderboard, me, myLoans, barangayCounts] = await Promise.all([
        stateRef.current.rules ? Promise.resolve(stateRef.current.rules) : c.rules(),
        c.stats(),
        c.allPlayers(),
        c.listahan(0, listLimit.current),
        c.leaderboard(20),
        acct ? c.profile(acct) : Promise.resolve(null),
        acct ? c.loansOf(acct) : Promise.resolve([] as Loan[]),
        c.barangayCounts().catch(() => ({}) as BarangayCounts),
      ]);
      // Background events: new visitors, coins received while not acting ourselves.
      const incoming = myLoans.filter((l) => l.lender === acct && l.status === "Requested");
      if (seenRequests.current) {
        for (const l of incoming) if (!seenRequests.current.has(l.id)) bus.emit("visitor:arrived", { loan: l });
      }
      seenRequests.current = new Set(incoming.map((l) => l.id));
      const before = prevMe.current;
      if (before && me && before.account_id === me.account_id) {
        const diff = BigInt(me.balance) - BigInt(before.balance);
        if (diff > 0n && actionDepth.current === 0) {
          coinPop(`+${fmtUtang(diff)}`);
          bus.emit("coins:received", { amount: diff.toString() });
        }
        if (me.level > before.level) {
          toast({ kind: "coin", title: `Level up! You're level ${me.level}`, body: "Your neighbours trust you more." });
          bus.emit("level:up", { level: me.level });
        }
        for (const b of me.badges) {
          if (before.badges.includes(b)) continue;
          toast({ kind: "coin", title: `New badge: ${BADGES[b]?.label ?? b}`, body: BADGES[b]?.rule });
          bus.emit("badge:earned", { badge: b });
        }
        if (me.has_overdue && !before.has_overdue) {
          toast({
            kind: "err",
            title: `Overdue: ${rules.trust_overdue_borrower} trust · Bayad muna`,
            body: "You can't send coins or borrow until you repay. Repaying late still clears it.",
          });
          bus.emit("bayad:muna", { accountId: me.account_id });
        }
      }
      prevMe.current = me;
      setState((s) => ({
        ...s,
        accountId: acct,
        rules,
        stats,
        players,
        listahan,
        listahanDone: listahan.length < listLimit.current,
        leaderboard,
        me,
        myLoans,
        barangayCounts,
        loaded: true,
        loadError: undefined,
        now: backend.now(),
      }));
      bus.emit("state:refreshed", { me, stats, accountId: acct });
    } catch (e) {
      setState((s) => ({ ...s, loadError: friendlyError(e) }));
    }
  }, [backend, coinPop, toast]);

  const refresh = useCallback(async () => {
    if (refreshing.current) {
      refreshQueued.current = true;
      return refreshing.current;
    }
    const p = (async () => {
      do {
        refreshQueued.current = false;
        await doRefresh();
      } while (refreshQueued.current);
    })();
    refreshing.current = p;
    try {
      await p;
    } finally {
      refreshing.current = null;
    }
  }, [doRefresh]);

  useEffect(() => {
    if (!backend) return;
    void refresh();
    const offAcct = backend.onAccountChange((id) => {
      prevMe.current = null;
      seenRequests.current = null;
      setState((s) => ({ ...s, accountId: id, me: null, myLoans: [] }));
      bus.emit("account:changed", { accountId: id });
      void refresh();
    });
    const offChange = backend.onChange(() => void refresh());
    // Clock for countdowns.
    const clock = setInterval(() => setState((s) => ({ ...s, now: backend.now() })), 1000);
    // Preview: let the neighbours act. Live: poll the chain.
    let poll: ReturnType<typeof setInterval>;
    if (backend.preview) {
      poll = setInterval(() => backend.preview!.world.tick(), 1500);
    } else {
      // Every 6 s in demo-time builds (1 day = 1 minute), every ~20 s otherwise.
      let last = Date.now();
      poll = setInterval(() => {
        if (!stateRef.current.rules?.demo_time && Date.now() - last < 19_000) return;
        last = Date.now();
        void refresh();
      }, 6000);
    }
    return () => {
      offAcct();
      offChange();
      clearInterval(clock);
      clearInterval(poll);
    };
  }, [backend, refresh]);

  // ------------------------------------------------------------------ actions
  const run = useCallback(
    async <T,>(label: string, fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
      setState((s) => ({ ...s, busy: label }));
      actionDepth.current++;
      try {
        const value = await fn();
        return { ok: true, value };
      } catch (e) {
        const message = friendlyError(e);
        toast({ kind: "err", title: "Hindi natuloy (that didn't go through)", body: message });
        bus.emit("tx:error", { action: label, message });
        return { ok: false };
      } finally {
        await refresh();
        actionDepth.current--;
        setState((s) => ({ ...s, busy: null }));
      }
    },
    [refresh, toast],
  );

  const actions = useMemo<GameActions>(() => {
    const client = () => backend!.client;
    const loanAfter = async (id: number) => (await client().getLoan(id)) as Loan;
    return {
      refresh,
      signIn: () => backend?.signIn(),
      signOut: async () => {
        await backend?.signOut();
      },
      async join() {
        const rules = stateRef.current.rules;
        const r = await run("Opening your store…", () =>
          client().storageDeposit({ deposit: rules ? BigInt(rules.join_deposit) : undefined }),
        );
        if (r.ok) {
          toast({ kind: "ok", title: "Welcome to the barangay!", body: "Your sari-sari store is open." });
          const id = backend!.getAccountId();
          if (id) bus.emit("player:joined", { accountId: id });
        }
        return r.ok;
      },
      async ask(lender, amount, days) {
        const r = await run("Asking…", () => client().ask(lender, amount, days));
        if (!r.ok) return false;
        toast({
          kind: "ok",
          title: `Asked ${lender} for ${fmtUtang(amount)}`,
          body: `For ${days} day${days === 1 ? "" : "s"}. It's in the listahan; they decide now.`,
        });
        bus.emit("loan:asked", { loanId: r.value, lender, amount, days });
        return r.value;
      },
      async approve(id) {
        const r = await run("Approving…", () => client().approve(id));
        if (r.ok) {
          const loan = await loanAfter(id).catch(() => null);
          toast({ kind: "ok", title: "Approved. You vouched for them.", body: loan ? `${fmtUtang(loan.amount)} $UTANG minted to ${loan.borrower}.` : undefined });
          if (loan) bus.emit("loan:approved", { loan });
        }
        return r.ok;
      },
      async decline(id) {
        const r = await run("Declining…", () => client().decline(id));
        if (r.ok) {
          toast({ kind: "info", title: "Declined, politely." });
          const loan = await loanAfter(id).catch(() => null);
          if (loan) bus.emit("loan:declined", { loan });
        }
        return r.ok;
      },
      async cancel(id) {
        const r = await run("Cancelling…", () => client().cancel(id));
        if (r.ok) {
          toast({ kind: "info", title: "Request withdrawn." });
          const loan = await loanAfter(id).catch(() => null);
          if (loan) bus.emit("loan:cancelled", { loan });
        }
        return r.ok;
      },
      async repay(id) {
        const st = stateRef.current;
        const before = st.myLoans.find((l) => l.id === id) ?? (await client().getLoan(id));
        const blocker =
          before && st.rules && !before.past_due ? countBlocker(before, st.myLoans, st.rules, backend!.now()) : null;
        const r = await run("Repaying…", () => client().repay(id));
        if (!r.ok) return false;
        const loan = await loanAfter(id).catch(() => null);
        const rules = st.rules;
        if (!loan || loan.status === "Active" || loan.status === "Overdue") {
          toast({ kind: "ok", title: "Repayment sent", body: "The listahan will update in a moment." });
          return true;
        }
        const late = loan.status === "RepaidLate";
        const bonus = BigInt(loan.bonus_paid);
        if (late) {
          toast({
            kind: "ok",
            title: "Paid. Salamat!",
            body: `The debt is cleared. Paid late, so +${rules?.trust_late_repay_borrower ?? 5} trust and no bonus.`,
          });
        } else if (loan.counted) {
          const mine = bonus - bonus / 2n;
          toast({
            kind: "coin",
            title: `Counted! +${rules?.trust_on_time_borrower ?? 10} trust`,
            body:
              bonus > 0n
                ? `Bonus: +${fmtUtang(mine)} to you, +${fmtUtang(bonus / 2n)} to ${loan.lender}.`
                : "The bonus pool is empty, but it still counts for trust and their lending limit.",
          });
          if (bonus > 0n) coinPop(`+${fmtUtang(mine)}`);
        } else {
          toast({
            kind: "info",
            title: "Repaid. Too soon to count for trust",
            body: blocker ? BLOCKER_TEXT[blocker] : "The loan is closed; this repayment did not earn trust or bonus.",
          });
        }
        bus.emit("loan:repaid", { loan, counted: loan.counted, late, bonus: loan.bonus_paid });
        return true;
      },
      async markOverdue(id) {
        const r = await run("Marking overdue…", () => client().markOverdue(id));
        if (r.ok) {
          toast({ kind: "info", title: "Marked overdue", body: "It's written in the listahan. Bayad muna for the borrower until they repay." });
          const loan = await loanAfter(id).catch(() => null);
          if (loan) bus.emit("loan:overdue", { loan });
        }
        return r.ok;
      },
      async transfer(to, amount) {
        const r = await run("Sending…", () => client().ftTransfer(to, amount));
        if (r.ok) toast({ kind: "ok", title: `Sent ${fmtUtang(amount)} to ${to}` });
        return r.ok;
      },
      async setBarangay(barangay) {
        const r = await run("Moving your tindahan…", () => client().setBarangay(barangay));
        if (r.ok) toast({ kind: "ok", title: `Welcome to ${barangay}!`, body: "Your tindahan now opens on this street." });
        return r.ok;
      },
      async playersIn(barangay) {
        try {
          return await client().allPlayersIn(barangay);
        } catch {
          return stateRef.current.players.filter((p) => p.barangay === barangay);
        }
      },
      async pairCredit(other) {
        const st = stateRef.current;
        const me = backend?.getAccountId();
        if (!backend || !me) return null;
        try {
          return await client().pairCredit(me, other);
        } catch {
          // Older contract without pair_credit: count counted loans between us from loans_of.
          return st.rules ? pairCreditFromLoans(me, other, st.myLoans, st.rules) : null;
        }
      },
      async loadMoreListahan() {
        listLimit.current += PAGE;
        await refresh();
      },
      previewSignInAs(id) {
        backend?.preview?.setAccount(id);
      },
      previewSkipDays(days) {
        backend?.preview?.skipDays(days);
        setState((s) => ({ ...s, now: backend!.now() }));
      },
      previewReset() {
        prevMe.current = null;
        seenRequests.current = null;
        backend?.preview?.reset();
        toast({ kind: "info", title: "Fresh neighbourhood", body: "The preview was reset." });
      },
    };
  }, [backend, refresh, run, toast, coinPop]);

  externalApi.actions = backend ? actions : null;
  externalApi.getState = () => stateRef.current;

  const originNs = useMemo(() => {
    const first = state.players[0];
    return first ? BigInt(first.joined_at) : null;
  }, [state.players]);

  const value: Ctx = {
    ...state,
    actions,
    dismissToast,
    preview: backend?.preview,
    originNs,
  };
  return <GameContext.Provider value={value}>{children}</GameContext.Provider>;
}

export function useGame(): Ctx {
  const c = useContext(GameContext);
  if (!c) throw new Error("useGame outside GameProvider");
  return c;
}
