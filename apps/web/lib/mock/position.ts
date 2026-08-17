import type { AdapterId } from '@/lib/contracts/config'
import { ADAPTER_IDS } from '@/lib/contracts/config'

/**
 * Fixture shape for `HomePositionView`/`ProtocolBreakdown`. Plan 08 no longer feeds `app/page.tsx`
 * from this module (see `toPositionState` there, which composes the same shape from
 * `useVaultPosition()`'s `sharesOf`/`adapterTotalShares`/`totalAssets` reads per D-21) — this file
 * stays only as a test fixture.
 *
 * `valueUsdc`/`totalUsdc` are atomic USDC units (6 decimals), never `number`.
 */
export interface PositionState {
  perAdapter: Record<
    AdapterId,
    { shares: bigint; valueUsdc: bigint; weightBps: number; unavailable?: boolean }
  >
  totalUsdc: bigint
  /** Derived from weightBps per adapter (D-14/D-23) — never a separate "onboarded" flag
   * (14-RESEARCH.md Pitfall 4). Kept as a field here because plan 08's real hook computes it
   * once from the same per-adapter reads and callers shouldn't re-derive it. */
  hasWeights: boolean
  /** D-19: an in-flight withdrawal step 2 (redeemed on-chain, not yet settled to Lemon). */
  pendingWithdrawalUsdc?: bigint
}

const USDC_UNIT = 1_000_000n

function toUsdc(whole: number): bigint {
  return BigInt(whole) * USDC_UNIT
}

function entry(shares: bigint, valueUsdc: bigint, weightBps: number) {
  return { shares, valueUsdc, weightBps }
}

function deriveHasWeights(perAdapter: PositionState['perAdapter']): boolean {
  return ADAPTER_IDS.some((id) => perAdapter[id].weightBps > 0)
}

const zeroAdapters: PositionState['perAdapter'] = {
  morpho: entry(0n, 0n, 0),
  fluid: entry(0n, 0n, 0),
  euler: entry(0n, 0n, 0),
  aave: entry(0n, 0n, 0),
}

export const MOCK_EMPTY: PositionState = {
  perAdapter: zeroAdapters,
  totalUsdc: 0n,
  hasWeights: deriveHasWeights(zeroAdapters),
}

const weightsOnlyAdapters: PositionState['perAdapter'] = {
  morpho: entry(0n, 0n, 3000),
  fluid: entry(0n, 0n, 2000),
  euler: entry(0n, 0n, 1000),
  aave: entry(0n, 0n, 4000),
}

export const MOCK_WEIGHTS_ONLY: PositionState = {
  perAdapter: weightsOnlyAdapters,
  totalUsdc: 0n,
  hasWeights: deriveHasWeights(weightsOnlyAdapters),
}

const fundedAdapters: PositionState['perAdapter'] = {
  morpho: entry(toUsdc(3_000), toUsdc(3_000), 3000),
  fluid: entry(toUsdc(2_000), toUsdc(2_000), 2000),
  euler: entry(toUsdc(1_000), toUsdc(1_000), 1000),
  aave: entry(toUsdc(4_000), toUsdc(4_000), 4000),
}

export const MOCK_FUNDED: PositionState = {
  perAdapter: fundedAdapters,
  totalUsdc: toUsdc(10_000),
  hasWeights: deriveHasWeights(fundedAdapters),
}
