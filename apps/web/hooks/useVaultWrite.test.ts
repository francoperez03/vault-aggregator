import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { UserRejectedRequestError } from 'viem';
import { useVaultWrite, toTxPhase } from './useVaultWrite';
import type { LemonTxOutcome } from '@/lib/lemon/bridge';

const CORE_ADDRESS = '0x1234567890123456789012345678901234567890';
const USDC_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const MORPHO_ADDRESS = '0x1111111111111111111111111111111111111a1a';
const FLUID_ADDRESS = '0x2222222222222222222222222222222222222b2b';
const EULER_ADDRESS = '0x3333333333333333333333333333333333333c3c';
const AAVE_ADDRESS = '0x4444444444444444444444444444444444444d4d';
const USER_ADDRESS = '0x9999999999999999999999999999999999999999';

function stubEnv() {
  vi.stubEnv('NEXT_PUBLIC_CORE_ADDRESS', CORE_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_USDC_ADDRESS', USDC_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_MORPHO_ADAPTER_ADDRESS', MORPHO_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_FLUID_ADAPTER_ADDRESS', FLUID_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_EULER_ADAPTER_ADDRESS', EULER_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_AAVE_ADAPTER_ADDRESS', AAVE_ADDRESS);
}

const useAccountMock = vi.fn();
const writeContractAsyncMock = vi.fn();
const waitForTransactionReceiptMock = vi.fn();
const isLemonWebViewMock = vi.fn();
const callSmartContractMock = vi.fn();
const refetchPositionMock = vi.fn();
const refetchAllowanceMock = vi.fn();

vi.mock('wagmi', () => ({
  useAccount: () => useAccountMock(),
  useWriteContract: () => ({ writeContractAsync: writeContractAsyncMock }),
}));

vi.mock('wagmi/actions', () => ({
  waitForTransactionReceipt: (...args: unknown[]) => waitForTransactionReceiptMock(...args),
}));

vi.mock('@/lib/wagmi/config', () => ({ wagmiConfig: {} }));

vi.mock('@/lib/lemon/bridge', () => ({
  isLemonWebView: () => isLemonWebViewMock(),
  getLemonBridge: () => ({ callSmartContract: callSmartContractMock }),
}));

vi.mock('@/hooks/useVaultPosition', () => ({
  useVaultPosition: () => ({ refetch: refetchPositionMock }),
}));

vi.mock('@/hooks/useUsdcAllowance', () => ({
  useUsdcAllowance: () => ({ refetch: refetchAllowanceMock }),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('toTxPhase', () => {
  it('SUCCESS -> success, con el amount si vino', () => {
    const outcome: LemonTxOutcome = { result: 'SUCCESS', txHash: '0xabc', amount: 100n };
    expect(toTxPhase(outcome)).toEqual({ kind: 'success', amount: 100n });
  });

  it('CANCELLED -> rejected', () => {
    const outcome: LemonTxOutcome = { result: 'CANCELLED' };
    expect(toTxPhase(outcome)).toEqual({ kind: 'rejected' });
  });

  it('FAILED -> reverted, nunca partial (Pitfall 4)', () => {
    const outcome: LemonTxOutcome = { result: 'FAILED', error: 'execution reverted' };
    expect(toTxPhase(outcome)).toEqual({ kind: 'reverted', reason: 'execution reverted' });
  });

  it('PENDING sin resolver -> timeout, nunca success (Pitfall 2)', () => {
    const outcome: LemonTxOutcome = { result: 'PENDING', txHash: '0xabc', settle: async () => outcome };
    expect(toTxPhase(outcome)).toEqual({ kind: 'timeout', txHash: '0xabc' });
  });
});

describe('useVaultWrite.deposit', () => {
  it('browser: aprueba el monto exacto y después deposita, dos txs en orden', async () => {
    stubEnv();
    isLemonWebViewMock.mockReturnValue(false);
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    writeContractAsyncMock.mockResolvedValueOnce('0xapprove').mockResolvedValueOnce('0xdeposit');
    waitForTransactionReceiptMock.mockResolvedValue({});

    const { result } = renderHook(() => useVaultWrite());
    const phase = await result.current.deposit(500n);

    expect(phase).toEqual({ kind: 'success', amount: 500n });
    expect(writeContractAsyncMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ address: USDC_ADDRESS, functionName: 'approve', args: [CORE_ADDRESS, 500n] }),
    );
    expect(writeContractAsyncMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ address: CORE_ADDRESS, functionName: 'deposit', args: [500n] }),
    );
    expect(waitForTransactionReceiptMock).toHaveBeenCalledTimes(2);
    expect(refetchPositionMock).toHaveBeenCalled();
    expect(refetchAllowanceMock).toHaveBeenCalled();
  });

  it('browser: el usuario rechaza la firma de approve -> rejected, nunca llega a depositar', async () => {
    stubEnv();
    isLemonWebViewMock.mockReturnValue(false);
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    writeContractAsyncMock.mockRejectedValueOnce(new UserRejectedRequestError(new Error('User rejected')));

    const { result } = renderHook(() => useVaultWrite());
    const phase = await result.current.deposit(500n);

    expect(phase).toEqual({ kind: 'rejected' });
    expect(writeContractAsyncMock).toHaveBeenCalledTimes(1);
  });

  it('lemon: batchea [approve, deposit] en un solo callSmartContract, monto exacto', async () => {
    stubEnv();
    isLemonWebViewMock.mockReturnValue(true);
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    callSmartContractMock.mockResolvedValue({ result: 'SUCCESS', txHash: '0xbatch' });

    const { result } = renderHook(() => useVaultWrite());
    const phase = await result.current.deposit(500n);

    expect(phase).toEqual({ kind: 'success' });
    expect(callSmartContractMock).toHaveBeenCalledWith({
      contracts: [
        { address: USDC_ADDRESS, functionName: 'approve', functionParams: [CORE_ADDRESS, 500n] },
        { address: CORE_ADDRESS, functionName: 'deposit', functionParams: [500n] },
      ],
    });
    expect(writeContractAsyncMock).not.toHaveBeenCalled();
  });
});

describe('useVaultWrite.rebalance', () => {
  it('browser: omite los pesos en cero y arma adapters[]/bps[] (D-16)', async () => {
    stubEnv();
    isLemonWebViewMock.mockReturnValue(false);
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    writeContractAsyncMock.mockResolvedValue('0xrebalance');
    waitForTransactionReceiptMock.mockResolvedValue({});

    const { result } = renderHook(() => useVaultWrite());
    const phase = await result.current.rebalance({ morpho: 6000, fluid: 0, euler: 4000, aave: 0 });

    expect(phase).toEqual({ kind: 'success' });
    expect(writeContractAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({
        address: CORE_ADDRESS,
        functionName: 'rebalance',
        args: [
          [MORPHO_ADDRESS, EULER_ADDRESS],
          [6000n, 4000n],
        ],
      }),
    );
  });

  it('lemon: manda un solo callSmartContract con rebalance, sin approve', async () => {
    stubEnv();
    isLemonWebViewMock.mockReturnValue(true);
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    callSmartContractMock.mockResolvedValue({ result: 'SUCCESS', txHash: '0xbatch' });

    const { result } = renderHook(() => useVaultWrite());
    await result.current.rebalance({ morpho: 10000 });

    expect(callSmartContractMock).toHaveBeenCalledWith({
      contracts: [{ address: CORE_ADDRESS, functionName: 'rebalance', functionParams: [[MORPHO_ADDRESS], [10000n]] }],
    });
  });
});

describe('useVaultWrite.redeem', () => {
  it('browser: manda el bps pedido, nunca shares ni USDC', async () => {
    stubEnv();
    isLemonWebViewMock.mockReturnValue(false);
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    writeContractAsyncMock.mockResolvedValue('0xredeem');
    waitForTransactionReceiptMock.mockResolvedValue({});

    const { result } = renderHook(() => useVaultWrite());
    const phase = await result.current.redeem(5000n);

    expect(phase).toEqual({ kind: 'success' });
    expect(writeContractAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ address: CORE_ADDRESS, functionName: 'redeem', args: [5000n] }),
    );
  });
});
