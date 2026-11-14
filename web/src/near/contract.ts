// Typed client: one function per method in docs/INTERFACE.md.
// Works over any Transport (live NEAR RPC + wallet, or the preview mock).

import { GAS, JOIN_DEPOSIT_YOCTO, ONE_YOCTO } from "./config";
import type { Transport } from "./transport";
import type {
  BarangayCounts,
  FtMetadata,
  Loan,
  PairCredit,
  Profile,
  Rules,
  Stats,
  StorageBalance,
  StorageBalanceBounds,
  U128,
} from "./types";

export class UtangClient {
  constructor(readonly transport: Transport) {}

  get kind() {
    return this.transport.kind;
  }

  // ---------------------------------------------------------------- views

  rules(): Promise<Rules> {
    return this.transport.view<Rules>("rules");
  }

  getLoan(loanId: number): Promise<Loan | null> {
    return this.transport.view<Loan | null>("get_loan", { loan_id: loanId });
  }

  /** Loans where the account is lender or borrower, newest first. */
  loansOf(accountId: string): Promise<Loan[]> {
    return this.transport.view<Loan[]>("loans_of", { account_id: accountId });
  }

  /** All loans, newest first. `fromIndex` is an offset into that newest-first list. */
  listahan(fromIndex?: number, limit?: number): Promise<Loan[]> {
    return this.transport.view<Loan[]>("listahan", clean({ from_index: fromIndex, limit }));
  }

  overdue(): Promise<Loan[]> {
    return this.transport.view<Loan[]>("overdue");
  }

  profile(accountId: string): Promise<Profile | null> {
    return this.transport.view<Profile | null>("profile", { account_id: accountId });
  }

  /** Registered players in join order. */
  players(fromIndex?: number, limit?: number): Promise<Profile[]> {
    return this.transport.view<Profile[]>("players", clean({ from_index: fromIndex, limit }));
  }

  leaderboard(limit?: number): Promise<Profile[]> {
    return this.transport.view<Profile[]>("leaderboard", clean({ limit }));
  }

  /** Credit between an unordered pair: first_loan_cap × (1 + counted repayments between them). */
  pairCredit(a: string, b: string): Promise<PairCredit> {
    return this.transport.view<PairCredit>("pair_credit", { a, b });
  }

  /** Players living in a barangay, in join order. Unknown names give []. */
  playersIn(barangay: string, fromIndex?: number, limit?: number): Promise<Profile[]> {
    return this.transport.view<Profile[]>("players_in", clean({ barangay, from_index: fromIndex, limit }));
  }

  /** Every player in a barangay, paging through players_in. */
  async allPlayersIn(barangay: string, pageSize = 50, max = 1000): Promise<Profile[]> {
    const out: Profile[] = [];
    while (out.length < max) {
      const page = await this.playersIn(barangay, out.length, pageSize);
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  barangayCounts(): Promise<BarangayCounts> {
    return this.transport.view<BarangayCounts>("barangay_counts");
  }

  stats(): Promise<Stats> {
    return this.transport.view<Stats>("stats");
  }

  // NEP-141 / NEP-145 / NEP-148 views
  ftBalanceOf(accountId: string): Promise<U128> {
    return this.transport.view<U128>("ft_balance_of", { account_id: accountId });
  }

  ftTotalSupply(): Promise<U128> {
    return this.transport.view<U128>("ft_total_supply");
  }

  ftMetadata(): Promise<FtMetadata> {
    return this.transport.view<FtMetadata>("ft_metadata");
  }

  storageBalanceOf(accountId: string): Promise<StorageBalance | null> {
    return this.transport.view<StorageBalance | null>("storage_balance_of", { account_id: accountId });
  }

  storageBalanceBounds(): Promise<StorageBalanceBounds> {
    return this.transport.view<StorageBalanceBounds>("storage_balance_bounds");
  }

  /** Fetches every player by paging through `players`. */
  async allPlayers(pageSize = 50, max = 1000): Promise<Profile[]> {
    const out: Profile[] = [];
    while (out.length < max) {
      const page = await this.players(out.length, pageSize);
      out.push(...page);
      if (page.length < pageSize) break;
    }
    return out;
  }

  // ---------------------------------------------------------------- change methods

  /** Join the neighbourhood: NEP-145 storage deposit of exactly the join deposit (0.01 NEAR). */
  storageDeposit(opts: { accountId?: string; deposit?: bigint } = {}): Promise<StorageBalance | undefined> {
    return this.transport.call<StorageBalance>(
      "storage_deposit",
      clean({ account_id: opts.accountId, registration_only: true }),
      { deposit: opts.deposit ?? JOIN_DEPOSIT_YOCTO, gas: GAS },
    );
  }

  /** Ask `lender` for a loan. Returns the new loan id (undefined if the wallet redirected). */
  ask(lender: string, amount: U128, days: number): Promise<number | undefined> {
    return this.transport.call<number>("ask", { lender, amount, days }, { gas: GAS });
  }

  approve(loanId: number): Promise<void> {
    return this.transport.call<void>("approve", { loan_id: loanId }, { gas: GAS }).then(() => undefined);
  }

  decline(loanId: number): Promise<void> {
    return this.transport.call<void>("decline", { loan_id: loanId }, { gas: GAS }).then(() => undefined);
  }

  cancel(loanId: number): Promise<void> {
    return this.transport.call<void>("cancel", { loan_id: loanId }, { gas: GAS }).then(() => undefined);
  }

  repay(loanId: number): Promise<void> {
    return this.transport.call<void>("repay", { loan_id: loanId }, { gas: GAS }).then(() => undefined);
  }

  markOverdue(loanId: number): Promise<void> {
    return this.transport.call<void>("mark_overdue", { loan_id: loanId }, { gas: GAS }).then(() => undefined);
  }

  /** Pick or change your barangay (must match rules().barangays exactly). No deposit. */
  setBarangay(barangay: string): Promise<void> {
    return this.transport.call<void>("set_barangay", { barangay }, { gas: GAS }).then(() => undefined);
  }

  /** NEP-141 transfer. Needs exactly 1 yoctoNEAR. Blocked by the contract while the sender is overdue. */
  ftTransfer(receiverId: string, amount: U128, memo?: string): Promise<void> {
    return this.transport
      .call<void>("ft_transfer", clean({ receiver_id: receiverId, amount, memo }), { deposit: ONE_YOCTO, gas: GAS })
      .then(() => undefined);
  }
}

function clean(o: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(o)) if (v !== undefined) out[k] = v;
  return out;
}
