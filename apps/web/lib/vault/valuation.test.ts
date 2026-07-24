import { describe, expect, it } from 'vitest';
import { convertToAssets, OFFSET_POW, positionValue } from './valuation';

/**
 * Deterministic oracle copied from `vault-core/src/share_math.rs`'s own unit tests (D-24). Each
 * entry cites the Rust test it was derived from, so a future `OFFSET_POW` change knows exactly
 * where to re-derive these numbers from.
 */
const KNOWN_VECTORS: Array<{
  name: string;
  shares: bigint;
  totalShares: bigint;
  totalAssets: bigint;
  expected: bigint;
  rustTest: string;
}> = [
  {
    name: 'zero shares always values at zero',
    shares: 0n,
    totalShares: 100n,
    totalAssets: 100n,
    expected: 0n,
    rustTest: 'derived directly from the convert_to_assets formula (numerator * 0 == 0), no dedicated Rust test needed',
  },
  {
    name: 'empty vault (offset dominates, no division by zero)',
    shares: 5n,
    totalShares: 0n,
    totalAssets: 0n,
    expected: 0n,
    rustTest: 'derived from convert_to_shares_first_deposit_is_nonzero fixture (empty vault: total_shares=0, total_assets=0)',
  },
  {
    name: 'round trip within floor tolerance',
    shares: 1_199_999n,
    totalShares: 6_199_999n,
    totalAssets: 6_000_000n,
    expected: 999_999n,
    rustTest: 'convert_to_shares_and_back_round_trips_within_floor_tolerance (share_math.rs) — shares computed via convert_to_shares(1_000_000, 5_000_000, 5_000_000), then convert_to_assets over the post-mint totals',
  },
  {
    name: "first depositor's own shares value back to exactly what they deposited",
    shares: 1_000_000_000_000n,
    totalShares: 1_000_000_000_000n,
    totalAssets: 1_000_000n,
    expected: 1_000_000n,
    rustTest: 'convert_to_shares_first_deposit_is_nonzero (share_math.rs), extended: convert_to_shares(1_000_000, 0, 0) mints 1_000_000_000_000n shares; converting them back over the post-mint totals round-trips exactly',
  },
  {
    name: 'tiny amounts floor to zero rather than rounding up',
    shares: 3n,
    totalShares: 2n,
    totalAssets: 4n,
    expected: 0n,
    rustTest: 'derived directly from the convert_to_assets formula (floor(3*5/1000002) == 0), demonstrates D-24 floor rounding never rounds up',
  },
];

describe('convertToAssets', () => {
  it('returns 0n for any totalShares/totalAssets when shares is 0n', () => {
    expect(convertToAssets(0n, 0n, 0n)).toBe(0n);
    expect(convertToAssets(0n, 1_000_000n, 1_000_000n)).toBe(0n);
  });

  it('returns 0n on an empty vault (shares > 0n, totalShares = 0n, totalAssets = 0n)', () => {
    expect(convertToAssets(1n, 0n, 0n)).toBe(0n);
  });

  it.each(KNOWN_VECTORS)('$name ($rustTest)', ({ shares, totalShares, totalAssets, expected }) => {
    expect(convertToAssets(shares, totalShares, totalAssets)).toBe(expected);
  });

  it('never rounds up (floor division)', () => {
    // 3 shares over a tiny pool: floor(3 * 5 / 1_000_002) == 0, not 1.
    expect(convertToAssets(3n, 2n, 4n)).toBe(0n);
  });

  it('OFFSET_POW matches share_math::OFFSET_POW (USDC has 6 decimals)', () => {
    expect(OFFSET_POW).toBe(1_000_000n);
  });
});

describe('positionValue', () => {
  it('composes the D-21 formula identically to convertToAssets', () => {
    const shares = 1_199_999n;
    const adapterTotalShares = 6_199_999n;
    const adapterTotalAssets = 6_000_000n;
    expect(positionValue(shares, adapterTotalShares, adapterTotalAssets)).toBe(
      convertToAssets(shares, adapterTotalShares, adapterTotalAssets),
    );
  });

  it('never exceeds the adapter totalAssets when shares <= adapterTotalShares', () => {
    const adapterTotalShares = 6_199_999n;
    const adapterTotalAssets = 6_000_000n;
    const value = positionValue(adapterTotalShares, adapterTotalShares, adapterTotalAssets);
    expect(value).toBeLessThanOrEqual(adapterTotalAssets);
  });
});
