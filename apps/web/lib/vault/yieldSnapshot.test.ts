import { describe, expect, it, beforeEach } from 'vitest';
import {
  CAP_SECONDS,
  MIN_SAMPLE_INTERVAL_S,
  deriveRate,
  extrapolate,
  readSnapshot,
  snapshotKey,
  writeSnapshot,
  type YieldSnapshot,
} from './yieldSnapshot';

describe('deriveRate', () => {
  it('returns a positive rate for a positive delta over time', () => {
    const prev: YieldSnapshot = { timestampMs: 0, valueUsdc: '1000000' };
    const next: YieldSnapshot = { timestampMs: 60_000, valueUsdc: '1060000' };
    expect(deriveRate(prev, next)).toBe(1000); // 60000 atomic / 60s
  });

  it('returns a negative rate for a negative delta', () => {
    const prev: YieldSnapshot = { timestampMs: 0, valueUsdc: '1000000' };
    const next: YieldSnapshot = { timestampMs: 60_000, valueUsdc: '940000' };
    expect(deriveRate(prev, next)).toBe(-1000);
  });

  it('returns 0 when dt <= 0 (same or reversed timestamps)', () => {
    const prev: YieldSnapshot = { timestampMs: 60_000, valueUsdc: '1000000' };
    const same: YieldSnapshot = { timestampMs: 60_000, valueUsdc: '1060000' };
    const earlier: YieldSnapshot = { timestampMs: 0, valueUsdc: '1060000' };
    expect(deriveRate(prev, same)).toBe(0);
    expect(deriveRate(prev, earlier)).toBe(0);
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
