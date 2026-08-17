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
  it('reads allowance(user, core) with the core as spender', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    useReadContractMock.mockReturnValue({ data: 0n, isLoading: false, refetch: vi.fn() });

    renderHook(() => useUsdcAllowance(100n));

    const callArgs = useReadContractMock.mock.calls[0][0];
    expect(callArgs.functionName).toBe('allowance');
    expect(callArgs.address).toBe(USDC_ADDRESS);
    expect(callArgs.args).toEqual([USER_ADDRESS, CORE_ADDRESS]);
  });

  it('needsApproval is true when the allowance is below the requested amount', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    useReadContractMock.mockReturnValue({ data: 50n, isLoading: false, refetch: vi.fn() });

    const { result } = renderHook(() => useUsdcAllowance(100n));

    expect(result.current.needsApproval).toBe(true);
  });

  it('needsApproval is false when the allowance already covers the exact amount', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    useReadContractMock.mockReturnValue({ data: 100n, isLoading: false, refetch: vi.fn() });

    const { result } = renderHook(() => useUsdcAllowance(100n));

    expect(result.current.needsApproval).toBe(false);
  });

  it('without a connected wallet stays enabled: false', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: undefined });
    useReadContractMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });

    renderHook(() => useUsdcAllowance(100n));

    const callArgs = useReadContractMock.mock.calls[0][0];
    expect(callArgs.query.enabled).toBe(false);
  });

  it('exposes refetch to invalidate the read after a deposit', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    const refetchSpy = vi.fn();
    useReadContractMock.mockReturnValue({ data: 0n, isLoading: false, refetch: refetchSpy });

    const { result } = renderHook(() => useUsdcAllowance(100n));
    result.current.refetch();

    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });
});
