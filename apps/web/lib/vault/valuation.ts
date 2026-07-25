/** Virtual offset, mirrors share_math::OFFSET_POW (10^6, USDC has 6 decimals). */
export const OFFSET_POW = 1_000_000n;

/**
 * TS replica of vault-core `share_math::convert_to_assets` (floor rounding, virtual offset).
 * NOT the simplified formula documented in `core.rs`'s doc-comment — this is the exact
 * `numerator = totalAssets + 1` / `denominator = totalShares + OFFSET_POW` form, matched wei for
 * wei against `share_math.rs`'s own unit tests (D-24).
 *
 * All amounts are `bigint`: shares are not bounded by `Number.MAX_SAFE_INTEGER` even though USDC
 * itself has only 6 decimals.
 */
export function convertToAssets(shares: bigint, totalShares: bigint, totalAssets: bigint): bigint {
  const numerator = totalAssets + 1n;
  const denominator = totalShares + OFFSET_POW;
  return (shares * numerator) / denominator;
}

/**
 * D-21: USDC value of a user's position in one adapter, composed client-side from
 * `sharesOf(user, adapter)`, `adapterTotalShares(adapter)` and `adapter.totalAssets()`.
 */
export function positionValue(
  userShares: bigint,
  adapterTotalShares: bigint,
  adapterTotalAssets: bigint,
): bigint {
  return convertToAssets(userShares, adapterTotalShares, adapterTotalAssets);
}
