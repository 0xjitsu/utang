// A tiny typed event bus so other layers (e.g. a future Phaser street scene with sound) can
// listen to what happens in the game and open React screens without touching React state.
//
//   import { bus } from "./game/bus";
//   bus.on("loan:repaid", ({ counted }) => playSound(counted ? "coins" : "ding"));
//   bus.emit("open:profile", { accountId: "ana.testnet" });
//
// It is also exposed as `window.utang.bus` (see GameProvider).

import type { Loan, Profile, Stats } from "../near/types";

export type Screen = "store" | "map" | "listahan" | "neighbours" | "leaderboard" | "economy";

export interface BusEvents {
  // --- things that happened (emitted by the game) ---
  "state:refreshed": { me: Profile | null; stats: Stats | null; accountId: string | null };
  "account:changed": { accountId: string | null };
  "player:joined": { accountId: string };
  "loan:asked": { loanId: number | undefined; lender: string; amount: string; days: number };
  "loan:approved": { loan: Loan };
  "loan:declined": { loan: Loan };
  "loan:cancelled": { loan: Loan };
  "loan:repaid": { loan: Loan; counted: boolean; late: boolean; bonus: string };
  "loan:overdue": { loan: Loan };
  "coins:received": { amount: string };
  "visitor:arrived": { loan: Loan };
  "tx:error": { action: string; message: string };
  "level:up": { level: number };
  "badge:earned": { badge: string };
  /** The signed-in player just got an overdue loan (transfers and asks blocked). */
  "bayad:muna": { accountId: string };
  "screen:changed": { screen: Screen };
  /** Ask the sound layer to play a named effect (e.g. footsteps from the street scene). */
  "sfx": { name: string };
  // --- commands (anyone may emit; the React app obeys) ---
  "open:screen": { screen: Screen };
  "open:profile": { accountId: string };
  "open:ask": { lender: string };
  /** Open your own store dialog, optionally on a section. */
  "open:store": { view?: "requests" | "debts" };
  /** Open the "Where's your tindahan?" barangay picker. */
  "open:picker": Record<string, never>;
  /** Travel by jeepney to a barangay's street (null = home). */
  "travel": { barangay: string | null };
  /** Quest finished with a counted repayment. */
  "quest:complete": { counted: boolean };
}

type Handler<K extends keyof BusEvents> = (payload: BusEvents[K]) => void;

class Bus {
  private handlers = new Map<keyof BusEvents, Set<Handler<any>>>();

  on<K extends keyof BusEvents>(event: K, fn: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) this.handlers.set(event, (set = new Set()));
    set.add(fn);
    return () => set!.delete(fn);
  }

  emit<K extends keyof BusEvents>(event: K, payload: BusEvents[K]) {
    for (const fn of this.handlers.get(event) ?? []) {
      try {
        fn(payload);
      } catch (e) {
        console.error(`[bus] ${String(event)} handler failed`, e);
      }
    }
  }
}

export const bus = new Bus();
