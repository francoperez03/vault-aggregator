'use client';

import { useCallback, useState } from 'react';
import { UserRejectedRequestError, WaitForTransactionReceiptTimeoutError } from 'viem';
import { useAccount, useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { coreAbi } from '@/lib/contracts/coreAbi';
import { usdcAbi } from '@/lib/contracts/usdcAbi';
import { getAdapterAddresses, getCoreAddress, getPeripheryAddress, getUsdcAddress } from '@/lib/contracts/config';
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

/** Explicit gas limit for every write against the Stylus core: `eth_estimateGas` under-reports
 * for Stylus→EVM calls and produced two live OOG failures on Arbitrum One (RUNBOOK-M2.md —
 * Morpho's withdraw alone needs ~578k). Unused gas is refunded on Arbitrum, so the buffer is
 * free. Measured on the production mainnet smoke test: deposit 1.6M, redeem 1.74M, rebalance 2.6M — a 2M limit OOG'd the real rebalance. The plain-EVM USDC `approve` keeps auto-estimation. */
const STYLUS_WRITE_GAS = 6_000_000n;

/**
 * Dual-runtime write hook (D-11): browser fires `approve` then `deposit` as two explicit
 * `writeContractAsync` calls, each awaiting its own receipt, spender == core. Lemon instead
 * routes through `vault-periphery.depositWithPermit` with a Permit2 `permits[]` entry in a single
 * `callSmartContract` — a Lemon smart-account wallet cannot sign a plain ERC-20 `approve` inside a
 * batch (D-A2), so Permit2's off-chain signature replaces the on-chain approve step. The permit
 * amount is always exact, never a lifetime/infinite allowance, and its spender is always the
 * periphery, never the core (D-09/D-A2). `rebalance`/`redeem` never approve — they move no new
 * USDC.
 */
export function useVaultWrite(): UseVaultWriteResult {
  const { address } = useAccount();
  const coreAddress = getCoreAddress();
  const usdcAddress = getUsdcAddress();
  const peripheryAddress = getPeripheryAddress();
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
          if (!peripheryAddress) return NOT_CONFIGURED;

          // Nonce and deadline computed ONCE, passed identically to functionParams and permits[]
          // (Pitfall 4/T-14.1-10) — a mismatch there breaks Permit2's signed-struct reconstruction.
          const nowSeconds = BigInt(Math.floor(Date.now() / 1000));
          const deadline = nowSeconds + BigInt(9);
          const nonce = BigInt(Date.now());
          const outcome = await getLemonBridge().callSmartContract({
            contracts: [
              {
                address: peripheryAddress,
                functionName: 'depositWithPermit',
                functionParams: [amount, nonce, deadline, 'PERMIT_PLACEHOLDER_0'],
                permits: [
                  {
                    owner: address,
                    token: usdcAddress,
                    spender: peripheryAddress, // MUST equal contractAddress (T-14.1-11)
                    amount: amount.toString(), // exact amount, never an unbounded/infinite value (T-14.1-11)
                    deadline: deadline.toString(),
                    nonce: nonce.toString(),
                  },
                ],
              },
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
          gas: STYLUS_WRITE_GAS,
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
    [address, coreAddress, usdcAddress, peripheryAddress, writeContractAsync, invalidate],
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
          gas: STYLUS_WRITE_GAS,
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
          gas: STYLUS_WRITE_GAS,
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
