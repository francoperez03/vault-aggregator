'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useConnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import { hasWalletConnect } from '@/lib/wagmi/config'

/** The Vaulty wordmark: display type plus the chamfered brand-cyan mark. Text-based on purpose —
 * the mark is the same cut corner every surface in the app carries. */
export function VaultyWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="flex items-center gap-2">
      <span
        aria-hidden="true"
        className={compact ? 'chamfer-sm size-3 bg-[var(--brand)]' : 'chamfer-sm size-4 bg-[var(--brand)]'}
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
  { name: 'Aave', dot: 'var(--aave)' },
  { name: 'Morpho', dot: 'var(--morpho)' },
  { name: 'Fluid', dot: 'var(--fluid)' },
  { name: 'Euler', dot: 'var(--euler)' },
] as const

/** The example split the whole product is about: one deposit, four protocols. The percentages
 * are illustrative (the app's suggested default), not live data. */
const SPLIT = [
  { pct: 40, color: 'var(--aave)' },
  { pct: 30, color: 'var(--morpho)' },
  { pct: 20, color: 'var(--fluid)' },
  { pct: 10, color: 'var(--euler)' },
] as const

const STEPS = [
  {
    title: 'Definí tu estrategia',
    body: 'Elegí en qué protocolos y con qué peso. Vos ponés los porcentajes; nada se mueve sin tu firma.',
  },
  {
    title: 'Depositá una vez',
    body: 'Una sola transacción reparte tu USDC entre los protocolos que elegiste, en la proporción exacta.',
  },
  {
    title: 'Mirá cómo rinde',
    body: 'Tu posición crece en tiempo real. Rebalanceá cuando cambies de idea o retirá todo cuando quieras.',
  },
] as const

/** Unconnected web home: the pitch. Inside Lemon this never renders — the wallet is automatic
 * and the app opens straight into the money flows. */
export function Landing() {
  return (
    <div className="landing flex min-h-dvh flex-col px-5 pb-10 pt-[calc(1.25rem+env(safe-area-inset-top))]">
      <header className="landing-rise">
        <VaultyWordmark />
      </header>

      <section className="mt-14 flex flex-col gap-5">
        <p className="kicker landing-rise" style={{ animationDelay: '60ms' }}>
          USDC · Arbitrum One
        </p>
        <h1
          className="landing-rise max-w-[16ch] font-display text-[clamp(2rem,9vw,3rem)] font-bold leading-[1.08] text-[var(--text-primary)] [text-wrap:balance]"
          style={{ animationDelay: '120ms', letterSpacing: '-0.02em' }}
        >
          Tu plata, rindiendo donde vos digas.
        </h1>
        <p className="landing-rise max-w-[42ch] text-[15px] leading-relaxed text-[var(--text-secondary)]" style={{ animationDelay: '180ms' }}>
          Vaulty reparte tu USDC entre cuatro protocolos de préstamo de Arbitrum, en la proporción
          que vos definas. Un depósito, una posición, salida total cuando quieras.
        </p>

        {/* The mechanism as the hero visual: one deposit becoming four weighted positions. */}
        <div className="landing-rise mt-2" style={{ animationDelay: '240ms' }} aria-hidden="true">
          <div className="chamfer-sm flex h-3 w-full overflow-hidden bg-[var(--bg-surface)]">
            {SPLIT.map((seg, i) => (
              <span
                key={seg.color}
                className="landing-seg h-full"
                style={{ width: `${seg.pct}%`, background: seg.color, animationDelay: `${420 + i * 90}ms` }}
              />
            ))}
          </div>
          <div className="mt-2 flex w-full font-mono text-[11px] tabular-nums text-[var(--text-secondary)]">
            {SPLIT.map((seg) => (
              <span key={seg.color} style={{ width: `${seg.pct}%` }}>
                {seg.pct}%
              </span>
            ))}
          </div>
        </div>

        <div className="landing-rise mt-3 flex flex-col gap-3" style={{ animationDelay: '300ms' }}>
          <ConnectCta />
          <p className="text-center text-xs text-[var(--text-secondary)]">
            Sin custodia · tu posición vive on-chain
          </p>
        </div>
      </section>

      <section className="mt-12">
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {PROTOCOLS.map((p) => (
            <li key={p.name} className="flex items-center gap-2 text-sm text-[var(--text-secondary)]">
              <span className="size-2 rounded-full" style={{ background: p.dot }} aria-hidden="true" />
              {p.name}
            </li>
          ))}
          <li className="font-mono text-[11px] text-[var(--text-secondary)]/70">
            vaults ERC-4626 verificados
          </li>
        </ul>
      </section>

      {/* A real sequence — the numbers carry order, they are not section decoration. */}
      <section className="mt-12">
        <ol className="flex flex-col">
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative flex gap-4 pb-8 last:pb-0">
              {i < STEPS.length - 1 && (
                <span aria-hidden="true" className="absolute left-[13px] top-8 h-[calc(100%-2rem)] w-px bg-[var(--border-subtle,#1E242E)]" />
              )}
              <span className="chamfer-sm mt-0.5 flex size-7 shrink-0 items-center justify-center border border-[var(--border-default,#2A313C)] font-mono text-xs text-[var(--brand)]">
                {i + 1}
              </span>
              <div className="flex flex-col gap-1">
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
