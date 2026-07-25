import { afterEach, describe, expect, it } from 'vitest';
import { parseSiweMessage } from 'viem/siwe';
import { getLastCallSmartContractRequest, lemonBridgeMock } from './bridgeMock';
import { clearFaults, setNextFault } from './faultInjection';

const CORE = '0x000000000000000000000000000000000000000C' as const;
const USDC = '0x000000000000000000000000000000000000000D' as const;

afterEach(() => {
  clearFaults();
});

describe('lemonBridgeMock.authenticate', () => {
  it('returns a parseable SIWE message carrying the given nonce with no fault injected', async () => {
    const { address, message } = await lemonBridgeMock.authenticate('testnonce1');
    const parsed = parseSiweMessage(message);
    expect(parsed.nonce).toBe('testnonce1');
    expect(parsed.address).toBe(address);
  });

  it('rejects with signature-rejected fault', async () => {
    setNextFault('authenticate', 'signature-rejected');
    await expect(lemonBridgeMock.authenticate('n1')).rejects.toThrow(/signature rejected/i);
  });

  it('rejects with a distinguishable error for nonce-expired', async () => {
    setNextFault('authenticate', 'nonce-expired');
    await expect(lemonBridgeMock.authenticate('n1')).rejects.toThrow(/nonce expired/i);
  });

  it('resolves with a different address for different-wallet', async () => {
    const { address: baseline } = await lemonBridgeMock.authenticate('nonceone1');
    setNextFault('authenticate', 'different-wallet');
    const { address } = await lemonBridgeMock.authenticate('noncetwo2');
    expect(address).not.toBe(baseline);
  });
});

describe('lemonBridgeMock.deposit', () => {
  it('returns FAILED for insufficient-balance', async () => {
    setNextFault('deposit', 'insufficient-balance');
    const result = await lemonBridgeMock.deposit({ amount: 100n, tokenName: 'USDC' });
    expect(result.result).toBe('FAILED');
  });

  it('returns CANCELLED for rejected', async () => {
    setNextFault('deposit', 'rejected');
    const result = await lemonBridgeMock.deposit({ amount: 100n, tokenName: 'USDC' });
    expect(result.result).toBe('CANCELLED');
  });

  it('returns SUCCESS with an amount less than requested for partial, via settle', async () => {
    setNextFault('deposit', 'partial');
    const result = await lemonBridgeMock.deposit({ amount: 100n, tokenName: 'USDC' });
    expect(result.result).toBe('PENDING');
    if (result.result !== 'PENDING') throw new Error('expected PENDING');
    const settled = await result.settle();
    expect(settled.result).toBe('SUCCESS');
    if (settled.result !== 'SUCCESS') throw new Error('expected SUCCESS');
    expect(settled.amount).toBeLessThan(100n);
  });

  it('returns PENDING, never immediate SUCCESS, with no fault injected', async () => {
    const result = await lemonBridgeMock.deposit({ amount: 100n, tokenName: 'USDC' });
    expect(result.result).toBe('PENDING');
    if (result.result !== 'PENDING') throw new Error('expected PENDING');
    const settled = await result.settle();
    expect(settled.result).toBe('SUCCESS');
  });
});

describe('lemonBridgeMock.callSmartContract', () => {
  it('accepts a well-formed [approve, deposit] batch and saves it for asserts', async () => {
    const contracts = [
      { address: USDC, functionName: 'approve', functionParams: [CORE, 1_000_000n] },
      { address: CORE, functionName: 'deposit', functionParams: [1_000_000n] },
    ];
    await lemonBridgeMock.callSmartContract({ contracts });
    const last = getLastCallSmartContractRequest();
    expect(last?.contracts).toHaveLength(2);
    expect(last?.contracts[0].functionName).toBe('approve');
    expect(last?.contracts[1].functionName).toBe('deposit');
  });

  it('rejects a call with an empty functionName', async () => {
    await expect(
      lemonBridgeMock.callSmartContract({
        contracts: [{ address: CORE, functionName: '', functionParams: [] }],
      }),
    ).rejects.toThrow(/functionName/);
  });

  it('rejects a call whose functionParams is not an array', async () => {
    await expect(
      lemonBridgeMock.callSmartContract({
        contracts: [{ address: CORE, functionName: 'deposit', functionParams: 'nope' as never }],
      }),
    ).rejects.toThrow(/functionParams/);
  });

  it('rejects a PERMIT_PLACEHOLDER_0 without a matching permits[] entry', async () => {
    await expect(
      lemonBridgeMock.callSmartContract({
        contracts: [
          {
            address: CORE,
            functionName: 'depositWithPermit',
            functionParams: [1_000_000n, 1n, 2n, 'PERMIT_PLACEHOLDER_0'],
          },
        ],
      }),
    ).rejects.toThrow(/PERMIT_PLACEHOLDER_N used without permits/);
  });

  it('accepts a well-formed permits[]/depositWithPermit call', async () => {
    const result = await lemonBridgeMock.callSmartContract({
      contracts: [
        {
          address: CORE,
          functionName: 'depositWithPermit',
          functionParams: [1_000_000n, 1n, 2n, 'PERMIT_PLACEHOLDER_0'],
          permits: [
            {
              owner: '0x0000000000000000000000000000000000000A',
              token: USDC,
              spender: CORE,
              amount: '1000000',
              deadline: '2',
              nonce: '1',
            },
          ],
        },
      ],
    });
    expect(result.result).toBe('PENDING');
  });

  it('returns FAILED for revert', async () => {
    setNextFault('callSmartContract', 'revert');
    const result = await lemonBridgeMock.callSmartContract({
      contracts: [{ address: CORE, functionName: 'deposit', functionParams: [1n] }],
    });
    expect(result.result).toBe('FAILED');
  });

  it('returns CANCELLED for rejected', async () => {
    setNextFault('callSmartContract', 'rejected');
    const result = await lemonBridgeMock.callSmartContract({
      contracts: [{ address: CORE, functionName: 'deposit', functionParams: [1n] }],
    });
    expect(result.result).toBe('CANCELLED');
  });

  it('returns a PENDING whose settle() never resolves for timeout', async () => {
    setNextFault('callSmartContract', 'timeout');
    const result = await lemonBridgeMock.callSmartContract({
      contracts: [{ address: CORE, functionName: 'deposit', functionParams: [1n] }],
    });
    expect(result.result).toBe('PENDING');
    if (result.result !== 'PENDING') throw new Error('expected PENDING');

    const NEVER = Symbol('never');
    const outcome = await Promise.race([
      result.settle(),
      new Promise((resolve) => setTimeout(() => resolve(NEVER), 50)),
    ]);
    expect(outcome).toBe(NEVER);
  });

  it('returns PENDING that settles to SUCCESS with no fault injected', async () => {
    const result = await lemonBridgeMock.callSmartContract({
      contracts: [{ address: CORE, functionName: 'deposit', functionParams: [1n] }],
    });
    expect(result.result).toBe('PENDING');
    if (result.result !== 'PENDING') throw new Error('expected PENDING');
    const settled = await result.settle();
    expect(settled.result).toBe('SUCCESS');
  });
});

describe('lemonBridgeMock.withdraw', () => {
  it('returns SUCCESS with an amount less than requested for partial', async () => {
    setNextFault('withdraw', 'partial');
    const result = await lemonBridgeMock.withdraw({ amount: 100n, tokenName: 'USDC' });
    if (result.result !== 'PENDING') throw new Error('expected PENDING');
    const settled = await result.settle();
    if (settled.result !== 'SUCCESS') throw new Error('expected SUCCESS');
    expect(settled.amount).toBeLessThan(100n);
  });

  it('returns CANCELLED for rejected', async () => {
    setNextFault('withdraw', 'rejected');
    const result = await lemonBridgeMock.withdraw({ amount: 100n, tokenName: 'USDC' });
    expect(result.result).toBe('CANCELLED');
  });

  it('returns FAILED for failed', async () => {
    setNextFault('withdraw', 'failed');
    const result = await lemonBridgeMock.withdraw({ amount: 100n, tokenName: 'USDC' });
    expect(result.result).toBe('FAILED');
  });
});

describe('consumeNextFault single-use', () => {
  it('only faults the next call, not the one after', async () => {
    setNextFault('deposit', 'insufficient-balance');
    const first = await lemonBridgeMock.deposit({ amount: 100n, tokenName: 'USDC' });
    expect(first.result).toBe('FAILED');

    const second = await lemonBridgeMock.deposit({ amount: 100n, tokenName: 'USDC' });
    expect(second.result).toBe('PENDING');
  });
});
