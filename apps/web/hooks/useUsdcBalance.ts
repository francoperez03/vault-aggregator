'use client';

import { useReadContract } from 'wagmi';
import { useWalletAddress } from '@/hooks/useWalletAddress';
import { usdcAbi } from '@/lib/contracts/usdcAbi';
import { getUsdcAddress } from '@/lib/contracts/config';

export interface UseUsdcBalanceResult {
  /** The connected address's USDC balance. 0n while loading, disconnected or unconfigured — the
   * caller decides whether that reads as "sin saldo" or as "todavía no sé", via `isLoading`. */
  balance: bigint;
  isLoading: boolean;
  /** No wallet, no balance to speak of. Distinct from `balance === 0n`, which is a real answer:
   * rendering `$0.00` to a disconnected visitor states something we never read. */
  isConnected: boolean;
  refetch: () => void;
}

/**
 * Reads `USDC.balanceOf(user)` — what the wallet actually holds, which is NOT the vault position
 * (`useVaultPosition`) nor the mini-app pending settlement (`useWithdrawFlow`). Same shape as
 * `useUsdcAllowance` on purpose: one read, no polling, refetched by the caller after a write.
 */
export function useUsdcBalance(): UseUsdcBalanceResult {
  const user = useWalletAddress();
  const usdcAddress = getUsdcAddress();

  const { data, isLoading, refetch } = useReadContract({
    address: usdcAddress,
    abi: usdcAbi,
    functionName: 'balanceOf',
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user && usdcAddress) },
  });

  return {
    balance: data ?? 0n,
    isLoading,
    isConnected: Boolean(user),
    refetch: () => void refetch(),
  };
}
