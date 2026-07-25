/**
 * Pure client-side yield-rate math over two on-chain-derived samples (VFE-02). No chain reads
 * happen here, and share math is never re-derived — the USDC value a snapshot carries comes from
 * `valuation.ts`'s `convertToAssets`/`positionValue`. This module only turns two timestamped
 * values into a per-second rate and extrapolates it forward for the live counter between polls.
 */

/** Minimum seconds between polls before a new sample is considered fresh (must agree with
 * `scripts/simulate-yield.sh`'s INTERVAL, which is set above this on purpose). */
export const MIN_SAMPLE_INTERVAL_S = 60;

/** Cap on how far a rate is extrapolated past its last sample: 2x MIN_SAMPLE_INTERVAL_S, so a
 * stale rate freezes the counter instead of letting it run away (RESEARCH.md Anti-Pattern). */
export const CAP_SECONDS = 120;

/** A single point-in-time value sample. `valueUsdc` is a stringified bigint — never a JS number,
 * same discipline as valuation.ts. */
export interface YieldSnapshot {
  timestampMs: number;
  valueUsdc: string;
}

/** Per-second atomic-USDC rate between two samples. `dt <= 0` (same or reversed timestamps)
 * returns 0 rather than dividing by zero or going negative-time. */
export function deriveRate(prev: YieldSnapshot, next: YieldSnapshot): number {
  const dt = (next.timestampMs - prev.timestampMs) / 1000;
  if (dt <= 0) return 0;
  return Number(BigInt(next.valueUsdc) - BigInt(prev.valueUsdc)) / dt;
}

/** Projects `lastValueUsdc` forward by `rate` over `elapsedSec`, clamped to `[0, capSeconds]`
 * elapsed so a stale rate never runs away, and clamped at 0n since a position value cannot go
 * negative. */
export function extrapolate(
  lastValueUsdc: bigint,
  rate: number,
  elapsedSec: number,
  capSeconds: number,
): bigint {
  const s = Math.min(Math.max(elapsedSec, 0), capSeconds);
  const projected = lastValueUsdc + BigInt(Math.trunc(rate * s));
  return projected < 0n ? 0n : projected;
}

/** Namespaced localStorage key for one user's position in one adapter on one chain. */
export function snapshotKey(chainId: number, address: string, adapterId: string): string {
  return `vault-yield:${chainId}:${address}:${adapterId}`;
}

/** Reads a snapshot back, returning null when absent, on SSR, or on malformed JSON — mirrors the
 * useWithdrawFlow.ts localStorage idiom (SSR guard + try/catch-return-null). */
export function readSnapshot(key: string): YieldSnapshot | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw) as YieldSnapshot;
  } catch {
    return null;
  }
}

/** Writes a snapshot, no-op on SSR. */
export function writeSnapshot(key: string, snap: YieldSnapshot): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(key, JSON.stringify(snap));
}
