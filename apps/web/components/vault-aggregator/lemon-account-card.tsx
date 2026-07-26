'use client'

import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AmountInput } from '@/components/vault-aggregator/amount-input'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { formatUsdc } from '@/lib/format'
import { useLemonTransfer, type LemonDirection } from '@/hooks/useLemonTransfer'

interface LemonAccountCardProps {
  /** Ceiling for the outbound direction. The inbound one has no ceiling we can know: the SDK
   * exposes no read of the Lemon account balance. */
  walletUsdc: bigint
  /** Set when a withdrawal has landed in the wallet and has not been sent to Lemon yet. */
  pendingAmount: bigint | null
  onSettle: () => void
  settlePhase: TxPhase
  onDone: () => void
}

/**
 * Step 1 of two: moving USDC between the user's Lemon account and this mini-app's wallet. A
 * different boundary from the pool below — the SDK crosses this one, the chain crosses that one —
 * which is why it is its own card and not another position on the slider.
 *
 * Deliberately not chained into the pool deposit. `deposit()` can return PENDING with the funds
 * still in flight, so auto-firing an on-chain deposit behind it would revert against a wallet that
 * is about to be funded. Two visible steps beat one that fails for reasons the user cannot see.
 */
export function LemonAccountCard({
  walletUsdc,
  pendingAmount,
  onSettle,
  settlePhase,
  onDone,
}: LemonAccountCardProps) {
  const [direction, setDirection] = useState<LemonDirection | null>(null)
  const [amount, setAmount] = useState(0n)
  const { phase, isBusy, bringFromLemon, sendToLemon, reset } = useLemonTransfer()

  if (pendingAmount !== null) {
    return (
      <Card className="rounded-[14px] border-[var(--warning)]/40 bg-[var(--warning)]/10">
        <CardContent className="flex flex-col gap-3 p-4">
          <p className="text-sm text-[var(--text-primary)]">
            Tenés ${formatUsdc(pendingAmount)} USDC en la wallet de la mini-app. Enviálos a tu cuenta
            de Lemon para terminar.
          </p>
          <Button type="button" size="lg" className="min-h-[44px]" onClick={onSettle}>
            Enviar ${formatUsdc(pendingAmount)} a Lemon
          </Button>
          {settlePhase.kind !== 'confirm' && (
            <TransactionState
              phase={settlePhase}
              onPrimary={onSettle}
              summary={<>Enviás ${formatUsdc(pendingAmount)} USDC a Lemon</>}
            />
          )}
        </CardContent>
      </Card>
    )
  }

  async function run(dir: LemonDirection) {
    const result = dir === 'in' ? await bringFromLemon(amount) : await sendToLemon(amount)
    if (result.kind === 'success') {
      setDirection(null)
      onDone()
    }
  }

  return (
    <Card className="rounded-[14px] border-[var(--border-subtle)]">
      <CardContent className="flex flex-col gap-3 p-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Paso 1 · Tu cuenta Lemon
        </span>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={direction === 'in' ? 'default' : 'outline'}
            className="min-h-[44px] flex-1"
            onClick={() => setDirection(direction === 'in' ? null : 'in')}
          >
            <ArrowDownLeft className="size-4" aria-hidden="true" />
            Traer
          </Button>
          <Button
            type="button"
            variant={direction === 'out' ? 'default' : 'outline'}
            className="min-h-[44px] flex-1"
            onClick={() => setDirection(direction === 'out' ? null : 'out')}
          >
            <ArrowUpRight className="size-4" aria-hidden="true" />
            Enviar
          </Button>
        </div>

        {direction !== null && (
          <>
            <AmountInput value={amount} onChange={setAmount} />
            <p className="text-xs text-[var(--text-secondary)]">
              {direction === 'in'
                ? 'De tu cuenta de Lemon a la wallet de la mini-app. Cuánto tenés en Lemon lo ves en su pantalla de confirmación: la mini-app no puede leer ese saldo.'
                : `De la wallet de la mini-app a tu cuenta de Lemon. Disponible: $${formatUsdc(walletUsdc)}.`}
            </p>
            <Button
              type="button"
              size="lg"
              className="min-h-[44px]"
              disabled={amount === 0n || (direction === 'out' && amount > walletUsdc) || isBusy}
              onClick={() => run(direction)}
            >
              {direction === 'in' ? 'Traer de Lemon' : 'Enviar a Lemon'}
            </Button>
          </>
        )}

        {phase && phase.kind !== 'confirm' && (
          <TransactionState
            phase={phase}
            onPrimary={() => direction && run(direction)}
            onSecondary={reset}
            summary={
              <>
                {direction === 'in' ? 'Traés' : 'Enviás'} ${formatUsdc(amount)} USDC
              </>
            }
          />
        )}
      </CardContent>
    </Card>
  )
}
