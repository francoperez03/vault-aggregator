'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Slider } from '@/components/ui/slider'
import { formatUsdc } from '@/lib/format'
import { currentPoolBps, previewMove, type MovePreview } from '@/lib/vault/move'
import { TxButton, type TxButtonStage } from '@/components/vault-aggregator/tx-button'

interface JarProps {
  label: string
  amount: bigint
  /** Fill height, 0-100. */
  pct: number
  color: string
  emphasis?: boolean
}

/** A tank that fills from the bottom. Two of them side by side turn the split into something you
 * read at a glance instead of comparing two numbers — and the levels swap as the thumb moves, so
 * the transfer is legible before it is signed. */
function Jar({ label, amount, pct, color, emphasis }: JarProps) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      {/* Sentence case, not a kicker: two tanks side by side with their own uppercase labels was
          the eyebrow reflex — one kicker per region is the rule (DESIGN.md). */}
      <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
      <div className="chamfer relative h-32 w-full overflow-hidden border-[1.5px] border-[var(--border-subtle)] bg-[var(--bg-void)]">
        <div
          className="absolute inset-x-0 bottom-0 transition-[height] duration-[var(--dur-base)] ease-[var(--ease-snap)]"
          style={{
            height: `${pct}%`,
            backgroundColor: color,
            opacity: emphasis ? 0.85 : 0.3,
            boxShadow: emphasis ? `0 0 24px ${color}` : undefined,
          }}
        />
      </div>
      {/* Same type size on both sides on purpose: a bigger number under one tank would misalign
          the two columns and read as a different kind of value. Emphasis lives in the fill. */}
      <span className="font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
        ${formatUsdc(amount)}
      </span>
    </div>
  )
}

interface MoveSliderProps {
  walletUsdc: bigint
  poolUsdc: bigint
  busy?: boolean
  /** The CTA's transaction lifecycle stage (see TxButton). */
  stage?: TxButtonStage
  /** Rendered above the jars. Set only where the Lemon step exists, so a browser user never reads
   * "Paso 2" with no step 1 anywhere on screen. */
  stepLabel?: string
  onMove: (preview: MovePreview) => void
}

/**
 * One control for both directions: the slider sets what share of the user's USDC should sit in the
 * pool, and the gap against where it sits today *is* the transaction. Right of rest deposits, left
 * of rest withdraws — there is no mode to pick first, and both tanks move under the thumb so the
 * consequence is visible before signing anything.
 *
 * The two amounts are previews while dragging; the real ones come back from the chain after the tx.
 */
export function MoveSlider({ walletUsdc, poolUsdc, busy, stage = 'idle', stepLabel, onMove }: MoveSliderProps) {
  const restBps = currentPoolBps(walletUsdc, poolUsdc)
  const [targetPct, setTargetPct] = useState<number | null>(null)
  const total = walletUsdc + poolUsdc

  const effectiveBps = targetPct === null ? restBps : BigInt(targetPct) * 100n
  const preview = previewMove(walletUsdc, poolUsdc, effectiveBps)
  const poolPct = total === 0n ? 0 : Number((preview.poolUsdc * 100n) / total)
  const inFlight = stage === 'confirming' || stage === 'pending'
  const disabled = total === 0n || busy || inFlight

  return (
    <div className="flex flex-col gap-4">
      {stepLabel && <span className="kicker">{stepLabel}</span>}

      <div className="flex items-stretch gap-4">
        <Jar
          label="En tu wallet"
          amount={preview.walletUsdc}
          pct={100 - poolPct}
          color="var(--text-secondary)"
        />
        <Jar label="En el pool" amount={preview.poolUsdc} pct={poolPct} color="var(--brand)" emphasis />
      </div>

      <p className="text-center text-sm text-[var(--text-secondary)]">
        <span className="font-mono font-semibold tabular-nums text-[var(--text-primary)]">
          {poolPct}%
        </span>{' '}
        en el pool
      </p>

      <div className="flex items-center gap-3">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="chamfer-sm px-3"
          disabled={disabled}
          onClick={() => setTargetPct(0)}
        >
          MIN
        </Button>

        {/* ponytail: the ::after pseudo-element pads the visual thumb to a 44px touch target, same
            trick as allocation-sliders.tsx. */}
        <Slider
          value={[Number(effectiveBps / 100n)]}
          onValueChange={([next]) => setTargetPct(next)}
          min={0}
          max={100}
          step={1}
          disabled={disabled}
          aria-label="Cuánto de tu USDC querés tener en el pool"
          className="flex-1 py-2 [&_[data-slot=slider-thumb]]:relative [&_[data-slot=slider-thumb]]:after:absolute [&_[data-slot=slider-thumb]]:after:-inset-[13px] [&_[data-slot=slider-thumb]]:after:content-['']"
        />

        <Button
          type="button"
          variant="outline"
          size="sm"
          className="chamfer-sm px-3"
          disabled={disabled}
          onClick={() => setTargetPct(100)}
        >
          MAX
        </Button>
      </div>

      {/* The CTA lives the whole tx lifecycle (TxButton): rest -> wallet confirm -> in
          flight -> success/failure -> back. While in flight it is disabled, so a second tap
          can't enqueue the same move twice. */}
      <TxButton
        label={
          preview.kind === 'deposit'
            ? `Depositar $${formatUsdc(preview.amount)}`
            : preview.kind === 'withdraw'
              ? `Retirar $${formatUsdc(preview.amount)}`
              : 'Mové la barra'
        }
        stage={stage}
        // At rest the CTA is a hint, not an offer — a full-brand button for a disabled control
        // reads as "tap me" and gets tapped.
        variant={preview.kind === 'none' ? 'outline' : 'default'}
        disabled={preview.kind === 'none' || busy}
        onClick={() => onMove(preview)}
      />
    </div>
  )
}
