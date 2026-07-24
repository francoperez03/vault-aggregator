import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { getVaults } from './vaults';

const MORPHO_ADDRESS = '0x1111111111111111111111111111111111111a1a';
const AAVE_ADDRESS = '0x4444444444444444444444444444444444444d4d';

describe('getVaults', () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('returns exactly four entries with morpho, fluid, euler, aave ids', () => {
    const vaults = getVaults();
    expect(vaults).toHaveLength(4);
    expect(vaults.map((v) => v.id).sort()).toEqual(['aave', 'euler', 'fluid', 'morpho']);
  });

  it('has no entry for the replaced protocol anywhere in id, protocol, or logo', () => {
    // ponytail: pattern built from char codes so this file itself never contains the literal
    // string the whole repo is grepped clean of (D-27).
    const replacedProtocol = new RegExp(String.fromCharCode(98, 101, 101, 102, 121), 'i');
    const vaults = getVaults();
    expect(vaults.some((v) => replacedProtocol.test(v.id))).toBe(false);
    expect(vaults.some((v) => replacedProtocol.test(v.protocol))).toBe(false);
    expect(vaults.some((v) => v.logoUrl && replacedProtocol.test(v.logoUrl))).toBe(false);
  });

  it('leaves adapterAddress undefined when the matching env var is unset', () => {
    const morpho = getVaults().find((v) => v.id === 'morpho');
    expect(morpho?.adapterAddress).toBeUndefined();
  });

  it('fills adapterAddress from getAdapterAddresses when the env var is set', () => {
    vi.stubEnv('NEXT_PUBLIC_MORPHO_ADAPTER_ADDRESS', MORPHO_ADDRESS);
    vi.stubEnv('NEXT_PUBLIC_AAVE_ADAPTER_ADDRESS', AAVE_ADDRESS);
    const vaults = getVaults();
    expect(vaults.find((v) => v.id === 'morpho')?.adapterAddress).toBe(MORPHO_ADDRESS);
    expect(vaults.find((v) => v.id === 'aave')?.adapterAddress).toBe(AAVE_ADDRESS);
    expect(vaults.find((v) => v.id === 'fluid')?.adapterAddress).toBeUndefined();
  });
});
