'use client';

import { useReadContract } from 'wagmi';
import { useWalletAddress } from '@/hooks/useWalletAddress';
import { usdcAbi } from '@/lib/contracts/usdcAbi';
import { getCoreAddress, getUsdcAddress } from '@/lib/contracts/config';

export interface UseUsdcAllowanceResult {
  allowance: bigint;
  /** D-09: approve is per-deposit, exact amount — expect this to flip back to `true` right after
   * a deposit consumes the approved amount to zero, never a lifetime allowance to check off once. */
  needsApproval: boolean;
  isLoading: boolean;
  refetch: () => void;
}

/**
 * Reads `USDC.allowance(user, core)`. The spender is ALWAYS `getCoreAddress()` — no other
 * approval target exists here, no infinite/lifetime allowance is ever compared (D-08/D-09).
 */
export function useUsdcAllowance(amount: bigint): UseUsdcAllowanceResult {
  const user = useWalletAddress();
  const coreAddress = getCoreAddress();
  const usdcAddress = getUsdcAddress();

  const { data, isLoading, refetch } = useReadContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: 'allowance',
    args: user && coreAddress ? [user, coreAddress] : undefined,
    query: { enabled: Boolean(user && coreAddress && usdcAddress) },
  });

  const allowance = data ?? 0n;

  return {
    allowance,
    needsApproval: allowance < amount,
    isLoading,
    refetch: () => void refetch(),
  };
}
