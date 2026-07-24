export interface WithdrawalReconciliation {
  requested: bigint
  actual: bigint
  remaining: bigint
  outcome: 'complete' | 'partial' | 'none'
}

/** D-19: measure what actually moved, never pre-compute it from the request. Mirrors the
 * contract's own post-redeem reconciliation (Phase 12): `actual` always comes from a balance
 * delta, never from the requested amount. Pure — the caller does the reading, this only
 * classifies what was read. No automatic follow-up call is offered for the difference: chaining
 * an unrequested signature to chase `remaining` is exactly what D-19 rejects. */
export function reconcileWithdrawal(input: {
  requested: bigint
  balanceBefore: bigint
  balanceAfter: bigint
}): WithdrawalReconciliation {
  const { requested, balanceBefore, balanceAfter } = input

  if (balanceAfter > balanceBefore) {
    throw new Error(
      'reconcileWithdrawal: balanceAfter > balanceBefore is an impossible state, indicates a corrupt read.',
    )
  }

  const actual = balanceBefore - balanceAfter
  const remaining = actual >= requested ? 0n : requested - actual
  const outcome: WithdrawalReconciliation['outcome'] =
    actual === 0n ? 'none' : remaining === 0n ? 'complete' : 'partial'

  return { requested, actual, remaining, outcome }
}
