'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { AmountInput } from '@/components/vault-aggregator/amount-input'
import { DepositApproveStep } from '@/components/vault-aggregator/deposit-approve-step'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { formatUsdc } from '@/lib/format'
import { useVaultPosition } from '@/hooks/useVaultPosition'
import { useVaultWrite } from '@/hooks/useVaultWrite'

interface DepositViewProps {
  hasWeights: boolean
  isLemonRuntime: boolean
}

/** Gates on D-13/D-14 (bootstrap is two separate steps, weights-only-with-zero-shares is a
 * legitimate state), then walks the approve+deposit flow (D-09/D-11) through the shared
 * five-state machine, fed by `useVaultWrite().deposit`: a real approve+deposit, never a mock
 * selector. In browser the "Aprobando USDC" / "Depositando" copy makes the two signatures visible
 * while `deposit` is in flight; Lemon shows the batched-signature copy instead (D-11). */
export function DepositView({ hasWeights, isLemonRuntime }: DepositViewProps) {
  const [amount, setAmount] = useState(100_000_000n)
  const [phase, setPhase] = useState<TxPhase | null>(null)
  const { deposit, depositStep } = useVaultWrite()
  const { refetch } = useVaultPosition()

  if (!hasWeights) {
    return (
      <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
        <p className="text-sm text-[var(--text-secondary)]">
          Todavía no definiste en qué protocolos invertir.
        </p>
        <Button asChild className="min-h-[44px]">
          <Link href="/rebalancear">Definí tu estrategia</Link>
        </Button>
      </div>
    )
  }

  async function handleDeposit() {
    setPhase({ kind: 'signing' })
    const result = await deposit(amount)
    setPhase(result)
    if (result.kind === 'success') refetch()
  }

  const isBusy = phase?.kind === 'signing' || phase?.kind === 'pending'

  return (
    <div className="flex flex-col gap-6 py-4">
      <AmountInput value={amount} onChange={setAmount} />

      <DepositApproveStep isLemonRuntime={isLemonRuntime} amount={amount} />

      <Button
        type="button"
        size="lg"
        className="min-h-[44px]"
        disabled={isBusy}
        onClick={handleDeposit}
      >
        Depositar USDC
      </Button>

      {phase &&
        (phase.kind === 'signing' && !isLemonRuntime ? (
          <div className="flex flex-col items-center gap-4 p-4 text-center">
            <p className="text-sm text-[var(--text-secondary)]">
              {depositStep === 'approving' ? 'Aprobando USDC…' : 'Depositando…'}
            </p>
          </div>
        ) : (
          <TransactionState
            phase={phase}
            onPrimary={handleDeposit}
            onSecondary={() => setPhase(null)}
            summary={<>Depositás ${formatUsdc(amount)} USDC</>}
          />
        ))}
    </div>
  )
}
