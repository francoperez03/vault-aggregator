'use client'

import { useEffect, useRef } from 'react'
import { animate, createTimeline, stagger } from 'animejs'
import { ADAPTER_IDS, type AdapterId } from '@/lib/contracts/config'

const RING_COLOR: Record<AdapterId, string> = {
  morpho: 'var(--morpho)',
  fluid: 'var(--fluid)',
  euler: 'var(--euler)',
  aave: 'var(--aave)',
}

const R = 74
const CIRC = 2 * Math.PI * R
/** Each of the four arcs at rest: a quarter minus a small gap. */
const ARC = CIRC / 4 - CIRC * 0.02

/**
 * The SIWE handshake state: the strategy ring's own body, before it has a strategy to show.
 * Four protocol arcs orbit slowly while each one swells and settles in turn — the app is awake
 * and waiting on Lemon, not stuck. Same anime.js language as StrategyRing so the ring that
 * appears after sign-in reads as this one settling, not as a new element.
 */
export function LemonHandshake() {
  const svgRef = useRef<SVGSVGElement>(null)
  const dotsRef = useRef<HTMLSpanElement>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    const reduced =
      typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) return

    const arcs = Array.from(svg.querySelectorAll<SVGCircleElement>('[data-arc]'))
    const orbit = animate(svg, { rotate: 360, duration: 6000, ease: 'linear', loop: true })
    // Breath: each arc grows a little brighter and longer, one after the other, forever.
    const breath = createTimeline({ loop: true, defaults: { ease: 'inOutSine' } }).add(
      arcs,
      {
        strokeDasharray: [`${ARC} ${CIRC - ARC}`, `${ARC * 1.18} ${CIRC - ARC * 1.18}`, `${ARC} ${CIRC - ARC}`],
        opacity: [0.55, 1, 0.55],
        duration: 1400,
      },
      stagger(350),
    )
    const dots = dotsRef.current
      ? animate(dotsRef.current.children, {
          opacity: [0.2, 1, 0.2],
          duration: 1200,
          delay: stagger(150),
          loop: true,
          ease: 'inOutSine',
        })
      : null
    return () => {
      orbit.pause()
      breath.pause()
      dots?.pause()
    }
  }, [])

  return (
    <div className="flex flex-col items-center gap-6" role="status" aria-live="polite">
      <div className="relative size-28" aria-hidden="true">
        <svg ref={svgRef} viewBox="0 0 200 200" className="size-full">
          <circle cx="100" cy="100" r={R} fill="none" stroke="var(--bg-surface)" strokeWidth="13" />
          {ADAPTER_IDS.map((id, i) => (
            <circle
              key={id}
              data-arc=""
              cx="100"
              cy="100"
              r={R}
              fill="none"
              stroke={RING_COLOR[id]}
              strokeWidth="13"
              strokeLinecap="round"
              strokeDasharray={`${ARC} ${CIRC - ARC}`}
              strokeDashoffset={-(i * CIRC) / 4}
              transform="rotate(-90 100 100)"
              style={{ filter: `drop-shadow(0 0 6px ${RING_COLOR[id]})`, opacity: 0.55 }}
            />
          ))}
        </svg>
      </div>
      <p className="text-center text-[15px] text-[var(--text-secondary)]">
        Conectando con tu cuenta de Lemon
        <span ref={dotsRef} className="inline-flex w-4 justify-start" aria-hidden="true">
          <span>.</span>
          <span>.</span>
          <span>.</span>
        </span>
      </p>
    </div>
  )
}
