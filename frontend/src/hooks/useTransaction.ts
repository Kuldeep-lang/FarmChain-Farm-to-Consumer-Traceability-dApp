import { useCallback, useRef, useState } from "react";
import { toast } from "sonner";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";
import { decodeError } from "@/blockchain/errors";

export type TxPhase = "idle" | "awaiting_wallet" | "submitted" | "pending" | "confirmed" | "failed";

export interface TxState {
  phase: TxPhase;
  hash: string | null;
  error: string | null;
  rejected: boolean;
  errorCode?: string;
  label?: string;
}

export const initialTx: TxState = { phase: "idle", hash: null, error: null, rejected: false };

/**
 * Runs a contract write and tracks every phase:
 *   waiting for wallet -> submitted -> pending -> confirmed | failed.
 * Success is ONLY reported after the receipt confirms with status 1.
 */
export function useTransaction() {
  const [state, setState] = useState<TxState>(initialTx);
  const busy = useRef(false);
  const lastError = useRef<string | undefined>(undefined);

  const run = useCallback(
    async (
      label: string,
      send: () => Promise<ContractTransactionResponse>,
      opts: { silent?: boolean; successMessage?: string } = {},
    ): Promise<TransactionReceipt | null> => {
      if (busy.current) return null;
      busy.current = true;
      lastError.current = undefined;
      setState({ phase: "awaiting_wallet", hash: null, error: null, rejected: false, label });
      try {
        const tx = await send();
        setState((s) => ({ ...s, phase: "submitted", hash: tx.hash }));
        setState((s) => ({ ...s, phase: "pending" }));
        const receipt = await tx.wait(1);
        if (!receipt || receipt.status !== 1) throw Object.assign(new Error("Transaction reverted on-chain"), { receipt });
        setState((s) => ({ ...s, phase: "confirmed" }));
        if (!opts.silent) toast.success(opts.successMessage ?? `${label} confirmed`, { description: `Tx ${tx.hash.slice(0, 10)}…` });
        return receipt;
      } catch (err) {
        const d = decodeError(err);
        lastError.current = d.code;
        setState((s) => ({ ...s, phase: "failed", error: d.message, rejected: d.rejected, errorCode: d.code }));
        if (!opts.silent) (d.rejected ? toast.warning : toast.error)(d.rejected ? "Transaction rejected" : `${label} failed`, { description: d.message });
        return null;
      } finally {
        busy.current = false;
      }
    },
    [],
  );

  const reset = useCallback(() => setState(initialTx), []);
  const isBusy = state.phase === "awaiting_wallet" || state.phase === "submitted" || state.phase === "pending";
  /** Decoded error code of the most recent failed run (ref-backed, safe inside async flows). */
  const lastErrorCode = useCallback(() => lastError.current, []);
  return { state, run, reset, isBusy, lastErrorCode };
}
