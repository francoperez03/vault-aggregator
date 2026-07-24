'use client';

import { useCallback, useState } from 'react';
import { UserRejectedRequestError, WaitForTransactionReceiptTimeoutError } from 'viem';
import { useAccount, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { coreAbi } from '@/lib/contracts/coreAbi';
import { usdcAbi } from '@/lib/contracts/usdcAbi';
import { getAdapterAddresses, getCoreAddress, getUsdcAddress } from '@/lib/contracts/config';
import { toContractWeights, type AllocationBps } from '@/lib/vault/weights';
import { wagmiConfig } from '@/lib/wagmi/config';
import { getLemonBridge, isLemonWebView, type LemonTxOutcome } from '@/lib/lemon/bridge';
import { useVaultPosition } from '@/hooks/useVaultPosition';
import { useUsdcAllowance } from '@/hooks/useUsdcAllowance';
import type { TxPhase } from '@/components/vault-aggregator/transaction-state';

/** Maps a Lemon SDK outcome to the shared five-state machine (T-14-09-05). A revert is always
 * `reverted`, never `partial` (Pitfall 4); an unresolved PENDING is `timeout`, never `success`
 * (Pitfall 2/6) — this hook does not poll `settle()`, so a batched call that comes back PENDING
 * without having already resolved renders exactly like a timed-out one. */
export function toTxPhase(outcome: LemonTxOutcome): TxPhase {
  switch (outcome.result) {
    case 'SUCCESS':
      return { kind: 'success', amount: outcome.amount };
    case 'CANCELLED':
      return { kind: 'rejected' };
    case 'FAILED':
      return { kind: 'reverted', reason: outcome.error };
    case 'PENDING':
      return { kind: 'timeout', txHash: outcome.txHash };
  }
}

/** A browser-runtime write failure: a user cancel is `rejected`, a stuck receipt wait is
 * `timeout`, anything else is `reverted` carrying the error's own message as the reason —
 * never silently swallowed. */
function browserErrorToPhase(error: unknown): TxPhase {
  if (error instanceof UserRejectedRequestError) return { kind: 'rejected' };
  if (error instanceof WaitForTransactionReceiptTimeoutError) return { kind: 'timeout' };
  return { kind: 'reverted', reason: error instanceof Error ? error.message : undefined };
}

type DepositStep = 'idle' | 'approving' | 'depositing';

interface UseVaultWriteResult {
  /** Browser runtime only: which of the two signatures is in flight (D-09's two visible steps). */
  depositStep: DepositStep;
  isSubmitting: boolean;
  deposit: (amount: bigint) => Promise<TxPhase>;
  rebalance: (allocation: AllocationBps) => Promise<TxPhase>;
  redeem: (bps: bigint) => Promise<TxPhase>;
}

const NOT_CONFIGURED: TxPhase = { kind: 'reverted', reason: 'La wallet o el contrato no están configurados.' };

/**
 * Dual-runtime write hook (D-11): browser fires `approve` then `deposit` as two explicit
 * `writeContractAsync` calls, each awaiting its own receipt; Lemon submits the same two calls as
 * one `callSmartContract` batch. The approve amount is always exact, never a lifetime/infinite
 * allowance, never a spender other than the core (D-09). `rebalance`/`redeem` never approve —
 * they move no new USDC.
 */
export function useVaultWrite(): UseVaultWriteResult {
  const { address } = useAccount();
  const coreAddress = getCoreAddress();
  const usdcAddress = getUsdcAddress();
  const adapterAddresses = getAdapterAddresses();
  const { writeContractAsync } = useWriteContract();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [depositStep, setDepositStep] = useState<DepositStep>('idle');
  const { refetch: refetchPosition } = useVaultPosition();
  // amount is irrelevant here — only `refetch` is used, to invalidate the same allowance read
  // deposit-approve-step.tsx subscribes to (T-14-09-04).
  const { refetch: refetchAllowance } = useUsdcAllowance(0n);

  const invalidate = useCallback(() => {
    refetchPosition();
    refetchAllowance();
  }, [refetchPosition, refetchAllowance]);

  const deposit = useCallback(
    async (amount: bigint): Promise<TxPhase> => {
      if (!coreAddress || !usdcAddress || !address) return NOT_CONFIGURED;

      setIsSubmitting(true);
      try {
        if (isLemonWebView()) {
          const outcome = await getLemonBridge().callSmartContract({
            contracts: [
              { address: usdcAddress, functionName: 'approve', functionParams: [coreAddress, amount] },
              { address: coreAddress, functionName: 'deposit', functionParams: [amount] },
            ],
          });
          return toTxPhase(outcome);
        }

        setDepositStep('approving');
        const approveHash = await writeContractAsync({
          address: usdcAddress,
          abi: usdcAbi,
          functionName: 'approve',
          args: [coreAddress, amount],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: approveHash });

        setDepositStep('depositing');
        const depositHash = await writeContractAsync({
          address: coreAddress,
          abi: coreAbi,
          functionName: 'deposit',
          args: [amount],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash: depositHash });

        return { kind: 'success', amount };
      } catch (error) {
        return browserErrorToPhase(error);
      } finally {
        setDepositStep('idle');
        setIsSubmitting(false);
        invalidate();
      }
    },
    [address, coreAddress, usdcAddress, writeContractAsync, invalidate],
  );

  const rebalance = useCallback(
    async (allocation: AllocationBps): Promise<TxPhase> => {
      if (!coreAddress) return NOT_CONFIGURED;

      let adapters: `0x${string}`[];
      let weightsBps: bigint[];
      try {
        ({ adapters, bps: weightsBps } = toContractWeights(allocation, adapterAddresses));
      } catch (weightsError) {
        return { kind: 'reverted', reason: weightsError instanceof Error ? weightsError.message : undefined };
      }

      setIsSubmitting(true);
      try {
        if (isLemonWebView()) {
          const outcome = await getLemonBridge().callSmartContract({
            contracts: [{ address: coreAddress, functionName: 'rebalance', functionParams: [adapters, weightsBps] }],
          });
          return toTxPhase(outcome);
        }

        const hash = await writeContractAsync({
          address: coreAddress,
          abi: coreAbi,
          functionName: 'rebalance',
          args: [adapters, weightsBps],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash });
        return { kind: 'success' };
      } catch (error) {
        return browserErrorToPhase(error);
      } finally {
        setIsSubmitting(false);
        invalidate();
      }
    },
    [coreAddress, adapterAddresses, writeContractAsync, invalidate],
  );

  const redeem = useCallback(
    async (bps: bigint): Promise<TxPhase> => {
      if (!coreAddress) return NOT_CONFIGURED;

      setIsSubmitting(true);
      try {
        if (isLemonWebView()) {
          const outcome = await getLemonBridge().callSmartContract({
            contracts: [{ address: coreAddress, functionName: 'redeem', functionParams: [bps] }],
          });
          return toTxPhase(outcome);
        }

        const hash = await writeContractAsync({
          address: coreAddress,
          abi: coreAbi,
          functionName: 'redeem',
          args: [bps],
        });
        await waitForTransactionReceipt(wagmiConfig, { hash });
        return { kind: 'success' };
      } catch (error) {
        return browserErrorToPhase(error);
      } finally {
        setIsSubmitting(false);
        invalidate();
      }
    },
    [coreAddress, writeContractAsync, invalidate],
  );

  return { depositStep, isSubmitting, deposit, rebalance, redeem };
}
