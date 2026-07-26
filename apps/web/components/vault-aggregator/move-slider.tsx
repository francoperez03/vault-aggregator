'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import { formatUsdc } from '@/lib/format'
import { currentPoolBps, previewMove, type MovePreview } from '@/lib/vault/move'

interface BalanceRowProps {
  label: string
  amount: bigint
  /** Share of wallet+pool this row holds, 0-100, for the proportional bar. */
  pct: number
  color: string
  emphasis?: boolean
}

function BalanceRow({ label, amount, pct, color, emphasis }: BalanceRowProps) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          {label}
        </span>
        <span
          className={cn(
            'font-mono font-semibold tabular-nums text-[var(--text-primary)]',
            emphasis ? 'text-[22px]' : 'text-base',
          )}
        >
          ${formatUsdc(amount)}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-[var(--bg-overlay)]">
        <div
          className="h-full rounded-full transition-[width] duration-150"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  )
}

interface MoveSliderProps {
  walletUsdc: bigint
  poolUsdc: bigint
  busy?: boolean
  /** Rendered above the balances. Set only where the Lemon step exists, so a browser user never
   * reads "Paso 2" with no step 1 anywhere on screen. */
  stepLabel?: string
  onMove: (preview: MovePreview) => void
}

/**
 * One control for both directions: the slider sets what share of the user's USDC should sit in the
 * pool, and the gap against where it sits today *is* the transaction. Right of rest deposits, left
 * of rest withdraws — there is no mode to pick first, and both balances move under the thumb so the
 * consequence is visible before signing anything.
 *
 * The two numbers are previews while dragging; the real ones come back from the chain after the tx.
 */
export function MoveSlider({ walletUsdc, poolUsdc, busy, stepLabel, onMove }: MoveSliderProps) {
  const restBps = currentPoolBps(walletUsdc, poolUsdc)
  const [targetPct, setTargetPct] = useState<number | null>(null)
  const total = walletUsdc + poolUsdc

  const effectiveBps = targetPct === null ? restBps : BigInt(targetPct) * 100n
  const preview = previewMove(walletUsdc, poolUsdc, effectiveBps)

  const poolPct = total === 0n ? 0 : Number((preview.poolUsdc * 100n) / total)

  return (
    <div className="flex flex-col gap-5">
      {stepLabel && (
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          {stepLabel}
        </span>
      )}

      <div className="flex flex-col gap-4">
        <BalanceRow
          label="En tu wallet"
          amount={preview.walletUsdc}
          pct={100 - poolPct}
          color="var(--text-secondary)"
        />
        <BalanceRow
          label="En el pool"
          amount={preview.poolUsdc}
          pct={poolPct}
          color="var(--brand)"
          emphasis
        />
      </div>

      {/* ponytail: the ::after pseudo-element pads the visual thumb to a 44px touch target, same
          trick as allocation-sliders.tsx. */}
      <Slider
        value={[Number(effectiveBps / 100n)]}
        onValueChange={([next]) => setTargetPct(next)}
        min={0}
        max={100}
        step={1}
        disabled={total === 0n || busy}
        aria-label="Cuánto de tu USDC querés tener en el pool"
        className="py-2 [&_[data-slot=slider-thumb]]:relative [&_[data-slot=slider-thumb]]:after:absolute [&_[data-slot=slider-thumb]]:after:-inset-[13px] [&_[data-slot=slider-thumb]]:after:content-['']"
      />

      <Button
        type="button"
        size="lg"
        // At rest the CTA is a hint, not an offer — a full-brand button for a disabled control
        // reads as "tap me" and gets tapped.
        variant={preview.kind === 'none' ? 'outline' : 'default'}
        className="min-h-[44px] w-full"
        disabled={preview.kind === 'none' || busy}
        onClick={() => onMove(preview)}
      >
        {preview.kind === 'deposit'
          ? `Depositar $${formatUsdc(preview.amount)}`
          : preview.kind === 'withdraw'
            ? `Retirar $${formatUsdc(preview.amount)}`
            : 'Mové la barra para depositar o retirar'}
      </Button>
    </div>
  )
}
