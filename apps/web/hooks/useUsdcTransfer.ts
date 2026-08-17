'use client';

import { useCallback, useState } from 'react';
import { useWriteContract } from 'wagmi';
import { waitForTransactionReceipt } from 'wagmi/actions';
import { usdcAbi } from '@/lib/contracts/usdcAbi';
import { getUsdcAddress } from '@/lib/contracts/config';
import { wagmiConfig } from '@/lib/wagmi/config';
import { browserErrorToPhase } from '@/hooks/useVaultWrite';
import type { TxPhase } from '@/components/vault-aggregator/transaction-state';

export interface UseUsdcTransferResult {
  phase: TxPhase | null;
  isBusy: boolean;
  /** Plain ERC-20 `transfer` from the connected wallet to `to`. Web only: inside Lemon the way out
   * is the Lemon account, never an arbitrary address. */
  send: (to: `0x${string}`, amount: bigint) => Promise<TxPhase>;
  reset: () => void;
}

const NOT_CONFIGURED: TxPhase = { kind: 'reverted', reason: 'El token USDC no está configurado.' };

export function useUsdcTransfer(): UseUsdcTransferResult {
  const [phase, setPhase] = useState<TxPhase | null>(null);
  const { writeContractAsync } = useWriteContract();
  const usdcAddress = getUsdcAddress();

  const send = useCallback(
    async (to: `0x${string}`, amount: bigint): Promise<TxPhase> => {
      if (!usdcAddress) {
        setPhase(NOT_CONFIGURED);
        return NOT_CONFIGURED;
      }
      setPhase({ kind: 'signing' });
      try {
        // No explicit gas: a plain EVM transfer estimates fine (only Stylus writes need the 6M pin).
        const hash = await writeContractAsync({
          address: usdcAddress,
          abi: usdcAbi,
          functionName: 'transfer',
          args: [to, amount],
        });
        setPhase({ kind: 'pending', txHash: hash });
        await waitForTransactionReceipt(wagmiConfig, { hash });
        const done: TxPhase = { kind: 'success', amount };
        setPhase(done);
        return done;
      } catch (error) {
        const failed = browserErrorToPhase(error, { op: 'usdc-transfer', to, amount: amount.toString() });
        setPhase(failed);
        return failed;
      }
    },
    [usdcAddress, writeContractAsync],
  );

  return {
    phase,
    isBusy: phase?.kind === 'signing' || phase?.kind === 'pending',
    send,
    reset: useCallback(() => setPhase(null), []),
  };
}
