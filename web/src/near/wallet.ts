// NEAR wallet connection via @near-wallet-selector (MyNearWallet, Meteor, HERE) and the live Transport.
// This module is only loaded (dynamic import) when VITE_CONTRACT_ID is set.

import "@near-wallet-selector/modal-ui/styles.css";
import { actionCreators, setupWalletSelector, type WalletSelector } from "@near-wallet-selector/core";
import { setupModal, type WalletSelectorModal } from "@near-wallet-selector/modal-ui";
import { setupMyNearWallet } from "@near-wallet-selector/my-near-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { CONTRACT_ID, GAS, NETWORK, RPC_URL } from "./config";
import { viewCall, errorText } from "./rpc";
import { ContractError, type CallOptions, type Transport } from "./transport";
import { decodeOutcome } from "./outcome";
export { decodeOutcome };

export interface WalletHandle {
  selector: WalletSelector;
  modal: WalletSelectorModal;
  transport: LiveTransport;
  getAccountId(): string | null;
  onAccountChange(fn: (accountId: string | null) => void): () => void;
  signIn(): void;
  signOut(): Promise<void>;
}

export class LiveTransport implements Transport {
  readonly kind = "live" as const;
  constructor(private readonly selector: WalletSelector) {}

  view<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    return viewCall<T>(method, args);
  }

  async call<T>(method: string, args: Record<string, unknown>, opts: CallOptions = {}): Promise<T | undefined> {
    const wallet = await this.selector.wallet();
    try {
      const outcome = await wallet.signAndSendTransaction({
        receiverId: CONTRACT_ID,
        actions: [actionCreators.functionCall(method, args, opts.gas ?? GAS, opts.deposit ?? 0n)],
      });
      return decodeOutcome<T>(outcome);
    } catch (e) {
      throw new ContractError(errorText(e));
    }
  }
}

export async function initWallet(): Promise<WalletHandle> {
  const selector = await setupWalletSelector({
    network: NETWORK,
    fallbackRpcUrls: [RPC_URL],
    modules: [setupMyNearWallet(), setupMeteorWallet(), setupHereWallet()],
  });
  const modal = setupModal(selector, {
    contractId: CONTRACT_ID,
    theme: "light",
    description: "Connect a NEAR wallet to open your sari-sari store.",
  });
  const getAccountId = () => {
    const accounts = selector.store.getState().accounts;
    return accounts.find((a) => a.active)?.accountId ?? accounts[0]?.accountId ?? null;
  };
  return {
    selector,
    modal,
    transport: new LiveTransport(selector),
    getAccountId,
    onAccountChange(fn) {
      let last = getAccountId();
      const sub = selector.store.observable.subscribe(() => {
        const id = getAccountId();
        if (id !== last) {
          last = id;
          fn(id);
        }
      });
      return () => sub.unsubscribe();
    },
    signIn: () => modal.show(),
    async signOut() {
      const wallet = await selector.wallet();
      await wallet.signOut();
    },
  };
}
