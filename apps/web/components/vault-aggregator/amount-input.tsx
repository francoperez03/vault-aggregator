'use client'

import { Minus, Plus } from 'lucide-react'
import { formatUsdc } from '@/lib/format'
import { cn } from '@/lib/utils'

const STEP = 10_000_000n // 10 USDC, 6-decimal atomic units
const PRESETS = [100, 500, 1000, 5000] as const
const USDC_UNIT = 1_000_000n

interface AmountInputProps {
  value: bigint
  onChange: (next: bigint) => void
  className?: string
}

/** The deposit route's focal point (14-UI-SPEC §Visual Hierarchy). Amount lives as a bigint of
 * 6 decimals end to end (T-14-03-01) — `number` only ever touches the display formatting, never
 * the value that later becomes the tx argument. */
export function AmountInput({ value, onChange, className }: AmountInputProps) {
  const decrement = () => onChange(value > STEP ? value - STEP : 0n)
  const increment = () => onChange(value + STEP)

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div className="flex flex-wrap gap-1.5">
        {PRESETS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => onChange(BigInt(preset) * USDC_UNIT)}
            className="min-h-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 text-xs font-semibold tabular-nums text-[var(--text-secondary)]"
          >
            ${preset >= 1000 ? `${preset / 1000}K` : preset}
          </button>
        ))}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-3 py-3">
        <button
          type="button"
          aria-label="Reducir monto"
          onClick={decrement}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[var(--border-subtle)]"
        >
          <Minus className="size-4" aria-hidden="true" />
        </button>
        <span className="font-mono text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
          ${formatUsdc(value)}
        </span>
        <button
          type="button"
          aria-label="Aumentar monto"
          onClick={increment}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg border border-[var(--border-subtle)]"
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  )
}
