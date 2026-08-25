import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVaultYield } from './useVaultYield';
import type { VaultPosition, VaultPositionAdapter } from './useVaultPosition';

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: '0x9999999999999999999999999999999999999999' as const }),
  useChainId: () => 1,
}));

function adapter(valueUsdc: bigint, overrides: Partial<VaultPositionAdapter> = {}): VaultPositionAdapter {
  return { shares: 0n, adapterTotalShares: 0n, totalAssets: 0n, valueUsdc, weightBps: 0, ...overrides };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('useVaultYield', () => {
  it('first visit (no prior snapshot) renders the real value flat and derives no rate', () => {
    const perAdapter: VaultPosition['perAdapter'] = { morpho: adapter(1_000_000n) };
    const { result } = renderHook(() => useVaultYield(perAdapter));

    expect(result.current.perAdapter.morpho?.state).toBe('flat');
    expect(result.current.perAdapter.morpho?.rate).toBe(0);
    expect(result.current.perAdapter.morpho?.displayedValueUsdc).toBe(1_000_000n);
  });

  it('derives an up rate once MIN_SAMPLE_INTERVAL_S has elapsed with a rising value', () => {
    const { result, rerender } = renderHook(
      ({ perAdapter }: { perAdapter: VaultPosition['perAdapter'] }) => useVaultYield(perAdapter),
      { initialProps: { perAdapter: { morpho: adapter(1_000_000_000n) } } },
    );

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    rerender({ perAdapter: { morpho: adapter(1_000_006_000n) } });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.perAdapter.morpho?.state).toBe('up');
    expect(result.current.perAdapter.morpho?.rate).toBeGreaterThan(0);
  });

  it('derives a down rate with a falling value', () => {
    const { result, rerender } = renderHook(
      ({ perAdapter }: { perAdapter: VaultPosition['perAdapter'] }) => useVaultYield(perAdapter),
      { initialProps: { perAdapter: { morpho: adapter(1_000_000_000n) } } },
    );

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    rerender({ perAdapter: { morpho: adapter(999_994_000n) } });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.perAdapter.morpho?.state).toBe('down');
    expect(result.current.perAdapter.morpho?.rate).toBeLessThan(0);
  });

  it('a txNonce bump after a value jump rebases the baseline instead of reading it as yield (Pitfall 2)', () => {
    const { result, rerender } = renderHook(
      ({ perAdapter, opts }: { perAdapter: VaultPosition['perAdapter']; opts: { txNonce: number } }) =>
        useVaultYield(perAdapter, opts),
      { initialProps: { perAdapter: { morpho: adapter(1_000_000_000n) }, opts: { txNonce: 1 } } },
    );

    act(() => {
      vi.advanceTimersByTime(61_000);
    });
    rerender({ perAdapter: { morpho: adapter(1_000_006_000n) }, opts: { txNonce: 1 } });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(result.current.perAdapter.morpho?.state).toBe('up'); // sanity: a rate did exist before the reset

    // Simulate a completed rebalance/deposit reported via a new txNonce, with a one-time share jump.
    rerender({ perAdapter: { morpho: adapter(5_000_000_000n) }, opts: { txNonce: 2 } });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.perAdapter.morpho?.state).toBe('flat');
    expect(result.current.perAdapter.morpho?.rate).toBe(0);
    expect(result.current.perAdapter.morpho?.displayedValueUsdc).toBe(5_000_000_000n);
  });

  it('a deposit-sized jump WITHOUT a txNonce still rebases flat (MAX_PLAUSIBLE_APR gate)', () => {
    // The 2026-08-25 production incident: writes complete on the same `/` rail with no nonce
    // threaded, so the gate in deriveRate is the only thing standing between a 0.5 USDC
    // deposit and a 10M% APY counter.
    const { result, rerender } = renderHook(
      ({ perAdapter }: { perAdapter: VaultPosition['perAdapter'] }) => useVaultYield(perAdapter),
      { initialProps: { perAdapter: { fluid: adapter(499_998n) } } },
    );

    act(() => {
      vi.advanceTimersByTime(105_700);
    });
    rerender({ perAdapter: { fluid: adapter(999_998n) } });
    act(() => {
      vi.advanceTimersByTime(1_000);
    });

    expect(result.current.perAdapter.fluid?.state).toBe('flat');
    expect(result.current.perAdapter.fluid?.rate).toBe(0);
    expect(result.current.perAdapter.fluid?.displayedValueUsdc).toBe(999_998n);
  });

  it('totalDisplayedUsdc equals the sum of the per-adapter displayed rows (Pitfall 1)', () => {
    const perAdapter: VaultPosition['perAdapter'] = { morpho: adapter(1_000_000n), fluid: adapter(2_000_000n) };
    const { result } = renderHook(() => useVaultYield(perAdapter));

    const sum =
      (result.current.perAdapter.morpho?.displayedValueUsdc ?? 0n) +
      (result.current.perAdapter.fluid?.displayedValueUsdc ?? 0n);
    expect(result.current.totalDisplayedUsdc).toBe(sum);
  });
});
