import { formatUsdc } from '@/lib/format'

interface PositionSummaryProps {
  totalUsdc: bigint
}

/** The route's focal point (14-UI-SPEC §Visual Hierarchy): Display role (28px/600, JetBrains Mono,
 * tabular-nums), `--yield` token. D-26: the number is a static read, never animated/incremented. */
export function PositionSummary({ totalUsdc }: PositionSummaryProps) {
  return (
    <div className="flex flex-col items-center gap-1 py-6 text-center">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        Tu posición
      </span>
      <span className="font-mono text-[28px] font-semibold tabular-nums leading-[1.2] text-[var(--yield)]">
        ${formatUsdc(totalUsdc)}
      </span>
    </div>
  )
}
