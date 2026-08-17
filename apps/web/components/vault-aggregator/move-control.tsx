'use client'

import { useState } from 'react'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatUsdc, parseUsdcInput, sanitizeUsdcInput } from '@/lib/format'
import { poolTargetForBps, previewMoveTo, type MovePreview } from '@/lib/vault/move'
import { TxButton, type TxButtonStage } from '@/components/vault-aggregator/tx-button'

interface JarProps {
  label: string
  amount: bigint
  /** Fill height, 0-100. */
  pct: number
  color: string
  emphasis?: boolean
  /** When set, the number under the tank is an input: typing sets the target amount. */
  input?: {
    text: string
    placeholder: string
    disabled: boolean
    onChange: (raw: string) => void
  }
}

/** A tank that fills from the bottom. Two of them side by side turn the split into something you
 * read at a glance instead of comparing two numbers — and the levels swap as the target moves, so
 * the transfer is legible before it is signed. */
function Jar({ label, amount, pct, color, emphasis, input }: JarProps) {
  return (
    <div className="flex flex-1 flex-col items-center gap-2">
      {/* Sentence case, not a kicker: two tanks side by side with their own uppercase labels was
          the eyebrow reflex — one kicker per region is the rule (DESIGN.md). */}
      <span className="text-sm font-medium text-[var(--text-secondary)]">{label}</span>
      <div className="rounded-[12px] relative h-32 w-full overflow-hidden border-[1.5px] border-[var(--border-subtle)] bg-[var(--bg-void)]">
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
      {input ? (
        <label className="flex w-full items-center justify-center gap-1 rounded-[8px] border-[1.5px] border-[var(--border-default)] bg-[var(--bg-surface)] px-2 font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)] focus-within:shadow-[0_0_12px_var(--action-glow)]">
          <span className="text-[var(--text-secondary)]">$</span>
          <input
            type="text"
            inputMode="decimal"
            autoComplete="off"
            aria-label="Cuánto querés tener en el pool"
            value={input.text}
            placeholder={input.placeholder}
            disabled={input.disabled}
            onChange={(event) => input.onChange(event.target.value)}
            className="min-h-[44px] w-full min-w-0 bg-transparent text-center outline-none placeholder:text-[var(--text-secondary)]"
          />
        </label>
      ) : (
        <span className="flex min-h-[44px] items-center font-mono text-lg font-semibold tabular-nums text-[var(--text-primary)]">
          ${formatUsdc(amount)}
        </span>
      )}
    </div>
  )
}

const PILLS = [0, 25, 50, 75, 100] as const

interface MoveControlProps {
  walletUsdc: bigint
  poolUsdc: bigint
  busy?: boolean
  /** The CTA's transaction lifecycle stage (see TxButton). */
  stage?: TxButtonStage
  /** Rendered above the jars. Set only inside Lemon, where the account block above owns its own
   * kicker and this one names the second region. */
  stepLabel?: string
  onMove: (preview: MovePreview) => void
}

/**
 * One number for both directions: how much USDC should sit in the pool. The gap against what sits
 * there today *is* the transaction — above the current position deposits, below it withdraws, and
 * there is no mode to pick first. Two ways to set it: type the amount under the pool tank, or tap
 * a share pill (0 / 25 / 50 / 75 / 100 % of wallet + pool). Both tanks move with the target so the
 * consequence is visible before signing anything.
 *
 * The two amounts are previews while editing; the real ones come back from the chain after the tx.
 */
export function MoveControl({ walletUsdc, poolUsdc, busy, stage = 'idle', stepLabel, onMove }: MoveControlProps) {
  const total = walletUsdc + poolUsdc
  // null = at rest (nothing chosen yet); the input then shows the current pool as a placeholder.
  const [targetPool, setTargetPool] = useState<bigint | null>(null)
  const [text, setText] = useState('')

  const preview = targetPool === null ? previewMoveTo(walletUsdc, poolUsdc, poolUsdc) : previewMoveTo(walletUsdc, poolUsdc, targetPool)
  const empty = total === 0n
  const poolPct = empty ? 0 : Number((preview.poolUsdc * 100n) / total)
  // Both tanks empty when there is nothing anywhere: a "full" wallet tank over $0.00 lies.
  const walletPct = empty ? 0 : 100 - poolPct
  const inFlight = stage === 'confirming' || stage === 'pending'
  const disabled = empty || busy || inFlight

  const clamp = (value: bigint) => (value > total ? total : value)

  function handleType(raw: string) {
    const next = sanitizeUsdcInput(raw)
    setText(next)
    setTargetPool(next === '' ? null : clamp(parseUsdcInput(next)))
  }

  function handlePill(value: string) {
    if (value === '') return // Radix reports '' when the active pill is tapped again: keep it.
    const target = poolTargetForBps(walletUsdc, poolUsdc, BigInt(value) * 100n)
    setTargetPool(target)
    setText(formatUsdc(target))
  }

  const activePill =
    targetPool === null
      ? ''
      : (PILLS.find((pct) => poolTargetForBps(walletUsdc, poolUsdc, BigInt(pct) * 100n) === targetPool)?.toString() ?? '')

  return (
    <div className="flex flex-col gap-4">
      {stepLabel && <span className="kicker">{stepLabel}</span>}

      <div className="flex items-stretch gap-4">
        <Jar
          label="En tu wallet"
          amount={preview.walletUsdc}
          pct={walletPct}
          color="var(--text-secondary)"
        />
        <Jar
          label="En el pool"
          amount={preview.poolUsdc}
          pct={poolPct}
          color="var(--brand)"
          emphasis
          input={{ text, placeholder: formatUsdc(poolUsdc), disabled, onChange: handleType }}
        />
      </div>

      <ToggleGroup
        type="single"
        value={activePill}
        onValueChange={handlePill}
        disabled={disabled}
        aria-label="Parte de tu USDC en el pool"
        className="flex w-full justify-between gap-2"
      >
        {PILLS.map((pct) => (
          <ToggleGroupItem
            key={pct}
            value={String(pct)}
            aria-label={`${pct}%`}
            className="min-h-[44px] flex-1 rounded-full border-[1.5px] border-[var(--border-default)] bg-[var(--bg-surface)] font-mono text-sm font-semibold tabular-nums text-[var(--text-secondary)] data-[state=on]:border-[var(--brand)] data-[state=on]:bg-[var(--brand)] data-[state=on]:text-[var(--bg-void)]"
          >
            {pct}%
          </ToggleGroupItem>
        ))}
      </ToggleGroup>

      {/* The CTA lives the whole tx lifecycle (TxButton): rest -> wallet confirm -> in
          flight -> success/failure -> back. While in flight it is disabled, so a second tap
          can't enqueue the same move twice. */}
      <TxButton
        label={
          preview.kind === 'deposit'
            ? `Depositar $${formatUsdc(preview.amount)}`
            : preview.kind === 'withdraw'
              ? `Retirar $${formatUsdc(preview.amount)}`
              : empty
                ? 'Sin USDC para mover'
                : 'Elegí cuánto va al pool'
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
