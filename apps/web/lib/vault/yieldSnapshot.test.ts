import { describe, expect, it, beforeEach } from 'vitest';
import {
  CAP_SECONDS,
  MAX_PLAUSIBLE_APR,
  MIN_SAMPLE_INTERVAL_S,
  deriveRate,
  extrapolate,
  readSnapshot,
  snapshotKey,
  writeSnapshot,
  type YieldSnapshot,
} from './yieldSnapshot';

describe('deriveRate', () => {
  // 1000 USDC position: MAX_PLAUSIBLE_APR (10x/year) allows up to ~317 atomic/s.
  it('returns a positive rate for a plausible positive delta over time', () => {
    const prev: YieldSnapshot = { timestampMs: 0, valueUsdc: '1000000000' };
    const next: YieldSnapshot = { timestampMs: 60_000, valueUsdc: '1000006000' };
    expect(deriveRate(prev, next)).toBe(100); // 6000 atomic / 60s, ~0.3% APY-scale
  });

  it('returns a negative rate for a plausible negative delta', () => {
    const prev: YieldSnapshot = { timestampMs: 0, valueUsdc: '1000000000' };
    const next: YieldSnapshot = { timestampMs: 60_000, valueUsdc: '999994000' };
    expect(deriveRate(prev, next)).toBe(-100);
  });

  it('returns 0 when dt <= 0 (same or reversed timestamps)', () => {
    const prev: YieldSnapshot = { timestampMs: 60_000, valueUsdc: '1000000000' };
    const same: YieldSnapshot = { timestampMs: 60_000, valueUsdc: '1000006000' };
    const earlier: YieldSnapshot = { timestampMs: 0, valueUsdc: '1000006000' };
    expect(deriveRate(prev, same)).toBe(0);
    expect(deriveRate(prev, earlier)).toBe(0);
  });

  describe('MAX_PLAUSIBLE_APR gate (capital jumps are never yield)', () => {
    it('treats a deposit-sized jump as a rebase: the 2026-08-25 production numbers', () => {
      // 0.5 USDC position, +0.5 USDC deposit landing 105.7s after the last sample. Ungated
      // this derived 4730 atomic/s (~10M% APY) and displayed $1.4667 for a $1.00 position.
      const prev: YieldSnapshot = { timestampMs: 0, valueUsdc: '499998' };
      const next: YieldSnapshot = { timestampMs: 105_700, valueUsdc: '999998' };
      expect(deriveRate(prev, next)).toBe(0);
    });

    it('treats a withdrawal-sized drop as a rebase, not negative yield', () => {
      const prev: YieldSnapshot = { timestampMs: 0, valueUsdc: '999998' };
      const next: YieldSnapshot = { timestampMs: 60_000, valueUsdc: '499998' };
      expect(deriveRate(prev, next)).toBe(0);
    });

    it('treats any funding from an empty position as a rebase (prev = 0)', () => {
      const prev: YieldSnapshot = { timestampMs: 0, valueUsdc: '0' };
      const next: YieldSnapshot = { timestampMs: 3_600_000, valueUsdc: '1000000' };
      expect(deriveRate(prev, next)).toBe(0);
    });

    it('passes a rate just under the gate and zeroes one just over it', () => {
      const prev = { timestampMs: 0, valueUsdc: '1000000000' }; // 1000 USDC
      const maxRate = (1_000_000_000 * MAX_PLAUSIBLE_APR) / 31_536_000; // ~317.1 atomic/s
      const justUnder = { timestampMs: 60_000, valueUsdc: String(1_000_000_000 + Math.floor(maxRate * 60)) };
      const justOver = { timestampMs: 60_000, valueUsdc: String(1_000_000_000 + Math.ceil(maxRate * 60) + 60) };
      expect(deriveRate(prev, justUnder)).toBeGreaterThan(0);
      expect(deriveRate(prev, justOver)).toBe(0);
    });
  });
});

describe('extrapolate', () => {
  it('adds rate*elapsed when elapsed is below the cap', () => {
    expect(extrapolate(1_000_000n, 1000, 30, CAP_SECONDS)).toBe(1_030_000n);
  });

  it('clamps at capSeconds when elapsed exceeds it (stale rate never runs away)', () => {
    const atCap = extrapolate(1_000_000n, 1000, CAP_SECONDS, CAP_SECONDS);
    const wayOver = extrapolate(1_000_000n, 1000, CAP_SECONDS * 10, CAP_SECONDS);
    expect(wayOver).toBe(atCap);
    expect(atCap).toBe(1_000_000n + BigInt(1000 * CAP_SECONDS));
  });

  it('never goes below 0n even with a large negative rate', () => {
    expect(extrapolate(100n, -1000, 60, CAP_SECONDS)).toBe(0n);
  });

  it('treats a negative elapsedSec as zero elapsed', () => {
    expect(extrapolate(1_000_000n, 1000, -10, CAP_SECONDS)).toBe(1_000_000n);
  });
});

describe('snapshotKey', () => {
  it('builds the namespaced localStorage key', () => {
    expect(snapshotKey(421614, '0xabc', 'morpho')).toBe('vault-yield:421614:0xabc:morpho');
  });
});

describe('readSnapshot / writeSnapshot', () => {
  const key = 'vault-yield:421614:0xabc:morpho';

  beforeEach(() => {
    window.localStorage.clear();
  });

  it('returns null when the key is absent', () => {
    expect(readSnapshot(key)).toBeNull();
  });

  it('round-trips a written snapshot exactly', () => {
    const snap: YieldSnapshot = { timestampMs: 12345, valueUsdc: '999999999' };
    writeSnapshot(key, snap);
    expect(readSnapshot(key)).toEqual(snap);
  });

  it('returns null on malformed JSON instead of throwing', () => {
    window.localStorage.setItem(key, '{not json');
    expect(readSnapshot(key)).toBeNull();
  });
});

describe('constants', () => {
  it('CAP_SECONDS is 2x MIN_SAMPLE_INTERVAL_S', () => {
    expect(MIN_SAMPLE_INTERVAL_S).toBe(60);
    expect(CAP_SECONDS).toBe(120);
  });
});
