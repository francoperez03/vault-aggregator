'use client';

import { useEffect, useRef, useState } from 'react';
import { useChainId } from 'wagmi';
import { useWalletAddress } from '@/hooks/useWalletAddress';
import {
  CAP_SECONDS,
  MIN_SAMPLE_INTERVAL_S,
  deriveRate,
  extrapolate,
  readSnapshot,
  snapshotKey,
  writeSnapshot,
  type YieldSnapshot,
} from '@/lib/vault/yieldSnapshot';
import { ADAPTER_IDS, type AdapterId } from '@/lib/contracts/config';
import type { VaultPosition } from '@/hooks/useVaultPosition';

export type YieldState = 'flat' | 'up' | 'down';

export interface UseVaultYieldResult {
  perAdapter: Partial<Record<AdapterId, { displayedValueUsdc: bigint; rate: number; state: YieldState }>>;
  totalDisplayedUsdc: bigint;
}

interface UseVaultYieldOpts {
  chainId?: number;
  address?: `0x${string}`;
  /** Bump this (e.g. a tx hash or a counter) after a completed rebalance/deposit/withdraw to
   * rebase every adapter's baseline without deriving a rate from the one-time share jump
   * (Pitfall 2). */
  txNonce?: number | string;
}

interface RateEntry {
  rate: number;
  lastSample: YieldSnapshot;
}

/**
 * VFE-02's client-state half: turns `useVaultPosition()`'s already-fetched `perAdapter` output
 * into a live, per-adapter ticking counter. Takes `perAdapter` as an argument and never issues its
 * own multicall (research §Don't Hand-Roll). Persists one localStorage snapshot per adapter,
 * derives a rate from the last two samples gated by `MIN_SAMPLE_INTERVAL_S` (avoids rounding-noise
 * jitter, Pitfall 3), and re-renders once per second via `setInterval`.
 *
 * Pitfall 1: `totalDisplayedUsdc` is always the sum of the per-adapter rows, never its own
 * separately-derived rate. Pitfall 2: passing a changed `txNonce` after a rebalance/deposit/
 * withdraw rebases every adapter's snapshot to the post-tx value with rate reset to 0 — the
 * share-jump from that tx is never read as yield.
 */
export function useVaultYield(
  perAdapter: VaultPosition['perAdapter'],
  opts?: UseVaultYieldOpts,
): UseVaultYieldResult {
  const accountAddress = useWalletAddress();
  const accountChainId = useChainId();
  const chainId = opts?.chainId ?? accountChainId;
  const address = opts?.address ?? accountAddress ?? 'anonymous';

  const ratesRef = useRef<Partial<Record<AdapterId, RateEntry>>>({});
  const prevTxNonceRef = useRef<number | string | undefined>(undefined);

  // Tick once per second to force a re-render; the actual extrapolation is computed at render
  // time from ratesRef, so the state value itself is never read.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Stable dependency string so the sampling effect only re-runs when a value actually changes,
  // not on every re-render of the caller (perAdapter is a fresh object each render).
  const valueSignature = ADAPTER_IDS.map((id) => {
    const a = perAdapter[id];
    return `${id}:${a?.valueUsdc ?? ''}:${a?.unavailable ? 'x' : ''}`;
  }).join('|');

  useEffect(() => {
    const now = Date.now();
    const nonceChanged =
      opts?.txNonce !== undefined &&
      prevTxNonceRef.current !== undefined &&
      prevTxNonceRef.current !== opts.txNonce;
    prevTxNonceRef.current = opts?.txNonce;

    for (const id of ADAPTER_IDS) {
      const adapter = perAdapter[id];
      if (!adapter) continue;

      const nextSample: YieldSnapshot = { timestampMs: now, valueUsdc: adapter.valueUsdc.toString() };

      if (adapter.unavailable) {
        ratesRef.current[id] = { rate: 0, lastSample: nextSample };
        continue;
      }

      const key = snapshotKey(chainId, address, id);

      if (nonceChanged) {
        // Pitfall 2: rebase to the post-tx value, never derive a rate from the jump itself.
        writeSnapshot(key, nextSample);
        ratesRef.current[id] = { rate: 0, lastSample: nextSample };
        continue;
      }

      const prev = readSnapshot(key);
      if (!prev) {
        // First visit: write the baseline, keep it flat (no prior sample to derive a rate from).
        writeSnapshot(key, nextSample);
        ratesRef.current[id] = { rate: 0, lastSample: nextSample };
        continue;
      }

      const elapsedSec = (now - prev.timestampMs) / 1000;
      if (elapsedSec >= MIN_SAMPLE_INTERVAL_S) {
        const rate = deriveRate(prev, nextSample);
        writeSnapshot(key, nextSample);
        ratesRef.current[id] = { rate, lastSample: nextSample };
      } else if (!ratesRef.current[id]) {
        // Nothing sampled yet this session but a snapshot already existed (e.g. remount): reuse
        // it flat rather than re-deriving from a too-short window.
        ratesRef.current[id] = { rate: 0, lastSample: prev };
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId, address, opts?.txNonce, valueSignature]);

  const result: UseVaultYieldResult['perAdapter'] = {};
  let totalDisplayedUsdc = 0n;
  const now = Date.now();

  for (const id of ADAPTER_IDS) {
    const adapter = perAdapter[id];
    if (!adapter) continue;

    const entry = ratesRef.current[id];
    if (adapter.unavailable || !entry) {
      result[id] = { displayedValueUsdc: adapter.valueUsdc, rate: 0, state: 'flat' };
      totalDisplayedUsdc += adapter.valueUsdc;
      continue;
    }

    const elapsedSec = (now - entry.lastSample.timestampMs) / 1000;
    const displayedValueUsdc = extrapolate(BigInt(entry.lastSample.valueUsdc), entry.rate, elapsedSec, CAP_SECONDS);
    const state: YieldState = entry.rate > 0 ? 'up' : entry.rate < 0 ? 'down' : 'flat';

    result[id] = { displayedValueUsdc, rate: entry.rate, state };
    totalDisplayedUsdc += displayedValueUsdc;
  }

  return { perAdapter: result, totalDisplayedUsdc };
}
