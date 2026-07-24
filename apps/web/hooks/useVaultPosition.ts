'use client';

import { useAccount, useReadContracts } from 'wagmi';
import { coreAbi } from '@/lib/contracts/coreAbi';
import { adapterAbi } from '@/lib/contracts/adapterAbi';
import { ADAPTER_IDS, getAdapterAddresses, getCoreAddress, type AdapterId } from '@/lib/contracts/config';
import { positionValue } from '@/lib/vault/valuation';

export interface VaultPositionAdapter {
  shares: bigint;
  adapterTotalShares: bigint;
  totalAssets: bigint;
  valueUsdc: bigint;
  weightBps: number;
  /** Set when any of this adapter's four reads failed (D-21/T-14-08-04): the value is never
   * estimated or treated as zero, the caller renders an explicit "not available" state. */
  unavailable?: boolean;
}

export interface VaultPosition {
  perAdapter: Partial<Record<AdapterId, VaultPositionAdapter>>;
  totalUsdc: bigint;
  hasWeights: boolean;
  isLoading: boolean;
  refetch: () => void;
}

/** Reads per adapter in the single multicall, in this exact order (D-25). */
const READS_PER_ADAPTER = 4;

/** ~ one Arbitrum block: short enough that writes elsewhere invalidate long before this would
 * silently serve stale data on its own (T-14-08-02 still requires an explicit refetch after a
 * write — this staleTime only governs passive background refresh). */
const STALE_TIME_MS = 3_000;

/**
 * D-21: composes a user's vault position from a single `useReadContracts` multicall
 * (`sharesOf`, `adapterTotalShares`, `adapter.totalAssets()`, `weightBpsOf`, per adapter) and
 * values each adapter in USDC via `positionValue` — the exact virtual-offset share-math replica,
 * never a simplified division. Never infers a total from the core's own token balance (the
 * vector 12.1 D-10 closed).
 */
export function useVaultPosition(): VaultPosition {
  const { address: user } = useAccount();
  const coreAddress = getCoreAddress();
  const adapterAddresses = getAdapterAddresses();
  const configuredIds = ADAPTER_IDS.filter((id) => adapterAddresses[id]);

  const contracts = configuredIds.flatMap((id) => {
    const adapter = adapterAddresses[id] as `0x${string}`;
    return [
      { address: coreAddress, abi: coreAbi, functionName: 'sharesOf', args: user ? [user, adapter] : undefined },
      { address: coreAddress, abi: coreAbi, functionName: 'adapterTotalShares', args: [adapter] },
      { address: adapter, abi: adapterAbi, functionName: 'totalAssets' },
      { address: coreAddress, abi: coreAbi, functionName: 'weightBpsOf', args: user ? [user, adapter] : undefined },
    ] as const;
  });

  const enabled = Boolean(user && coreAddress && configuredIds.length > 0);

  const { data, isLoading, refetch } = useReadContracts({
    contracts,
    query: { enabled: enabled, staleTime: STALE_TIME_MS },
  });

  const perAdapter: VaultPosition['perAdapter'] = {};
  let totalUsdc = 0n;
  let hasWeights = false;

  if (data) {
    configuredIds.forEach((id, index) => {
      const base = index * READS_PER_ADAPTER;
      const sharesRead = data[base];
      const totalSharesRead = data[base + 1];
      const totalAssetsRead = data[base + 2];
      const weightRead = data[base + 3];

      const allOk =
        sharesRead?.status === 'success' &&
        totalSharesRead?.status === 'success' &&
        totalAssetsRead?.status === 'success' &&
        weightRead?.status === 'success';

      if (!allOk) {
        perAdapter[id] = {
          shares: 0n,
          adapterTotalShares: 0n,
          totalAssets: 0n,
          valueUsdc: 0n,
          weightBps: 0,
          unavailable: true,
        };
        return;
      }

      const shares = sharesRead.result as bigint;
      const adapterTotalShares = totalSharesRead.result as bigint;
      const totalAssets = totalAssetsRead.result as bigint;
      const weightBps = Number(weightRead.result as bigint);
      const valueUsdc = positionValue(shares, adapterTotalShares, totalAssets);

      perAdapter[id] = { shares, adapterTotalShares, totalAssets, valueUsdc, weightBps };
      totalUsdc += valueUsdc;
      if (weightBps > 0) hasWeights = true;
    });
  }

  return {
    perAdapter,
    totalUsdc,
    hasWeights,
    isLoading,
    refetch: () => void refetch(),
  };
}
