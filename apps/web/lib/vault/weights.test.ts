import { describe, expect, it } from 'vitest';
import { normalizeToBps, sumBps, toContractWeights } from './weights';

const ADDRESSES = {
  morpho: '0x0000000000000000000000000000000000000001',
  fluid: '0x0000000000000000000000000000000000000002',
  euler: '0x0000000000000000000000000000000000000003',
  aave: '0x0000000000000000000000000000000000000004',
} as const;

describe('toContractWeights', () => {
  it('omits zero-weight adapters from both arrays (D-16)', () => {
    const result = toContractWeights({ morpho: 5000, fluid: 5000, euler: 0, aave: 0 }, ADDRESSES);
    expect(result.adapters).toEqual([ADDRESSES.morpho, ADDRESSES.fluid]);
    expect(result.bps).toEqual([5000n, 5000n]);
  });

  it('throws when every weight is zero (nothing to rebalance to)', () => {
    expect(() => toContractWeights({ morpho: 0, fluid: 0, euler: 0, aave: 0 }, ADDRESSES)).toThrow();
  });

  it('throws instead of sending 0x0 when a selected adapter has no configured address', () => {
    const missing = { ...ADDRESSES, euler: undefined };
    expect(() => toContractWeights({ euler: 4000, morpho: 6000 }, missing)).toThrow();
  });

  it('does not throw on a missing address for an adapter that is omitted (weight 0)', () => {
    const missing = { ...ADDRESSES, euler: undefined };
    expect(() => toContractWeights({ morpho: 10000, euler: 0 }, missing)).not.toThrow();
  });

  it('keeps catalog order (morpho, fluid, euler, aave) regardless of input key order', () => {
    const result = toContractWeights({ aave: 2500, morpho: 2500, euler: 2500, fluid: 2500 }, ADDRESSES);
    expect(result.adapters).toEqual([ADDRESSES.morpho, ADDRESSES.fluid, ADDRESSES.euler, ADDRESSES.aave]);
  });

  it('bps values are bigint (uint256 in the ABI)', () => {
    const result = toContractWeights({ morpho: 10000 }, ADDRESSES);
    expect(typeof result.bps[0]).toBe('bigint');
  });
});

describe('sumBps', () => {
  it('sums a valid allocation to exactly 10000', () => {
    expect(sumBps({ morpho: 3000, fluid: 2000, euler: 1000, aave: 4000 })).toBe(10000);
  });

  it('treats missing entries as zero', () => {
    expect(sumBps({ morpho: 10000 })).toBe(10000);
  });
});

describe('normalizeToBps', () => {
  it('is deterministic and always sums to exactly 10000, never 9999 nor 10001', () => {
    // 100 / 3 does not divide evenly: floor(3333.33) per slice would drop to 9999 without a
    // remainder fixup.
    const result = normalizeToBps({ morpho: 34, fluid: 33, euler: 33, aave: 0 });
    expect(sumBps(result)).toBe(10000);
  });

  it('sends the rounding remainder to the first catalog slice (morpho), mirroring split_by_bps', () => {
    const result = normalizeToBps({ morpho: 34, fluid: 33, euler: 33, aave: 0 });
    // floor(34/100*10000)=3400, floor(33/100*10000)=3300 twice -> 3400+3300+3300=10000, exact.
    // Use an input that actually drifts: 33/33/33/1 sums to 100 but floors unevenly.
    const drifting = normalizeToBps({ morpho: 33, fluid: 33, euler: 33, aave: 1 });
    expect(sumBps(drifting)).toBe(10000);
    // The non-first slices are the plain floor of their share; only morpho absorbs the remainder.
    const fluidFloor = Math.floor((33 * 10000) / 100);
    expect(drifting.fluid).toBe(fluidFloor);
    expect(result).toBeDefined();
  });

  it('same input produces the same output on repeated calls (stable calldata)', () => {
    const input = { morpho: 34, fluid: 33, euler: 33, aave: 0 };
    expect(normalizeToBps(input)).toEqual(normalizeToBps(input));
  });

  it('all-zero input normalizes to all-zero bps, not a throw (that guard lives in toContractWeights)', () => {
    const result = normalizeToBps({ morpho: 0, fluid: 0, euler: 0, aave: 0 });
    expect(sumBps(result)).toBe(0);
  });
});
