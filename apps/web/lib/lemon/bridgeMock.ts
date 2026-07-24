import { createSiweMessage } from 'viem/siwe';
import type { LemonBridge, LemonContractCall, LemonTxOutcome } from './bridge';
import { consumeNextFault } from './faultInjection';

/** Deterministic dev/QA address — real Lemon signing cannot be proven locally. */
const MOCK_ADDRESS = '0x000000000000000000000000000000000000000A' as const;
const MOCK_OTHER_ADDRESS = '0x000000000000000000000000000000000000000B' as const;
const MOCK_CHAIN_ID = 421614;
const MOCK_DOMAIN = 'vault-aggregator.lemon.mock';

let lastCallSmartContractRequest: { contracts: LemonContractCall[] } | null = null;

/** Exposed for test assertions. */
export function getLastCallSmartContractRequest(): { contracts: LemonContractCall[] } | null {
  return lastCallSmartContractRequest;
}

function mockTxHash(): `0x${string}` {
  return `0x${'ab'.repeat(32)}` as `0x${string}`;
}

/** Resolves to SUCCESS on the next tick — never immediately (Pitfall 2). */
function pendingThenSuccess(amount?: bigint): LemonTxOutcome {
  const txHash = mockTxHash();
  return {
    result: 'PENDING',
    txHash,
    settle: () =>
      new Promise((resolve) => {
        setTimeout(() => resolve({ result: 'SUCCESS', txHash, amount }), 0);
      }),
  };
}

/** A PENDING whose settle() never resolves — models the `timeout` fault. */
function pendingForever(): LemonTxOutcome {
  return {
    result: 'PENDING',
    txHash: mockTxHash(),
    settle: () => new Promise(() => {}),
  };
}

function validateContractCall(call: LemonContractCall): void {
  if (!call.functionName) {
    throw new Error('lemonBridgeMock.callSmartContract: functionName is required.');
  }
  if (!Array.isArray(call.functionParams)) {
    throw new Error('lemonBridgeMock.callSmartContract: functionParams must be an array.');
  }
}

/**
 * Committed Lemon WebView bridge mock, extended with `deposit`/`withdraw` and
 * fault injection (D-20). Cannot prove real Lemon signing behavior — that
 * logic lives in Lemon's closed native app.
 */
export const lemonBridgeMock: LemonBridge = {
  async authenticate(nonce) {
    const fault = consumeNextFault('authenticate');

    if (fault === 'signature-rejected') {
      throw new Error('Lemon authenticate: signature rejected.');
    }
    if (fault === 'nonce-expired') {
      throw new Error('Lemon authenticate: nonce expired.');
    }

    const address = fault === 'different-wallet' ? MOCK_OTHER_ADDRESS : MOCK_ADDRESS;
    const message = createSiweMessage({
      address,
      chainId: MOCK_CHAIN_ID,
      domain: MOCK_DOMAIN,
      nonce,
      uri: `https://${MOCK_DOMAIN}`,
      version: '1',
    });
    // ponytail: no real key material — the mock only proves the message/nonce round-trip.
    const signature = `0x${'00'.repeat(65)}` as `0x${string}`;
    return { address, message, signature };
  },

  async deposit({ amount, tokenName }) {
    if (tokenName !== 'USDC') {
      throw new Error(`lemonBridgeMock.deposit: unsupported tokenName "${tokenName}".`);
    }
    const fault = consumeNextFault('deposit');

    if (fault === 'insufficient-balance') {
      return { result: 'FAILED', error: 'Insufficient balance.' };
    }
    if (fault === 'rejected') {
      return { result: 'CANCELLED' };
    }
    if (fault === 'partial') {
      return pendingThenSuccess(amount / 2n);
    }
    return pendingThenSuccess(amount);
  },

  async callSmartContract(req) {
    for (const call of req.contracts) validateContractCall(call);
    lastCallSmartContractRequest = req;

    const fault = consumeNextFault('callSmartContract');

    if (fault === 'revert') {
      return { result: 'FAILED', error: 'execution reverted' };
    }
    if (fault === 'rejected') {
      return { result: 'CANCELLED' };
    }
    if (fault === 'timeout') {
      return pendingForever();
    }
    return pendingThenSuccess();
  },

  async withdraw({ amount, tokenName }) {
    if (tokenName !== 'USDC') {
      throw new Error(`lemonBridgeMock.withdraw: unsupported tokenName "${tokenName}".`);
    }
    const fault = consumeNextFault('withdraw');

    if (fault === 'failed') {
      return { result: 'FAILED', error: 'Withdraw failed.' };
    }
    if (fault === 'rejected') {
      return { result: 'CANCELLED' };
    }
    if (fault === 'partial') {
      return pendingThenSuccess(amount / 2n);
    }
    return pendingThenSuccess(amount);
  },
};
