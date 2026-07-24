import { getVaults } from '@/lib/vaults'
import { formatUsdc } from '@/lib/format'
import type { PositionState } from '@/lib/mock/position'

const PROTOCOL_COLORS: Record<string, string> = {
  aave: 'var(--aave)',
  morpho: 'var(--morpho)',
  fluid: 'var(--fluid)',
  euler: 'var(--euler)',
}

interface ProtocolBreakdownProps {
  position: PositionState
}

/** One row per protocol from the catalog (D-27: Euler, not Beefy). Names never translate (D-33).
 * A protocol whose reads failed (T-14-08-04) still gets a row: an "unavailable" label, never a
 * silent zero. */
export function ProtocolBreakdown({ position }: ProtocolBreakdownProps) {
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
                <div className="flex shrink-0 items-baseline gap-2 font-mono tabular-nums">
                  <span className="text-sm text-[var(--text-primary)]">${formatUsdc(adapter.valueUsdc)}</span>
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
