import { formatUsdcPrecise } from '@/lib/format'

interface YieldCounterProps {
  displayedValueUsdc: bigint
  state: 'flat' | 'up' | 'down'
  size: 'total' | 'row'
}

const SIZE_CLASSES: Record<YieldCounterProps['size'], string> = {
  total: 'inline-block text-center font-mono text-[28px] font-semibold tabular-nums leading-[1.2]',
  row: 'inline-block text-right font-mono text-sm font-semibold tabular-nums',
}

const STATE_CLASSES: Record<YieldCounterProps['state'], string> = {
  up: 'text-[var(--yield)]',
  flat: 'text-[var(--text-secondary)]',
  down: 'text-[var(--warning)]',
}

/** VFE-02's one shared ticking `<span>`, two placements (15-UI-SPEC.md §Typography): the 28px
 * total in `position-summary.tsx` and the 14px per-row value in `protocol-breakdown.tsx`. Display
 * role, `tabular-nums`, state-driven color (`--yield` up / `--text-secondary` flat / `--warning`
 * down per §Color) — never invents an upward tick, flat/negative render the real value (T-15-06).
 * The one allowed transition (color 300ms ease, guarded by prefers-reduced-motion below) is the
 * only animated moment; per-second digit changes are plain text updates, not CSS animation.
 * No live-region announcement (§Screen reader behavior): a value changing every second would
 * spam assistive tech, so the accessible name stays the static label beside it. */
export function YieldCounter({ displayedValueUsdc, state, size }: YieldCounterProps) {
  return (
    <span
      className={`yield-counter ${SIZE_CLASSES[size]} ${STATE_CLASSES[state]}`}
      // min-w sized to the longest plausible 6-dp value ("10,000,000.000000") so an added digit
      // (e.g. 9.999999 -> 10.000000) never shifts sibling characters or the row/card width.
      style={{ minWidth: '13ch' }}
    >
      ${formatUsdcPrecise(displayedValueUsdc)}
    </span>
  )
}
