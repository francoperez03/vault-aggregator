import { YieldCounter } from '@/components/vault-aggregator/yield-counter'

interface PositionSummaryProps {
  displayedValueUsdc: bigint
  state: 'flat' | 'up' | 'down'
}

/** The route's focal point (14-UI-SPEC §Visual Hierarchy): Display role (28px/600, JetBrains Mono,
 * tabular-nums), state-driven color via `YieldCounter`. 15-UI-SPEC.md §Visual Hierarchy reverses
 * D-26 for this value only: it now ticks per second (VFE-02) instead of being a static read. */
export function PositionSummary({ displayedValueUsdc, state }: PositionSummaryProps) {
  return (
    <div className="flex flex-col items-center gap-1 py-6 text-center">
      <span className="kicker">
        Tu posición
      </span>
      <YieldCounter displayedValueUsdc={displayedValueUsdc} state={state} size="total" />
    </div>
  )
}
