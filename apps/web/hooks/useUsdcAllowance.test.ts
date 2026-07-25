import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useUsdcAllowance } from './useUsdcAllowance';

const CORE_ADDRESS = '0x1234567890123456789012345678901234567890';
const USDC_ADDRESS = '0xabcdefabcdefabcdefabcdefabcdefabcdefabcd';
const USER_ADDRESS = '0x9999999999999999999999999999999999999999';

function stubEnv() {
  vi.stubEnv('NEXT_PUBLIC_CORE_ADDRESS', CORE_ADDRESS);
  vi.stubEnv('NEXT_PUBLIC_USDC_ADDRESS', USDC_ADDRESS);
}

const useAccountMock = vi.fn();
const useReadContractMock = vi.fn();

vi.mock('wagmi', () => ({
  useAccount: () => useAccountMock(),
  useReadContract: (args: unknown) => useReadContractMock(args),
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('useUsdcAllowance', () => {
  it('lee allowance(user, core) con el core como spender', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    useReadContractMock.mockReturnValue({ data: 0n, isLoading: false, refetch: vi.fn() });

    renderHook(() => useUsdcAllowance(100n));

    const callArgs = useReadContractMock.mock.calls[0][0];
    expect(callArgs.functionName).toBe('allowance');
    expect(callArgs.address).toBe(USDC_ADDRESS);
    expect(callArgs.args).toEqual([USER_ADDRESS, CORE_ADDRESS]);
  });

  it('needsApproval es true cuando la allowance es menor al monto pedido', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    useReadContractMock.mockReturnValue({ data: 50n, isLoading: false, refetch: vi.fn() });

    const { result } = renderHook(() => useUsdcAllowance(100n));

    expect(result.current.needsApproval).toBe(true);
  });

  it('needsApproval es false cuando la allowance ya cubre el monto exacto', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    useReadContractMock.mockReturnValue({ data: 100n, isLoading: false, refetch: vi.fn() });

    const { result } = renderHook(() => useUsdcAllowance(100n));

    expect(result.current.needsApproval).toBe(false);
  });

  it('sin wallet conectada queda enabled: false', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: undefined });
    useReadContractMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });

    renderHook(() => useUsdcAllowance(100n));

    const callArgs = useReadContractMock.mock.calls[0][0];
    expect(callArgs.query.enabled).toBe(false);
  });

  it('expone refetch para invalidar la lectura después de un depósito', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    const refetchSpy = vi.fn();
    useReadContractMock.mockReturnValue({ data: 0n, isLoading: false, refetch: refetchSpy });

    const { result } = renderHook(() => useUsdcAllowance(100n));
    result.current.refetch();

    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });
});
