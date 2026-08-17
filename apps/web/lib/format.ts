const USDC_UNIT = 1_000_000n

/** Formats an atomic USDC amount (6 decimals, bigint) as a display string, e.g. `10,000.00`. */
export function formatUsdc(atomicAmount: bigint): string {
  const whole = atomicAmount / USDC_UNIT
  const fraction = atomicAmount % USDC_UNIT
  const cents = (fraction * 100n) / USDC_UNIT
  return `${whole.toLocaleString('en-US')}.${cents.toString().padStart(2, '0')}`
}

/** 6-decimal variant for the live yield counter only (15-UI-SPEC §Decimal precision): shows the
 * full on-chain atomic-unit resolution so small per-second deltas are visible, never fabricated
 * precision beyond what convertToAssets already produces. */
export function formatUsdcPrecise(atomicAmount: bigint): string {
  const whole = atomicAmount / USDC_UNIT
  const fraction = atomicAmount % USDC_UNIT
  return `${whole.toLocaleString('en-US')}.${fraction.toString().padStart(6, '0')}`
}

/** Parses a user-typed decimal string (up to 6 decimals) into an atomic USDC bigint. Never
 * routes the amount through `number` — only used for display formatting, never for the tx value. */
export function parseUsdcInput(input: string): bigint {
  const [wholeRaw, fractionRaw = ''] = input.split('.')
  const whole = wholeRaw === '' ? 0n : BigInt(wholeRaw)
  const fraction = fractionRaw.slice(0, 6).padEnd(6, '0')
  return whole * USDC_UNIT + BigInt(fraction === '' ? 0 : fraction)
}

/** Keeps only digits and a single dot, capped at USDC's 6 decimals. Runs on the raw keystroke
 * string, never on a `number`, so the parsed value stays a bigint end to end (T-14-03-01). */
export function sanitizeUsdcInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.]/g, '')
  const [whole = '', ...rest] = cleaned.split('.')
  if (rest.length === 0) return whole
  return `${whole}.${rest.join('').slice(0, 6)}`
}
