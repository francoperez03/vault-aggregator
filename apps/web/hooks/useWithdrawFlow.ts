'use client';

import { useCallback, useEffect, useState } from 'react';
import { usePublicClient } from 'wagmi';
import { useWalletAddress } from '@/hooks/useWalletAddress';
import { usdcAbi } from '@/lib/contracts/usdcAbi';
import { getUsdcAddress } from '@/lib/contracts/config';
import { useVaultWrite } from '@/hooks/useVaultWrite';
import { getLemonBridge } from '@/lib/lemon/bridge';
import { reconcileWithdrawal } from '@/lib/vault/reconcile';
import type { TxPhase } from '@/components/vault-aggregator/transaction-state';

const LEMON_FAILED_COPY =
  'Lemon no pudo completar este paso. Tus fondos on-chain están seguros en el saldo de la app.';
const NOT_CONFIGURED: TxPhase = { kind: 'reverted', reason: 'La wallet o el contrato no están configurados.' };

function storageKey(address: string): string {
  return `vault-pending-settlement:${address}`;
}

/** T-14-10-02: this value is a UI reminder, never the source of truth for what step 2 actually
 * sends — settleToLemon() below always sends the in-memory `pendingAmount` it just measured or
 * loaded, and a manipulated localStorage value only changes what the banner claims, not what
 * moves. */
function readPendingAmount(address?: `0x${string}`): bigint | null {
  if (!address || typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(storageKey(address));
  if (raw === null) return null;
  try {
    return BigInt(raw);
  } catch {
    return null;
  }
}

function writePendingAmount(address: `0x${string}`, amount: bigint | null): void {
  if (typeof window === 'undefined') return;
  if (amount === null) window.localStorage.removeItem(storageKey(address));
  else window.localStorage.setItem(storageKey(address), amount.toString());
}

interface UseWithdrawFlowResult {
  step: 1 | 2
  /** The write hook's lifecycle stage while step 1's redeem is in flight (TxButton fuel). */
  txStage: import('@/hooks/useVaultWrite').TxStage;
  /** Measured in step 1, survives a refresh via localStorage (T-14-10-02). */
  pendingAmount: bigint | null;
  phase: TxPhase;
  /** Resolves with the phase it settled on, so a caller that queues the move can report it. */
  redeem: (bps: bigint) => Promise<TxPhase>;
  settleToLemon: () => Promise<void>;
  /** Clears the flow's state after a `partial` result has been shown and acknowledged. */
  acknowledge: () => void;
  /** Forgets the parked amount once it left for Lemon by some other path — the account card sends
   * arbitrary amounts, not only the exact one a redeem measured. */
  clearPending: () => void;
}

/**
 * Orchestrates the two-step withdrawal (D-19): step 1 fires the real on-chain `redeem(bps)` and
 * measures the USDC that landed in the mini-app balance from a balance delta, never from the tx
 * arguments; step 2 hands that measured amount, never the originally requested one, to
 * `getLemonBridge().withdraw`. A revert in step 1 is atomic and never produces a `partial` result
 * (Pitfall 4) — only step 2's SDK call can settle for less than it was asked to move.
 */
export function useWithdrawFlow(): UseWithdrawFlowResult {
  const address = useWalletAddress();
  const publicClient = usePublicClient();
  const usdcAddress = getUsdcAddress();
  const { redeem: redeemOnChain, txStage } = useVaultWrite();

  const [phase, setPhase] = useState<TxPhase>({ kind: 'confirm' });
  const [pendingAmount, setPendingAmount] = useState<bigint | null>(null);
  const [step, setStep] = useState<1 | 2>(1);

  useEffect(() => {
    const persisted = readPendingAmount(address);
    setPendingAmount(persisted);
    setStep(persisted !== null ? 2 : 1);
  }, [address]);

  const redeem = useCallback(
    async (bps: bigint): Promise<TxPhase> => {
      if (!address || !usdcAddress || !publicClient) {
        setPhase(NOT_CONFIGURED);
        return NOT_CONFIGURED;
      }

      setPhase({ kind: 'signing' });
      const balanceBefore = (await publicClient.readContract({
        address: usdcAddress,
        abi: usdcAbi,
        functionName: 'balanceOf',
        args: [address],
      })) as bigint;

      const outcome = await redeemOnChain(bps);

      // Pitfall 4: step 1's redeem is atomic on-chain. A non-success outcome renders as its own
      // phase (reverted/rejected/timeout) and never as `partial` — that state exists only in step 2.
      if (outcome.kind !== 'success') {
        setPhase(outcome);
        return outcome;
      }

      const balanceAfter = (await publicClient.readContract({
        address: usdcAddress,
        abi: usdcAbi,
        functionName: 'balanceOf',
        args: [address],
      })) as bigint;

      const arrived = balanceAfter - balanceBefore;
      writePendingAmount(address, arrived);
      setPendingAmount(arrived);
      setStep(2);
      setPhase({ kind: 'confirm' });
      return { kind: 'success', amount: arrived };
    },
    [address, usdcAddress, publicClient, redeemOnChain],
  );

  const settleToLemon = useCallback(async () => {
    if (!address || pendingAmount === null) return;

    setPhase({ kind: 'signing' });
    let outcome = await getLemonBridge().withdraw({ amount: pendingAmount, tokenName: 'USDC' });

    if (outcome.result === 'PENDING') {
      outcome = await outcome.settle();
    }

    if (outcome.result === 'CANCELLED') {
      setPhase({ kind: 'rejected' });
      return;
    }

    if (outcome.result === 'FAILED') {
      setPhase({ kind: 'reverted', reason: LEMON_FAILED_COPY, detail: outcome.detail });
      return;
    }

    // SUCCESS or PENDING: Lemon accepted the transfer and moves the funds itself (PENDING is
    // "accepted, in flight" on this off-chain boundary, the same reading BananitaSwap ships with;
    // showing it as a timeout sent users to retry a transfer already under way). Reconcile what
    // Lemon reports it moved against what step 1 measured, never the requested-at-step-1 amount.
    const moved = (outcome.result === 'SUCCESS' ? outcome.amount : undefined) ?? pendingAmount;
    const reconciliation = reconcileWithdrawal({
      requested: pendingAmount,
      balanceBefore: pendingAmount,
      balanceAfter: pendingAmount - moved,
    });

    if (reconciliation.outcome === 'partial') {
      writePendingAmount(address, reconciliation.remaining);
      setPendingAmount(reconciliation.remaining);
      setPhase({
        kind: 'partial',
        requested: reconciliation.requested,
        actual: reconciliation.actual,
        remaining: reconciliation.remaining,
      });
      return;
    }

    writePendingAmount(address, null);
    setPendingAmount(null);
    setPhase({ kind: 'success', amount: reconciliation.actual });
  }, [address, pendingAmount]);

  const acknowledge = useCallback(() => {
    setPhase({ kind: 'confirm' });
  }, []);

  const clearPending = useCallback(() => {
    if (!address) return;
    writePendingAmount(address, null);
    setPendingAmount(null);
    setStep(1);
  }, [address]);

  return { step, pendingAmount, phase, txStage, redeem, settleToLemon, acknowledge, clearPending };
}
