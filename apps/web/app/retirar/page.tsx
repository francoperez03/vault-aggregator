'use client'

import { Suspense, useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { formatUsdc } from '@/lib/format'
import { useVaultPosition } from '@/hooks/useVaultPosition'
import { useWithdrawFlow } from '@/hooks/useWithdrawFlow'

const PRESETS: { label: string; bps: bigint }[] = [
  { label: '25%', bps: 2500n },
  { label: '50%', bps: 5000n },
  { label: '75%', bps: 7500n },
  { label: 'MAX', bps: 10000n }, // literal 10000n, never a floor'd computation that could land on 9999n.
]

interface WithdrawViewProps {
  totalUsdc: bigint
  step: 1 | 2
  pendingAmount: bigint | null
  phase: TxPhase
  onRedeem: (bps: bigint) => void
  onSettle: () => void
  onAcknowledge: () => void
}

/** `/retirar` in two deep-linkeable steps (`?paso=2`, D-29). Step 1 fires the real on-chain
 * `redeem(uint256 bps)` and is atomic: no `partial` state exists there (Pitfall 4). Step 2 fires
 * the real `getLemonBridge().withdraw` with the amount step 1 actually measured, never the amount
 * requested (D-19), and is the only step where the Lemon SDK's partial reconciliation applies. */
export function WithdrawView({
  totalUsdc,
  step,
  pendingAmount,
  phase,
  onRedeem,
  onSettle,
  onAcknowledge,
}: WithdrawViewProps) {
  const [requestedBps, setRequestedBps] = useState<bigint>(0n)

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
  const settledAmount = pendingAmount ?? 0n

  function handlePrimary() {
    if (phase.kind === 'partial') {
      onAcknowledge()
      return
    }
    if (step === 1) onRedeem(requestedBps)
    else onSettle()
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
          onClick={() => onRedeem(requestedBps)}
        >
          Retirar al saldo de la app
        </Button>

        {phase.kind !== 'confirm' && (
          <TransactionState
            phase={phase}
            onPrimary={handlePrimary}
            summary={<>Retirás ${formatUsdc(requestedAmount)} USDC al saldo de la app</>}
          />
        )}
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

      <Button type="button" size="lg" className="min-h-[44px]" onClick={onSettle}>
        Enviar a Lemon
      </Button>

      {phase.kind === 'reverted' ? (
        // Lemon's own failure copy, distinct from the generic tx-reverted state (never the
        // same words as an on-chain revert): the money never left the chain, it is still sitting
        // right here in the mini-app balance, waiting for another attempt at step 2 only.
        <div className="flex flex-col gap-4 p-4">
          <p className="text-sm text-[var(--error)]">
            Lemon no pudo completar este paso. Tus fondos on-chain están seguros en el saldo de la app.
          </p>
          <Button type="button" onClick={onSettle}>
            Reintentar envío
          </Button>
        </div>
      ) : (
        phase.kind !== 'confirm' && (
          <TransactionState
            phase={phase}
            onPrimary={handlePrimary}
            summary={<>Enviás ${formatUsdc(settledAmount)} USDC a Lemon</>}
          />
        )
      )}
    </div>
  )
}

function RetirarPageInner() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlStep = searchParams.get('paso') === '2' ? 2 : 1

  const { totalUsdc } = useVaultPosition()
  const { step: flowStep, pendingAmount, phase, redeem, settleToLemon, acknowledge } = useWithdrawFlow()
  // The flow itself is the source of truth once it has measured a pending amount (a refresh with
  // no `?paso=2` in the URL should still land on step 2, not silently drop the pending settlement).
  const step = pendingAmount !== null ? 2 : urlStep

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (step === 2) params.set('paso', '2')
    else params.delete('paso')
    const query = params.toString()
    const target = query ? `${pathname}?${query}` : pathname
    if (`${pathname}${window.location.search}` !== target) router.replace(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function handleRedeem(bps: bigint) {
    await redeem(bps)
  }

  return (
    <main className="min-h-dvh bg-background">
      <WithdrawView
        totalUsdc={totalUsdc}
        step={step}
        pendingAmount={pendingAmount}
        phase={phase}
        onRedeem={handleRedeem}
        onSettle={settleToLemon}
        onAcknowledge={acknowledge}
      />
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
