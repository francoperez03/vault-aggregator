import { getVaults } from '@/lib/vaults'
import { YieldCounter } from '@/components/vault-aggregator/yield-counter'
import type { PositionState } from '@/lib/mock/position'
import type { AdapterId } from '@/lib/contracts/config'

const PROTOCOL_COLORS: Record<string, string> = {
  aave: 'var(--aave)',
  morpho: 'var(--morpho)',
  fluid: 'var(--fluid)',
  euler: 'var(--euler)',
}

type YieldEntry = { displayedValueUsdc: bigint; state: 'flat' | 'up' | 'down' }

interface ProtocolBreakdownProps {
  position: PositionState
  /** VFE-02's live per-adapter ticking value (from `useVaultYield`). Optional so existing
   * fixture-driven callers (this component's own tests, `HomePositionView` direct-render tests)
   * keep working unchanged: an adapter missing here falls back to its static `valueUsdc`/flat. */
  yieldByAdapter?: Partial<Record<AdapterId, YieldEntry>>
}

/** One row per protocol from the catalog (D-27: Euler, not Beefy). Names never translate (D-33).
 * A protocol whose reads failed (T-14-08-04) still gets a row: an "unavailable" label, never a
 * silent zero. The value cell is the shared `YieldCounter` (VFE-02) — ticking per second when a
 * derived rate exists, static/`--text-secondary` otherwise; the unavailable branch is untouched. */
export function ProtocolBreakdown({ position, yieldByAdapter }: ProtocolBreakdownProps) {
  const rows = getVaults().filter(
    (vault) => position.perAdapter[vault.id].valueUsdc > 0n || position.perAdapter[vault.id].unavailable,
  )

  if (rows.length === 0) return null

  return (
    <div className="space-y-2">
      <h3 className="mb-3 text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        Por protocolo
      </h3>
      <div className="space-y-2">
        {rows.map((vault) => {
          const adapter = position.perAdapter[vault.id]
          const y: YieldEntry = yieldByAdapter?.[vault.id] ?? { displayedValueUsdc: adapter.valueUsdc, state: 'flat' }
          return (
            <div
              key={vault.id}
              className="flex items-center justify-between gap-3 rounded-[12px] border border-[var(--border-subtle)] px-3 py-2.5"
            >
              <div className="flex min-w-0 items-center gap-2">
                <span
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: PROTOCOL_COLORS[vault.id] ?? 'var(--text-secondary)' }}
                  aria-hidden="true"
                />
                <span className="truncate text-sm font-semibold text-[var(--text-primary)]">{vault.protocol}</span>
              </div>
              {adapter.unavailable ? (
                <span className="shrink-0 text-xs font-semibold text-[var(--warning)]">No disponible</span>
              ) : (
                <div className="flex shrink-0 items-baseline gap-2">
                  <YieldCounter displayedValueUsdc={y.displayedValueUsdc} state={y.state} size="row" />
                  <span className="text-xs text-[var(--text-secondary)]">{adapter.weightBps / 100}%</span>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
