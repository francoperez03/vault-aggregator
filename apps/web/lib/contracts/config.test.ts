import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { isMisconfigured } from './mode';
import {
  ADAPTER_IDS,
  getAdapterAddresses,
  getCoreAddress,
  getUsdcAddress,
  isContractConfigured,
} from './config';

const CORE_ADDRESS = '0x1234567890123456789012345678901234567890';
const USDC_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const MORPHO_ADDRESS = '0x1111111111111111111111111111111111111a1a';
const FLUID_ADDRESS = '0x2222222222222222222222222222222222222b2b';
const EULER_ADDRESS = '0x3333333333333333333333333333333333333c3c';
const AAVE_ADDRESS = '0x4444444444444444444444444444444444444d4d';

function stubAllValid() {
  vi.stubEnv('NEXT_PUBLIC_CORE_ADDRESS', CORE_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_USDC_ADDRESS', USDC_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_MORPHO_ADAPTER_ADDRESS', MORPHO_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_FLUID_ADAPTER_ADDRESS', FLUID_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_EULER_ADAPTER_ADDRESS', EULER_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_AAVE_ADAPTER_ADDRESS', AAVE_ADDRESS);
}

describe('contract config', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('getCoreAddress returns undefined for missing/malformed address', () => {
    vi.stubEnv('NEXT_PUBLIC_CORE_ADDRESS', '');
    expect(getCoreAddress()).toBeUndefined();
    vi.stubEnv('NEXT_PUBLIC_CORE_ADDRESS', '0xnot-an-address');
    expect(getCoreAddress()).toBeUndefined();
  });

  it('getCoreAddress returns the address when valid', () => {
    vi.stubEnv('NEXT_PUBLIC_CORE_ADDRESS', CORE_ADDRESS);
    expect(getCoreAddress()).toBe(CORE_ADDRESS);
  });

  it('getUsdcAddress follows the same contract as getCoreAddress', () => {
    vi.stubEnv('NEXT_PUBLIC_USDC_ADDRESS', '');
    expect(getUsdcAddress()).toBeUndefined();
    vi.stubEnv('NEXT_PUBLIC_USDC_ADDRESS', USDC_ADDRESS);
    expect(getUsdcAddress()).toBe(USDC_ADDRESS);
  });

  it('ADAPTER_IDS lists the four adapters with Euler, not Beefy', () => {
    expect(ADAPTER_IDS).toEqual(['morpho', 'fluid', 'euler', 'aave']);
  });

  it('getAdapterAddresses omits entries with missing/malformed env vars', () => {
    vi.stubEnv('NEXT_PUBLIC_MORPHO_ADAPTER_ADDRESS', MORPHO_ADDRESS);
    vi.stubEnv('NEXT_PUBLIC_FLUID_ADAPTER_ADDRESS', '');
    vi.stubEnv('NEXT_PUBLIC_EULER_ADAPTER_ADDRESS', 'not-an-address');
    vi.stubEnv('NEXT_PUBLIC_AAVE_ADAPTER_ADDRESS', AAVE_ADDRESS);

    expect(getAdapterAddresses()).toEqual({ morpho: MORPHO_ADDRESS, aave: AAVE_ADDRESS });
  });

  it('isContractConfigured is false unless core, USDC and all four adapters are set', () => {
    stubAllValid();
    expect(isContractConfigured()).toBe(true);
  });

  it('isContractConfigured is false when a single adapter is missing', () => {
    stubAllValid();
    vi.stubEnv('NEXT_PUBLIC_FLUID_ADAPTER_ADDRESS', '');
    expect(isContractConfigured()).toBe(false);
  });

  it('isContractConfigured is false when core is missing', () => {
    stubAllValid();
    vi.stubEnv('NEXT_PUBLIC_CORE_ADDRESS', '');
    expect(isContractConfigured()).toBe(false);
  });

  it('isMisconfigured is the negation of isContractConfigured', () => {
    expect(isMisconfigured()).toBe(true);
    stubAllValid();
    expect(isMisconfigured()).toBe(false);
  });
});
