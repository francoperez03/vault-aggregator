import {
  authenticate as sdkAuthenticate,
  callSmartContract as sdkCallSmartContract,
  deposit as sdkDeposit,
  withdraw as sdkWithdraw,
  TransactionResult,
  TokenName,
  type ChainId,
} from '@lemoncash/mini-app-sdk';
import { getChainId } from '@/lib/env';
import { lemonBridgeMock } from './bridgeMock';

/** `TokenName` is a closed SDK enum (Pitfall 3) — the vault only ever moves USDC. */
export type LemonTokenName = 'USDC';

export interface LemonContractCall {
  address: `0x${string}`;
  functionName: string;
  functionParams: unknown[];
}

/**
 * SUCCESS and PENDING are distinct results, never collapsed to a boolean (Pitfall 2):
 * `deposit`/`withdraw`/`callSmartContract` can all come back PENDING, and its `settle()`
 * is how the caller finds out what actually happened.
 */
export type LemonTxOutcome =
  | { result: 'SUCCESS'; txHash: `0x${string}`; amount?: bigint }
  | { result: 'PENDING'; txHash: `0x${string}`; settle: () => Promise<LemonTxOutcome> }
  | { result: 'FAILED'; error: string }
  | { result: 'CANCELLED' };

export interface LemonBridge {
  /**
   * Note: this takes the server-issued nonce (from POST /api/siwe/nonce) so
   * the returned SIWE message embeds it — required for the single-use nonce
   * enforcement to bind to this specific auth attempt.
   */
  authenticate(nonce: string): Promise<{ address: `0x${string}`; message: string; signature: `0x${string}` }>;
  callSmartContract(req: { contracts: LemonContractCall[] }): Promise<LemonTxOutcome>;
  deposit(req: { amount: bigint; tokenName: LemonTokenName }): Promise<LemonTxOutcome>;
  withdraw(req: { amount: bigint; tokenName: LemonTokenName }): Promise<LemonTxOutcome>;
}

/** True inside a Lemon WebView (mirrors `window.ReactNativeWebView` presence, per the SDK's own global type). */
export function isLemonWebView(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { ReactNativeWebView?: unknown }).ReactNativeWebView);
}

function getMiniAppId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_LEMON_MINI_APP_ID?.trim();
  return id || undefined;
}

/**
 * PENDING has no receipt-polling mechanism from the SDK itself; `settle()` re-resolves the same
 * PENDING outcome until Phase 15 wires a real polling strategy against a Mini App ID.
 * ponytail: no-op settle, upgrade when the real Lemon SDK exposes transaction status polling.
 */
function pendingOutcome(txHash: `0x${string}`): LemonTxOutcome {
  const outcome: LemonTxOutcome = {
    result: 'PENDING',
    txHash,
    settle: async () => outcome,
  };
  return outcome;
}

const realLemonBridge: LemonBridge = {
  async authenticate(nonce) {
    const response = await sdkAuthenticate({ nonce, chainId: getChainId() as ChainId });
    if (response.result !== TransactionResult.SUCCESS) {
      throw new Error('Lemon authenticate failed or was cancelled.');
    }
    return {
      address: response.data.wallet,
      message: response.data.message,
      signature: response.data.signature,
    };
  },
  async callSmartContract({ contracts }) {
    const response = await sdkCallSmartContract({
      contracts: contracts.map((call) => ({
        contractAddress: call.address,
        functionName: call.functionName,
        functionParams: call.functionParams,
        chainId: getChainId() as ChainId,
      })),
    });
    if (response.result === TransactionResult.FAILED) {
      return { result: 'FAILED', error: response.error?.message ?? 'Lemon callSmartContract failed.' };
    }
    if (response.result === TransactionResult.CANCELLED) {
      return { result: 'CANCELLED' };
    }
    if (response.result === TransactionResult.PENDING) {
      return pendingOutcome(response.data.txHash);
    }
    return { result: 'SUCCESS', txHash: response.data.txHash };
  },
  async deposit({ amount, tokenName }) {
    const response = await sdkDeposit({
      amount: amount.toString(),
      tokenName: TokenName[tokenName],
      chainId: getChainId() as ChainId,
    });
    if (response.result === TransactionResult.FAILED) {
      return { result: 'FAILED', error: response.error?.message ?? 'Lemon deposit failed.' };
    }
    if (response.result === TransactionResult.CANCELLED) {
      return { result: 'CANCELLED' };
    }
    if (response.result === TransactionResult.PENDING) {
      return pendingOutcome(response.data.txHash);
    }
    return { result: 'SUCCESS', txHash: response.data.txHash };
  },
  async withdraw({ amount, tokenName }) {
    const response = await sdkWithdraw({
      amount: amount.toString(),
      tokenName: TokenName[tokenName],
      chainId: getChainId() as ChainId,
    });
    if (response.result === TransactionResult.FAILED) {
      return { result: 'FAILED', error: response.error?.message ?? 'Lemon withdraw failed.' };
    }
    if (response.result === TransactionResult.CANCELLED) {
      return { result: 'CANCELLED' };
    }
    if (response.result === TransactionResult.PENDING) {
      return pendingOutcome(response.data.txHash);
    }
    return { result: 'SUCCESS', txHash: response.data.txHash };
  },
};

/**
 * Real Lemon bridge when inside a Lemon WebView with a Mini App ID configured;
 * the committed mock (D-20) otherwise — including inside a real WebView until
 * NEXT_PUBLIC_LEMON_MINI_APP_ID is set.
 */
export function getLemonBridge(): LemonBridge {
  return isLemonWebView() && getMiniAppId() ? realLemonBridge : lemonBridgeMock;
}
