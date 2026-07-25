import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useVaultPosition } from './useVaultPosition';

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
const useReadContractsMock = vi.fn();

vi.mock('wagmi', () => ({
  useAccount: () => useAccountMock(),
  useReadContracts: (args: unknown) => useReadContractsMock(args),
}));

function ok(result: unknown) {
  return { status: 'success' as const, result };
}
function fail() {
  return { status: 'failure' as const, error: new Error('rpc down') };
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe('useVaultPosition', () => {
  it('sin wallet conectada queda enabled: false y no arma el multicall', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: undefined });
    useReadContractsMock.mockReturnValue({ data: undefined, isLoading: false, refetch: vi.fn() });

    renderHook(() => useVaultPosition());

    const callArgs = useReadContractsMock.mock.calls[0][0];
    expect(callArgs.query.enabled).toBe(false);
  });

  it('arma un solo multicall batcheado por adapter (4 lecturas x 4 adapters)', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    useReadContractsMock.mockReturnValue({ data: undefined, isLoading: true, refetch: vi.fn() });

    renderHook(() => useVaultPosition());

    const callArgs = useReadContractsMock.mock.calls[0][0];
    expect(callArgs.contracts).toHaveLength(16);
    expect(callArgs.query.enabled).toBe(true);
    expect(useReadContractsMock).toHaveBeenCalledTimes(1);
  });

  it('valúa cada adapter con positionValue (offset virtual), no una división simplificada', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    // morpho: shares=1_000_000, totalShares=1_000_000, totalAssets=2_000_000 -> ~2x
    const morpho = [ok(1_000_000n), ok(1_000_000n), ok(2_000_000n), ok(3000n)];
    const fluid = [ok(0n), ok(0n), ok(0n), ok(0n)];
    const euler = [ok(0n), ok(0n), ok(0n), ok(0n)];
    const aave = [ok(0n), ok(0n), ok(0n), ok(0n)];
    useReadContractsMock.mockReturnValue({
      data: [...morpho, ...fluid, ...euler, ...aave],
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useVaultPosition());

    const expected = (1_000_000n * (2_000_000n + 1n)) / (1_000_000n + 1_000_000n);
    expect(result.current.perAdapter.morpho?.valueUsdc).toBe(expected);
    expect(result.current.totalUsdc).toBe(expected);
  });

  it('si falla una lectura de un adapter, ese adapter queda unavailable y no se estima su valor', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    const morpho = [ok(1_000_000n), fail(), ok(2_000_000n), ok(3000n)];
    const fluid = [ok(0n), ok(0n), ok(0n), ok(0n)];
    const euler = [ok(0n), ok(0n), ok(0n), ok(0n)];
    const aave = [ok(0n), ok(0n), ok(0n), ok(0n)];
    useReadContractsMock.mockReturnValue({
      data: [...morpho, ...fluid, ...euler, ...aave],
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useVaultPosition());

    expect(result.current.perAdapter.morpho?.unavailable).toBe(true);
    expect(result.current.perAdapter.morpho?.valueUsdc).toBe(0n);
    expect(result.current.totalUsdc).toBe(0n);
  });

  it('hasWeights es true cuando al menos un weightBpsOf devuelve no cero', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    const morpho = [ok(0n), ok(0n), ok(0n), ok(3000n)];
    const fluid = [ok(0n), ok(0n), ok(0n), ok(0n)];
    const euler = [ok(0n), ok(0n), ok(0n), ok(0n)];
    const aave = [ok(0n), ok(0n), ok(0n), ok(0n)];
    useReadContractsMock.mockReturnValue({
      data: [...morpho, ...fluid, ...euler, ...aave],
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useVaultPosition());

    expect(result.current.hasWeights).toBe(true);
  });

  it('hasWeights es false cuando los cuatro pesos son cero', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    const zero = [ok(0n), ok(0n), ok(0n), ok(0n)];
    useReadContractsMock.mockReturnValue({
      data: [...zero, ...zero, ...zero, ...zero],
      isLoading: false,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() => useVaultPosition());

    expect(result.current.hasWeights).toBe(false);
  });

  it('expone refetch para invalidar después de una escritura (T-14-08-02)', () => {
    stubEnv();
    useAccountMock.mockReturnValue({ address: USER_ADDRESS });
    const refetchSpy = vi.fn();
    useReadContractsMock.mockReturnValue({ data: undefined, isLoading: false, refetch: refetchSpy });

    const { result } = renderHook(() => useVaultPosition());
    result.current.refetch();

    expect(refetchSpy).toHaveBeenCalledTimes(1);
  });
});
