'use client'

import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { cn } from '@/lib/utils'
import { ADAPTER_IDS, type AdapterId } from '@/lib/contracts/config'
import { sumBps } from '@/lib/vault/weights'

const RING_COLOR: Record<AdapterId, string> = {
  morpho: 'var(--morpho)',
  fluid: 'var(--fluid)',
  euler: 'var(--euler)',
  aave: 'var(--aave)',
}

const R = 74
const CIRC = 2 * Math.PI * R
/** Visual breathing room between arcs, in circumference units (~2.6% total). */
const GAP = CIRC * 0.016

/**
 * The allocation as a body: one ring, four arcs, redrawn live while the sliders move. The arcs
 * tween through anime.js so a redistribution reads as weight flowing between protocols, not as a
 * repaint. Idle it turns, slowly — the same "system is on" language as the app's ambient layers.
 */
export function StrategyRing({
  allocation,
  funded = true,
}: {
  allocation: Partial<Record<AdapterId, number>>
  /** False when the strategy exists but the account holds nothing yet: the center stops
   * claiming "100% asignado" (of what?) and asks for the deposit instead. */
  funded?: boolean
}) {
  const arcRefs = useRef<Partial<Record<AdapterId, SVGCircleElement | null>>>({})
  const values = useRef<Record<AdapterId, number>>({ morpho: 0, fluid: 0, euler: 0, aave: 0 })
  const total = sumBps(allocation)

  useEffect(() => {
    const target = Object.fromEntries(
      ADAPTER_IDS.map((id) => [id, Math.max(allocation[id] ?? 0, 0)]),
    ) as Record<AdapterId, number>

    const paint = () => {
      let offset = 0
      for (const id of ADAPTER_IDS) {
        const arc = arcRefs.current[id]
        const pct = values.current[id]
        const len = Math.max((pct / 100) * CIRC - GAP, 0)
        if (arc) {
          arc.style.strokeDasharray = `${len} ${CIRC - len}`
          arc.style.strokeDashoffset = `${-offset - GAP / 2}`
        }
        offset += (pct / 100) * CIRC
      }
    }

    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      values.current = target
      paint()
      return
    }
    const animation = animate(values.current, {
      ...target,
      duration: 600,
      ease: 'outQuint',
      onUpdate: paint,
    })
    return () => animation.pause()
  }, [allocation])

  // No position at all: the whole wheel goes gray — the shape holds the space, the color is
  // what a defined strategy earns.
  const isEmpty = total === 0

  return (
    <div className="relative mx-auto size-44" aria-hidden="true">
      <svg viewBox="0 0 200 200" className="strategy-ring-spin size-full">
        <circle
          cx="100"
          cy="100"
          r={R}
          fill="none"
          stroke={isEmpty ? 'var(--bg-elevated)' : 'var(--bg-surface)'}
          strokeWidth="13"
        />
        {!isEmpty &&
          ADAPTER_IDS.map((id) => (
            <circle
              key={id}
              ref={(el) => {
                arcRefs.current[id] = el
              }}
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={RING_COLOR[id]}
              strokeWidth="13"
              strokeDasharray={`0 ${CIRC}`}
              transform="rotate(-90 100 100)"
              style={{ filter: `drop-shadow(0 0 6px ${RING_COLOR[id]})`, opacity: 0.92 }}
            />
          ))}
      </svg>
      {!isEmpty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          {funded ? (
            <>
              <span
                className={cn(
                  'font-mono text-2xl font-semibold tabular-nums',
                  total === 100 ? 'text-[var(--text-primary)]' : 'text-[var(--warning)]',
                )}
              >
                {total}%
              </span>
              {/* Plain text, not .kicker — the sliders below already own this region's kicker. */}
              <span className="text-xs text-[var(--text-secondary)]">asignado</span>
            </>
          ) : (
            <>
              <span className="font-mono text-2xl font-semibold tabular-nums text-[var(--text-secondary)]">
                $0
              </span>
              <span className="text-xs text-[var(--text-secondary)]">sin fondos aún</span>
            </>
          )}
        </div>
      )}
    </div>
  )
}
