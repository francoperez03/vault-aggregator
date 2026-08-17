'use client';

import { useCallback, useState } from 'react';
import { getLemonBridge, type LemonTxOutcome } from '@/lib/lemon/bridge';
import type { TxPhase } from '@/components/vault-aggregator/transaction-state';

export type LemonDirection = 'in' | 'out';

const INSUFFICIENT = 'INSUFFICIENT_BALANCE';

/**
 * Lemon's outcomes mapped to the shared five-state machine: PENDING counts as accepted for this
 * off-chain boundary (unlike on-chain writes, where it stays distinct), CANCELLED is the user saying
 * no and not an error, and a FAILED keeps Lemon's own code visible in the copy when we know it.
 *
 * `INSUFFICIENT_BALANCE` on the way in is the one failure we cannot pre-empt: the SDK exposes no
 * balance read, so the amount always goes out blind and the rejection is the first news we get.
 */
function outcomeToPhase(outcome: LemonTxOutcome, direction: LemonDirection): TxPhase {
  if (outcome.result === 'SUCCESS') return { kind: 'success', amount: outcome.amount };
  // For the Lemon-boundary transfer, PENDING means Lemon accepted the request and is moving the
  // funds itself; showing it as a failure would send the user to retry a transfer already in
  // flight (BananitaSwap, WakeUp's production mini-app, treats PENDING as accepted here too).
  if (outcome.result === 'PENDING') return { kind: 'success' };
  if (outcome.result === 'CANCELLED') return { kind: 'rejected' };
  if (outcome.error.includes(INSUFFICIENT)) {
    return {
      kind: 'reverted',
      reason:
        direction === 'in'
          ? 'No te alcanza el saldo de tu cuenta Lemon para ese monto.'
          : 'No te alcanza el saldo de tu wallet para ese monto.',
    };
  }
  return { kind: 'reverted', reason: outcome.error, detail: outcome.detail };
}

export interface UseLemonTransferResult {
  phase: TxPhase | null;
  isBusy: boolean;
  /** Lemon account → mini-app wallet. Blocked by Lemon itself on testnets (docs: functions/deposit). */
  bringFromLemon: (amount: bigint) => Promise<TxPhase>;
  /** Mini-app wallet → Lemon account, the same boundary a withdrawal's second step crosses. */
  sendToLemon: (amount: bigint) => Promise<TxPhase>;
  reset: () => void;
}

/**
 * Step 1 of the two-step money path: moving USDC across the Lemon boundary. Kept out of the
 * components so the SDK is reached the same way every other write is — through a hook that owns
 * the phase — and so the mock bridge substitutes cleanly in tests and outside the WebView.
 */
export function useLemonTransfer(): UseLemonTransferResult {
  const [phase, setPhase] = useState<TxPhase | null>(null);

  const run = useCallback(async (direction: LemonDirection, amount: bigint): Promise<TxPhase> => {
    setPhase({ kind: 'signing' });
    const bridge = getLemonBridge();
    const first =
      direction === 'in'
        ? await bridge.deposit({ amount, tokenName: 'USDC' })
        : await bridge.withdraw({ amount, tokenName: 'USDC' });
    const outcome = first.result === 'PENDING' ? await first.settle() : first;
    const next = outcomeToPhase(outcome, direction);
    setPhase(next);
    return next;
  }, []);

  return {
    phase,
    isBusy: phase?.kind === 'signing',
    bringFromLemon: useCallback((amount: bigint) => run('in', amount), [run]),
    sendToLemon: useCallback((amount: bigint) => run('out', amount), [run]),
    reset: useCallback(() => setPhase(null), []),
  };
}
