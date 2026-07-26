const BPS = 10_000n

export type MoveKind = 'deposit' | 'withdraw' | 'none'

export interface MovePreview {
  /** What the pool would hold after the move. */
  poolUsdc: bigint
  /** What the wallet would hold after the move. */
  walletUsdc: bigint
  /** Absolute size of the move, 0 when there is nothing to do. */
  amount: bigint
  kind: MoveKind
  /** Fraction of the *current* pool position to redeem. Only read when `kind === 'withdraw'`. */
  withdrawBps: bigint
}

/** Where the handle sits at rest: the share of the user's USDC that is already in the pool. */
export function currentPoolBps(walletUsdc: bigint, poolUsdc: bigint): bigint {
  const total = walletUsdc + poolUsdc
  if (total === 0n) return 0n
  return (poolUsdc * BPS) / total
}

/**
 * Turns a slider position (the target share of wallet+pool that should sit in the pool) into a
 * concrete move. Right of rest is a deposit, left is a withdrawal — one control, both directions.
 *
 * Two exactness rules matter more than the interpolation:
 * - Dragging to either end means *all of it*: bps 0 redeems a literal 10000 (never a floor'd 9999
 *   that would strand dust), bps 10000 deposits the entire wallet balance.
 * - Resting on the current split is a no-op even though `currentPoolBps` floors, so the screen
 *   never opens already offering to move a rounding error.
 */
export function previewMove(walletUsdc: bigint, poolUsdc: bigint, targetPoolBps: bigint): MovePreview {
  const total = walletUsdc + poolUsdc
  const atRest: MovePreview = { poolUsdc, walletUsdc, amount: 0n, kind: 'none', withdrawBps: 0n }
  if (total === 0n || targetPoolBps === currentPoolBps(walletUsdc, poolUsdc)) return atRest

  const targetPool =
    targetPoolBps === 0n ? 0n : targetPoolBps === BPS ? total : (total * targetPoolBps) / BPS
  const delta = targetPool - poolUsdc
  if (delta === 0n) return atRest

  if (delta > 0n) {
    const amount = delta > walletUsdc ? walletUsdc : delta
    if (amount === 0n) return atRest
    return {
      poolUsdc: poolUsdc + amount,
      walletUsdc: walletUsdc - amount,
      amount,
      kind: 'deposit',
      withdrawBps: 0n,
    }
  }

  const amount = -delta
  const withdrawBps = targetPool === 0n ? BPS : (amount * BPS) / poolUsdc
  if (withdrawBps === 0n) return atRest
  return {
    poolUsdc: poolUsdc - amount,
    walletUsdc: walletUsdc + amount,
    amount,
    kind: 'withdraw',
    withdrawBps,
  }
}
