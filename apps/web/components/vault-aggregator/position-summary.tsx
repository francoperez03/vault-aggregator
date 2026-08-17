import type { ReactNode } from 'react'
import { formatUsdcPrecise } from '@/lib/format'
import { cn } from '@/lib/utils'

interface PositionSummaryProps {
  displayedValueUsdc: bigint
  state: 'flat' | 'up' | 'down'
  /** Summed per-adapter yield rate, atomic USDC units per second (from `useVaultYield`). Zero or
   * absent hides the earnings row and the APY pill: nothing derived, nothing claimed. */
  ratePerSecond?: number
  /** The money that is not in the pool yet, under a divider: inside Lemon the account block
   * (mini-app balance + Traer/Enviar), on the web the wallet balance. One card, all the money. */
  footer?: ReactNode
}

const SECONDS_PER_YEAR = 365 * 24 * 60 * 60

/** The route's focal point (14-UI-SPEC §Visual Hierarchy), as a card: the total in the Display
 * role split into whole and fraction (the fraction is what actually moves per second, VFE-02),
 * a live APY pill and an earnings-per-second row — both derived from the observed on-chain rate,
 * never from the catalog's placeholder APYs, so they only appear once there is a real rate. */
export function PositionSummary({ displayedValueUsdc, state, ratePerSecond = 0, footer }: PositionSummaryProps) {
  const [whole, fraction] = formatUsdcPrecise(displayedValueUsdc).split('.')
  const earning = ratePerSecond > 0
  const usdPerSecond = ratePerSecond / 1_000_000
  const principal = Number(displayedValueUsdc) / 1_000_000
  const apy = principal > 0 ? (usdPerSecond * SECONDS_PER_YEAR * 100) / principal : 0

  return (
    <section
      aria-label="Tu posición"
      className={cn(
        'relative overflow-hidden rounded-[16px] border border-[var(--border-default)] px-5 py-5',
        '[background:var(--surface-card)]',
        // Two soft radials, brand top-left and yield bottom-right: the card's own ambient, the
        // same language as the page background but concentrated where the money is.
        'before:pointer-events-none before:absolute before:-left-20 before:-top-20 before:size-60 before:rounded-full before:bg-[radial-gradient(circle,var(--brand-glow)_0%,transparent_70%)]',
        'after:pointer-events-none after:absolute after:-bottom-14 after:-right-14 after:size-44 after:rounded-full after:bg-[radial-gradient(circle,var(--yield-glow)_0%,transparent_70%)]',
      )}
    >
      <span className="kicker">Tu posición</span>

      <p
        className={cn(
          'yield-counter mt-3 font-mono text-[40px] font-semibold leading-none tabular-nums tracking-[-0.02em]',
          state === 'down' ? 'text-[var(--warning)]' : 'text-[var(--text-primary)]',
        )}
      >
        ${whole}
        <span
          className={cn(
            'text-[22px]',
            state === 'up' ? 'text-[var(--yield)]' : state === 'down' ? 'text-[var(--warning)]' : 'text-[var(--text-secondary)]',
          )}
        >
          .{fraction}
        </span>
      </p>

      {earning && (
        <>
          <span className="apy-pill mt-4 inline-flex items-center gap-1.5 rounded-full border border-[var(--yield)]/25 bg-[var(--yield)]/10 px-3 py-1 font-mono text-[13px] font-semibold text-[var(--yield)]">
            <span className="apy-dot size-1.5 rounded-full bg-[var(--yield)]" aria-hidden="true" />
            {apy.toFixed(2)}% APY
          </span>
          <div className="mt-4 flex items-center justify-between border-t border-[var(--border-subtle)] pt-3 text-xs">
            <span className="text-[var(--text-secondary)]">Rendimiento por segundo</span>
            <span className="font-mono font-semibold tabular-nums text-[var(--yield)]">
              +${usdPerSecond.toFixed(6)}/s
            </span>
          </div>
        </>
      )}

      {footer && <div className="mt-4 border-t border-[var(--border-subtle)] pt-4">{footer}</div>}
    </section>
  )
}
