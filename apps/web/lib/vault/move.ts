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
 * Turns a target pool amount ("I want this much sitting in the pool") into a concrete move. Above
 * the current position is a deposit, below is a withdrawal — one number, both directions.
 *
 * Exactness rules matter more than the arithmetic:
 * - A target at or above wallet+pool means *all of it*: the whole wallet balance is deposited.
 * - A target of 0 redeems a literal 10000 bps (never a floor'd 9999 that would strand dust).
 * - A target equal to the current pool is a no-op, so the screen never opens already offering to
 *   move a rounding error.
 */
export function previewMoveTo(walletUsdc: bigint, poolUsdc: bigint, targetPoolUsdc: bigint): MovePreview {
  const total = walletUsdc + poolUsdc
  const atRest: MovePreview = { poolUsdc, walletUsdc, amount: 0n, kind: 'none', withdrawBps: 0n }
  if (total === 0n) return atRest

  const targetPool = targetPoolUsdc < 0n ? 0n : targetPoolUsdc > total ? total : targetPoolUsdc
  const delta = targetPool - poolUsdc
  if (delta === 0n) return atRest

  if (delta > 0n) {
    return {
      poolUsdc: poolUsdc + delta,
      walletUsdc: walletUsdc - delta,
      amount: delta,
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

/** Target pool amount for a share of wallet+pool: the ends are exact (0 and the full total). */
export function poolTargetForBps(walletUsdc: bigint, poolUsdc: bigint, targetPoolBps: bigint): bigint {
  const total = walletUsdc + poolUsdc
  return targetPoolBps <= 0n ? 0n : targetPoolBps >= BPS ? total : (total * targetPoolBps) / BPS
}

/** Share-based entry point kept for callers that think in bps; resting on the current split is a
 * no-op even though `currentPoolBps` floors. */
export function previewMove(walletUsdc: bigint, poolUsdc: bigint, targetPoolBps: bigint): MovePreview {
  if (targetPoolBps === currentPoolBps(walletUsdc, poolUsdc)) {
    return { poolUsdc, walletUsdc, amount: 0n, kind: 'none', withdrawBps: 0n }
  }
  return previewMoveTo(walletUsdc, poolUsdc, poolTargetForBps(walletUsdc, poolUsdc, targetPoolBps))
}
