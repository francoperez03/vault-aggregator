'use client'

import { useState } from 'react'
import { formatUsdc, parseUsdcInput, sanitizeUsdcInput } from '@/lib/format'
import { cn } from '@/lib/utils'

interface AmountInputProps {
  value: bigint
  onChange: (next: bigint) => void
  className?: string
}

/** The deposit route's focal point (14-UI-SPEC §Visual Hierarchy). Free text entry: presets and a
 * ±10 stepper were both removed on request — deposit amounts here are whatever the user has, and
 * a stepper turns "quiero poner 37,5" into four taps and a rounding error. */
export function AmountInput({ value, onChange, className }: AmountInputProps) {
  // Empty at zero: a field that opens on "0.00" makes the user delete before typing, and the
  // placeholder already shows the shape. A prefilled amount (parked money) still shows.
  const [text, setText] = useState(() => (value === 0n ? '' : formatUsdc(value)))

  function handleChange(raw: string) {
    const next = sanitizeUsdcInput(raw)
    setText(next)
    onChange(parseUsdcInput(next))
  }

  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3',
        className,
      )}
    >
      <span className="font-mono text-2xl font-semibold text-[var(--text-secondary)]">$</span>
      <input
        type="text"
        inputMode="decimal"
        autoComplete="off"
        aria-label="Monto a depositar en USDC"
        value={text}
        onChange={(event) => handleChange(event.target.value)}
        placeholder="0.00"
        className="min-h-[44px] w-full min-w-0 bg-transparent font-mono text-2xl font-semibold tabular-nums text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)]"
      />
      <span className="text-xs font-semibold text-[var(--text-secondary)]">USDC</span>
    </div>
  )
}
