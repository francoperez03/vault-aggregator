'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { formatUsdc } from '@/lib/format'
import { MOCK_FUNDED } from '@/lib/mock/position'

const PRESETS: { label: string; bps: bigint }[] = [
  { label: '25%', bps: 2500n },
  { label: '50%', bps: 5000n },
  { label: '75%', bps: 7500n },
  { label: 'MAX', bps: 10000n }, // literal 10000n, never a floor'd computation that could land on 9999n.
]

const STEP1_PHASES: { key: string; phase: TxPhase }[] = [
  { key: 'signing', phase: { kind: 'signing' } },
  { key: 'pending', phase: { kind: 'pending' } },
  { key: 'success', phase: { kind: 'success', amount: 1_000_000_000n } },
  { key: 'rejected', phase: { kind: 'rejected' } },
  { key: 'reverted', phase: { kind: 'reverted', reason: 'slippage' } },
]

// D-19/Pitfall 4: `partial` only exists for the SDK-driven withdraw of step 2, never for step 1's
// on-chain `redeem`, which is atomic.
const STEP2_PHASES: { key: string; phase: TxPhase }[] = [
  { key: 'signing', phase: { kind: 'signing' } },
  { key: 'pending', phase: { kind: 'pending' } },
  { key: 'success', phase: { kind: 'success' } },
  { key: 'rejected', phase: { kind: 'rejected' } },
  { key: 'timeout', phase: { kind: 'timeout' } },
  { key: 'partial', phase: { kind: 'partial', requested: 1_000_000_000n, actual: 600_000_000n, remaining: 400_000_000n } },
]

interface WithdrawViewProps {
  totalUsdc: bigint
  step: 1 | 2
  onStepChange: (step: 1 | 2) => void
}

/** `/retirar` in two deep-linkeable steps (`?paso=2`, D-29). Step 1 converts a requested amount to
 * bps on-chain (`redeem(uint256 bps)`, not shares or a raw USDC amount) and is atomic: no partial
 * state exists there. Step 2 carries the amount the redeem tx actually measured, never the amount
 * requested (D-19), and is the only step where the Lemon SDK's partial reconciliation applies. */
export function WithdrawView({ totalUsdc, step, onStepChange }: WithdrawViewProps) {
  const [requestedBps, setRequestedBps] = useState<bigint>(0n)
  const [phase, setPhase] = useState<TxPhase>({ kind: 'confirm' })
  const [settledAmount, setSettledAmount] = useState<bigint>(0n)

  // T-14-04-04 (threat model, accepted): the block on step 2 is advisory, not a trap. Tab close or
  // refresh gets a native confirmation; the persistent banner on `/` covers in-app navigation away.
  useEffect(() => {
    if (step !== 2) return
    const handler = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [step])

  const requestedAmount = (totalUsdc * requestedBps) / 10000n

  function handleStep1Demo(demoPhase: TxPhase) {
    setPhase(demoPhase)
    if (demoPhase.kind === 'success') {
      // D-19: measured, not pre-computed. Step 2 reads what the tx result carried.
      setSettledAmount(demoPhase.amount ?? requestedAmount)
      onStepChange(2)
      setPhase({ kind: 'confirm' })
    }
  }

  if (step === 1) {
    return (
      <div className="flex flex-col gap-6 p-4">
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map(({ label, bps }) => (
            <button
              key={label}
              type="button"
              onClick={() => setRequestedBps(bps)}
              className="min-h-[44px] rounded-lg border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 text-xs font-semibold text-[var(--text-secondary)]"
            >
              {label}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3">
          <span className="font-mono text-2xl font-semibold tabular-nums text-[var(--text-primary)]">
            ${formatUsdc(requestedAmount)}
          </span>
          <span className="text-xs text-[var(--text-secondary)]">de ${formatUsdc(totalUsdc)}</span>
        </div>

        <Button
          type="button"
          size="lg"
          className="min-h-[44px]"
          disabled={requestedBps === 0n}
          onClick={() => setPhase({ kind: 'signing' })}
        >
          Retirar al saldo de la app
        </Button>

        {phase.kind !== 'confirm' && (
          <TransactionState
            phase={phase}
            onPrimary={() => setPhase({ kind: 'confirm' })}
            onSecondary={() => setPhase({ kind: 'pending' })}
            summary={<>Retirás ${formatUsdc(requestedAmount)} USDC al saldo de la app</>}
          />
        )}

        {/* ponytail: 14a-only phase selector, same pattern as /depositar and /rebalancear. */}
        <div className="flex flex-wrap gap-1.5" aria-label="Selector de estado (solo desarrollo)">
          {STEP1_PHASES.map(({ key, phase: demoPhase }) => (
            <button
              key={key}
              type="button"
              onClick={() => handleStep1Demo(demoPhase)}
              className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]"
            >
              {key}
            </button>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      <Card className="rounded-[14px] border-[var(--warning)]/40 bg-[var(--warning)]/10">
        <CardContent className="p-4 text-sm text-[var(--text-primary)]">
          Moviste ${formatUsdc(settledAmount)} USDC al saldo de la app. Enviálo a Lemon para terminar.
        </CardContent>
      </Card>

      <Button type="button" size="lg" className="min-h-[44px]" onClick={() => setPhase({ kind: 'signing' })}>
        Enviar a Lemon
      </Button>

      {phase.kind !== 'confirm' && (
        <TransactionState
          phase={phase}
          onPrimary={() => setPhase({ kind: 'confirm' })}
          onSecondary={() => setPhase({ kind: 'pending' })}
          summary={<>Enviás ${formatUsdc(settledAmount)} USDC a Lemon</>}
        />
      )}

      <div className="flex flex-wrap gap-1.5" aria-label="Selector de estado (solo desarrollo)">
        {STEP2_PHASES.map(({ key, phase: demoPhase }) => (
          <button
            key={key}
            type="button"
            onClick={() => setPhase(demoPhase)}
            className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]"
          >
            {key}
          </button>
        ))}
      </div>
    </div>
  )
}

function RetirarPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const step = searchParams.get('paso') === '2' ? 2 : 1

  function setStep(next: 1 | 2) {
    const params = new URLSearchParams(searchParams.toString())
    if (next === 2) params.set('paso', '2')
    else params.delete('paso')
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  return (
    <main className="min-h-dvh bg-background">
      <WithdrawView totalUsdc={MOCK_FUNDED.totalUsdc} step={step} onStepChange={setStep} />
    </main>
  )
}

export default function RetirarPage() {
  return (
    <Suspense fallback={null}>
      <RetirarPageInner />
    </Suspense>
  )
}
