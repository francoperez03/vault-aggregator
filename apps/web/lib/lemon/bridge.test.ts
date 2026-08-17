import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdk = vi.hoisted(() => ({
  deposit: vi.fn(),
  withdraw: vi.fn(),
}));

vi.mock('@lemoncash/mini-app-sdk', () => ({
  authenticate: vi.fn(),
  callSmartContract: vi.fn(),
  deposit: sdk.deposit,
  withdraw: sdk.withdraw,
  TransactionResult: { SUCCESS: 'SUCCESS', PENDING: 'PENDING', FAILED: 'FAILED', CANCELLED: 'CANCELLED' },
  TokenName: { USDC: 'USDC' },
}));

vi.mock('@/lib/env', () => ({ getChainId: () => 42161 }));

const U = 1_000_000n; // 1 USDC in base units

describe('real Lemon bridge amount units', () => {
  beforeEach(() => {
    vi.resetModules();
    sdk.deposit.mockReset();
    sdk.withdraw.mockReset();
    (globalThis as { window?: unknown }).window = { ReactNativeWebView: {} };
    process.env.NEXT_PUBLIC_LEMON_MINI_APP_ID = 'test-app';
  });

  it('deposit sends the amount as a human decimal string, never base units', async () => {
    sdk.deposit.mockResolvedValue({ result: 'SUCCESS', data: { txHash: '0xabc' } });
    const { getLemonBridge } = await import('./bridge');
    await getLemonBridge().deposit({ amount: 10n * U + 500_000n, tokenName: 'USDC' });
    expect(sdk.deposit).toHaveBeenCalledWith({ amount: '10.5', tokenName: 'USDC', chainId: 42161 });
  });

  it('withdraw sends the amount as a human decimal string', async () => {
    sdk.withdraw.mockResolvedValue({ result: 'SUCCESS', data: { txHash: '0xabc' } });
    const { getLemonBridge } = await import('./bridge');
    await getLemonBridge().withdraw({ amount: 3n * U, tokenName: 'USDC' });
    expect(sdk.withdraw).toHaveBeenCalledWith({ amount: '3', tokenName: 'USDC', chainId: 42161 });
  });

  it('keeps sub-cent precision (6 decimals) without float drift', async () => {
    sdk.deposit.mockResolvedValue({ result: 'SUCCESS', data: { txHash: '0xabc' } });
    const { getLemonBridge } = await import('./bridge');
    await getLemonBridge().deposit({ amount: 1n, tokenName: 'USDC' });
    expect(sdk.deposit.mock.calls[0][0].amount).toBe('0.000001');
  });
});
