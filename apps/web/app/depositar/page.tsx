'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AmountInput } from '@/components/vault-aggregator/amount-input'
import { DepositApproveStep } from '@/components/vault-aggregator/deposit-approve-step'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { formatUsdc } from '@/lib/format'
import { MOCK_WEIGHTS_ONLY } from '@/lib/mock/position'

const DEMO_PHASES: { key: string; phase: TxPhase }[] = [
  { key: 'confirm', phase: { kind: 'confirm' } },
  { key: 'signing', phase: { kind: 'signing' } },
  { key: 'pending', phase: { kind: 'pending' } },
  { key: 'success', phase: { kind: 'success' } },
  { key: 'rejected', phase: { kind: 'rejected' } },
  { key: 'reverted', phase: { kind: 'reverted', reason: 'slippage' } },
  { key: 'timeout', phase: { kind: 'timeout' } },
  { key: 'partial', phase: { kind: 'partial', requested: 100_000_000n, actual: 60_000_000n, remaining: 40_000_000n } },
]

interface DepositViewProps {
  hasWeights: boolean
  isLemonRuntime: boolean
}

/** Gates on D-13/D-14 (bootstrap is two separate steps, weights-only-with-zero-shares is a
 * legitimate state), then walks the approve+deposit flow (D-09/D-11) through the shared
 * five-state machine. The `phase` selector below is a 14a-only mock; plan 09 swaps it for the
 * real write-hook state without touching the gating or the approve wiring. */
export function DepositView({ hasWeights, isLemonRuntime }: DepositViewProps) {
  const [amount, setAmount] = useState(100_000_000n)
  const [approved, setApproved] = useState(false)
  const [phase, setPhase] = useState<TxPhase>({ kind: 'confirm' })

  if (!hasWeights) {
    return (
      <div className="flex flex-col items-center gap-3 p-6 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          Todavía no definiste en qué protocolos invertir.
        </p>
        <Button asChild className="min-h-[44px]">
          <Link href="/rebalancear">Definí tu estrategia</Link>
        </Button>
      </div>
    )
  }

  const canDeposit = isLemonRuntime || approved

  return (
    <div className="flex flex-col gap-6 p-4">
      <AmountInput value={amount} onChange={setAmount} />

      <DepositApproveStep
        isLemonRuntime={isLemonRuntime}
        amount={amount}
        approved={approved}
        onApprove={() => setApproved(true)}
      />

      <Button
        type="button"
        size="lg"
        className="min-h-[44px]"
        disabled={!canDeposit}
        onClick={() => setPhase({ kind: 'signing' })}
      >
        Depositar USDC
      </Button>

      <TransactionState
        phase={phase}
        onPrimary={() => setPhase({ kind: 'confirm' })}
        onSecondary={() => setPhase({ kind: 'pending' })}
        summary={<>Depositás ${formatUsdc(amount)} USDC</>}
      />

      {/* ponytail: 14a-only phase selector so every TxPhase is reachable for design QA without a
          live wallet; plan 09 removes it once `phase` comes from the real write hook. */}
      <div className="flex flex-wrap gap-1.5" aria-label="Selector de estado (solo desarrollo)">
        {DEMO_PHASES.map(({ key, phase: demoPhase }) => (
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

export default function DepositPage() {
  const [isLemonRuntime, setIsLemonRuntime] = useState(false)

  return (
    <main className="min-h-dvh bg-background">
      <DepositView hasWeights={MOCK_WEIGHTS_ONLY.hasWeights} isLemonRuntime={isLemonRuntime} />
      <div className="flex justify-center p-4">
        <button
          type="button"
          onClick={() => setIsLemonRuntime((current) => !current)}
          className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]"
        >
          runtime: {isLemonRuntime ? 'lemon' : 'browser'}
        </button>
      </div>
    </main>
  )
}
