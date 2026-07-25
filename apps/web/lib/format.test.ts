import { describe, expect, it } from 'vitest';
import { formatUsdcPrecise } from './format';

describe('formatUsdcPrecise', () => {
  it('renders 6 decimals with en-US grouping', () => {
    expect(formatUsdcPrecise(1204183947n)).toBe('1,204.183947');
  });

  it('pads a round amount to 6 decimals', () => {
    expect(formatUsdcPrecise(10000000n)).toBe('10.000000');
  });
});
