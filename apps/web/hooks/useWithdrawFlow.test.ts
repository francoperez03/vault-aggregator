import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import type { LemonTxOutcome } from '@/lib/lemon/bridge';

const USER_ADDRESS = '0x9999999999999999999999999999999999999999' as const;
const USDC_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd' as const;

const useAccountMock = vi.fn();
const readContractMock = vi.fn();
const redeemOnChainMock = vi.fn();
const withdrawMock = vi.fn();

vi.mock('@/hooks/useWalletAddress', () => ({
  useWalletAddress: () => useAccountMock().address,
}));

vi.mock('wagmi', () => ({
  useAccount: () => useAccountMock(),
  usePublicClient: () => ({ readContract: readContractMock }),
}));

vi.mock('@/lib/contracts/config', () => ({
  getUsdcAddress: () => USDC_ADDRESS,
}));

vi.mock('@/hooks/useVaultWrite', () => ({
  useVaultWrite: () => ({ redeem: redeemOnChainMock }),
}));

vi.mock('@/lib/lemon/bridge', () => ({
  getLemonBridge: () => ({ withdraw: withdrawMock }),
}));

async function importHook() {
  const mod = await import('./useWithdrawFlow');
  return mod.useWithdrawFlow;
}

beforeEach(() => {
  window.localStorage.clear();
  useAccountMock.mockReturnValue({ address: USER_ADDRESS });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('useWithdrawFlow.redeem (step 1)', () => {
  it('measures the real balance delta, never derives the amount from the requested bps', async () => {
    readContractMock.mockResolvedValueOnce(1_000_000n).mockResolvedValueOnce(1_600_000n);
    redeemOnChainMock.mockResolvedValue({ kind: 'success' });

    const useWithdrawFlow = await importHook();
    const { result } = renderHook(() => useWithdrawFlow());
    await result.current.redeem(5000n);

    await waitFor(() => expect(result.current.step).toBe(2));
    expect(result.current.pendingAmount).toBe(600_000n);
  });

  it('persists the pending amount in localStorage per address', async () => {
    readContractMock.mockResolvedValueOnce(0n).mockResolvedValueOnce(600_000n);
    redeemOnChainMock.mockResolvedValue({ kind: 'success' });

    const useWithdrawFlow = await importHook();
    const { result } = renderHook(() => useWithdrawFlow());
    await result.current.redeem(5000n);
    await waitFor(() => expect(result.current.pendingAmount).toBe(600_000n));

    expect(window.localStorage.getItem(`vault-pending-settlement:${USER_ADDRESS}`)).toBe('600000');
  });

  it('a step 1 revert never produces partial (Pitfall 4): reverted with "No se movió plata"', async () => {
    readContractMock.mockResolvedValueOnce(1_000_000n);
    redeemOnChainMock.mockResolvedValue({ kind: 'reverted', reason: 'RedeemShortfall' });

    const useWithdrawFlow = await importHook();
    const { result } = renderHook(() => useWithdrawFlow());
    await result.current.redeem(5000n);

    await waitFor(() => expect(result.current.phase.kind).toBe('reverted'));
    expect(result.current.step).toBe(1);
    expect(result.current.pendingAmount).toBeNull();
  });
});

describe('useWithdrawFlow.settleToLemon (step 2)', () => {
  function seedPending(amount: bigint) {
    window.localStorage.setItem(`vault-pending-settlement:${USER_ADDRESS}`, amount.toString());
  }

  it('calls getLemonBridge().withdraw with tokenName USDC and the amount measured in step 1', async () => {
    seedPending(600_000n);
    withdrawMock.mockResolvedValue({ result: 'SUCCESS', txHash: '0xabc', amount: 600_000n });

    const useWithdrawFlow = await importHook();
    const { result } = renderHook(() => useWithdrawFlow());
    await waitFor(() => expect(result.current.pendingAmount).toBe(600_000n));
    await result.current.settleToLemon();

    expect(withdrawMock).toHaveBeenCalledWith({ amount: 600_000n, tokenName: 'USDC' });
    await waitFor(() => expect(result.current.phase.kind).toBe('success'));
    expect(result.current.pendingAmount).toBeNull();
  });

  it('partial SUCCESS goes through reconcileWithdrawal and produces partial with all three amounts', async () => {
    seedPending(600_000n);
    withdrawMock.mockResolvedValue({ result: 'SUCCESS', txHash: '0xabc', amount: 300_000n });

    const useWithdrawFlow = await importHook();
    const { result } = renderHook(() => useWithdrawFlow());
    await waitFor(() => expect(result.current.pendingAmount).toBe(600_000n));
    await result.current.settleToLemon();

    await waitFor(() => expect(result.current.phase.kind).toBe('partial'));
    expect(result.current.phase).toEqual({ kind: 'partial', requested: 600_000n, actual: 300_000n, remaining: 300_000n });
    expect(result.current.pendingAmount).toBe(300_000n);
  });

  it('CANCELLED -> rejected', async () => {
    seedPending(600_000n);
    withdrawMock.mockResolvedValue({ result: 'CANCELLED' });

    const useWithdrawFlow = await importHook();
    const { result } = renderHook(() => useWithdrawFlow());
    await waitFor(() => expect(result.current.pendingAmount).toBe(600_000n));
    await result.current.settleToLemon();

    await waitFor(() => expect(result.current.phase.kind).toBe('rejected'));
  });

  it("FAILED -> reverted with Lemon's copy, not the generic one", async () => {
    seedPending(600_000n);
    withdrawMock.mockResolvedValue({ result: 'FAILED', error: 'Withdraw failed.' });

    const useWithdrawFlow = await importHook();
    const { result } = renderHook(() => useWithdrawFlow());
    await waitFor(() => expect(result.current.pendingAmount).toBe(600_000n));
    await result.current.settleToLemon();

    await waitFor(() => expect(result.current.phase.kind).toBe('reverted'));
    expect(result.current.phase).toMatchObject({
      reason: 'Lemon no pudo completar este paso. Tus fondos on-chain están seguros en el saldo de la app.',
    });
  });

  it('PENDING that never resolves -> timeout, never success', async () => {
    seedPending(600_000n);
    const pending: LemonTxOutcome = {
      result: 'PENDING',
      txHash: '0xabc',
      settle: async () => pending,
    };
    withdrawMock.mockResolvedValue(pending);

    const useWithdrawFlow = await importHook();
    const { result } = renderHook(() => useWithdrawFlow());
    await waitFor(() => expect(result.current.pendingAmount).toBe(600_000n));
    await result.current.settleToLemon();

    await waitFor(() => expect(result.current.phase.kind).toBe('timeout'));
  });

  it('acknowledge() clears the phase after a partial, without retrying on its own', async () => {
    seedPending(600_000n);
    withdrawMock.mockResolvedValue({ result: 'SUCCESS', txHash: '0xabc', amount: 300_000n });

    const useWithdrawFlow = await importHook();
    const { result } = renderHook(() => useWithdrawFlow());
    await waitFor(() => expect(result.current.pendingAmount).toBe(600_000n));
    await result.current.settleToLemon();
    await waitFor(() => expect(result.current.phase.kind).toBe('partial'));

    result.current.acknowledge();
    await waitFor(() => expect(result.current.phase.kind).toBe('confirm'));
    expect(withdrawMock).toHaveBeenCalledTimes(1);
  });
});
