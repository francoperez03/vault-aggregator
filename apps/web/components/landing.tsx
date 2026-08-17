'use client'

import { useEffect, useRef } from 'react'
import { animate } from 'animejs'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useConnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import { hasWalletConnect } from '@/lib/wagmi/config'

/** The Vaulty wordmark: display type plus the rounded brand-cyan mark. Text-based on purpose —
 * the mark is the same cut corner every surface in the app carries. */
export function VaultyWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={compact ? 'size-3 rounded-[3px] bg-[var(--brand)]' : 'size-4 rounded-[4px] bg-[var(--brand)]'}
        style={{ boxShadow: '0 0 12px var(--brand-glow, rgba(18,170,255,0.35))' }}
      />
      <span
        className={`font-display font-semibold uppercase text-[var(--text-primary)] ${
          compact ? 'text-sm tracking-[0.14em]' : 'text-base tracking-[0.16em]'
        }`}
      >
        Vaulty
      </span>
    </span>
  )
}

/** Landing CTA: same two connect paths as WalletBar, at hero size. */
function ConnectCta() {
  if (hasWalletConnect) {
    return (
      <ConnectButton.Custom>
        {({ openConnectModal, mounted }) =>
          mounted ? (
            <Button type="button" size="lg" className="w-full" onClick={openConnectModal}>
              Conectar wallet
            </Button>
          ) : null
        }
      </ConnectButton.Custom>
    )
  }
  return <InjectedCta />
}

function InjectedCta() {
  const { connect, connectors, isPending } = useConnect()
  const injected = connectors[0]
  if (!injected) return null
  return (
    <Button type="button" size="lg" className="w-full" disabled={isPending} onClick={() => connect({ connector: injected })}>
      {isPending ? 'Conectando…' : 'Conectar wallet'}
    </Button>
  )
}

const PROTOCOLS = [
  { name: 'Aave', color: 'var(--aave)' },
  { name: 'Morpho', color: 'var(--morpho)' },
  { name: 'Fluid', color: 'var(--fluid)' },
  { name: 'Euler', color: 'var(--euler)' },
] as const

/** Strategies the hero cycles through — the product's whole pitch is that this split is yours
 * to change, so the cover shows it changing. Each row sums 100. */
const STRATEGIES: ReadonlyArray<readonly [number, number, number, number]> = [
  [40, 30, 20, 10],
  [10, 25, 40, 25],
  [25, 25, 25, 25],
  [55, 15, 10, 20],
]

const CYCLE_MS = 3200
const TWEEN_MS = 1100

/** The mechanism as the living hero: one bar, four protocols, weights rebalancing on their own.
 * anime.js tweens a plain values object and paints widths + mono labels on every frame. */
function LiveSplit() {
  const segRefs = useRef<Array<HTMLSpanElement | null>>([])
  const labelRefs = useRef<Array<HTMLSpanElement | null>>([])

  useEffect(() => {
    if (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return

    const values = { a: 40, b: 30, c: 20, d: 10 }
    const keys = ['a', 'b', 'c', 'd'] as const
    let step = 0
    let cancelled = false

    const paint = () => {
      keys.forEach((k, i) => {
        const seg = segRefs.current[i]
        const label = labelRefs.current[i]
        const pct = values[k]
        if (seg) seg.style.width = `${pct}%`
        if (label) {
          label.style.width = `${pct}%`
          label.textContent = `${Math.round(pct)}%`
        }
      })
    }

    const tick = () => {
      if (cancelled) return
      step = (step + 1) % STRATEGIES.length
      const [a, b, c, d] = STRATEGIES[step]
      animate(values, {
        a,
        b,
        c,
        d,
        duration: TWEEN_MS,
        ease: 'outQuint',
        onUpdate: paint,
      })
    }

    const interval = window.setInterval(tick, CYCLE_MS)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [])

  return (
    <div aria-hidden="true">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-[var(--bg-surface)]">
        {PROTOCOLS.map((p, i) => (
          <span
            key={p.name}
            ref={(el) => {
              segRefs.current[i] = el
            }}
            className="h-full"
            style={{ width: `${STRATEGIES[0][i]}%`, background: p.color }}
          />
        ))}
      </div>
      <div className="mt-2 flex w-full font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
        {PROTOCOLS.map((p, i) => (
          <span
            key={p.name}
            ref={(el) => {
              labelRefs.current[i] = el
            }}
            className="overflow-hidden whitespace-nowrap"
            style={{ width: `${STRATEGIES[0][i]}%` }}
          >
            {STRATEGIES[0][i]}%
          </span>
        ))}
      </div>
    </div>
  )
}

const STEPS = [
  { title: 'Definí tu estrategia', body: 'Protocolos y porcentajes, a tu criterio.' },
  { title: 'Depositá una vez', body: 'Una transacción reparte tu USDC.' },
  { title: 'Salí cuando quieras', body: 'Rebalanceá o retirá todo, sin permiso.' },
] as const

/** Unconnected web home: the pitch. Inside Lemon this never renders — the wallet is automatic
 * and the app opens straight into the money flows. */
export function Landing() {
  return (
    <div className="landing flex min-h-dvh flex-col px-5 pb-10 pt-[calc(1.25rem+env(safe-area-inset-top))]">
      <header className="landing-rise">
        <VaultyWordmark />
      </header>

      <section className="mt-16 flex flex-col gap-5">
        <h1
          className="landing-rise max-w-[16ch] font-display text-[clamp(2rem,9vw,3rem)] font-bold leading-[1.08] text-[var(--text-primary)] [text-wrap:balance]"
          style={{ animationDelay: '80ms', letterSpacing: '-0.02em' }}
        >
          Tu plata, rindiendo donde vos digas.
        </h1>

        <div className="landing-rise mt-1" style={{ animationDelay: '160ms' }}>
          <LiveSplit />
        </div>

        <ul className="landing-rise flex flex-wrap items-center gap-x-5 gap-y-2" style={{ animationDelay: '220ms' }}>
          {PROTOCOLS.map((p) => (
            <li key={p.name} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <span className="size-2 rounded-full" style={{ background: p.color }} aria-hidden="true" />
              {p.name}
            </li>
          ))}
        </ul>

        <div className="landing-rise mt-4" style={{ animationDelay: '280ms' }}>
          <ConnectCta />
        </div>
      </section>

      {/* A real sequence — the numbers carry order, they are not section decoration. */}
      <section className="mt-14">
        <ol className="flex flex-col">
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative flex gap-4 pb-7 last:pb-0">
              {i < STEPS.length - 1 && (
                <span aria-hidden="true" className="absolute left-[13px] top-8 h-[calc(100%-2rem)] w-px bg-[var(--border-subtle,#1E242E)]" />
              )}
              <span className="rounded-[8px] mt-0.5 flex size-7 shrink-0 items-center justify-center border border-[var(--border-default,#2A313C)] font-mono text-xs text-[var(--brand)]">
                {i + 1}
              </span>
              <div className="flex flex-col gap-0.5">
                <h2 className="text-[15px] font-semibold text-[var(--text-primary)]">{step.title}</h2>
                <p className="max-w-[46ch] text-sm leading-relaxed text-[var(--text-secondary)]">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mt-auto pt-14">
        <p className="text-center font-mono text-[11px] text-[var(--text-secondary)]/70">
          Contratos verificables en Arbitrum One
        </p>
      </footer>
    </div>
  )
}
