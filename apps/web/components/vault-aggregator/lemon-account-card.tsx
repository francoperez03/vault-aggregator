'use client'

import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AmountInput } from '@/components/vault-aggregator/amount-input'
import { TransactionState } from '@/components/vault-aggregator/transaction-state'
import { formatUsdc } from '@/lib/format'
import { useLemonTransfer, type LemonDirection } from '@/hooks/useLemonTransfer'

interface LemonAccountCardProps {
  /** Ceiling for the outbound direction. The inbound one has no ceiling we can know: the SDK
   * exposes no read of the Lemon account balance. */
  walletUsdc: bigint
  /** USDC a withdrawal left parked in the wallet. Used only to prefill the outbound amount — the
   * tank on this screen already shows the money, so it needs no banner shouting about it. */
  pendingAmount: bigint | null
  /** Called after a successful send, to forget a parked amount that has now left. */
  onSent: () => void
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
  onSent,
  onDone,
}: LemonAccountCardProps) {
  const [direction, setDirection] = useState<LemonDirection | null>(null)
  const [amount, setAmount] = useState(0n)
  const { phase, isBusy, bringFromLemon, sendToLemon, reset } = useLemonTransfer()

  // Parked money is the likeliest thing the user came to send, so it seeds the field — as a
  // default they can overwrite, never as a decision made for them.
  useEffect(() => {
    if (pendingAmount !== null) setAmount(pendingAmount)
  }, [pendingAmount])

  async function run(dir: LemonDirection) {
    const result = dir === 'in' ? await bringFromLemon(amount) : await sendToLemon(amount)
    if (result.kind !== 'success') return
    if (dir === 'out') onSent()
    setDirection(null)
    onDone()
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4">
        <span className="kicker">
          Paso 1 · Tu cuenta Lemon
        </span>

        <div className="flex gap-2">
          <Button
            type="button"
            variant={direction === 'in' ? 'default' : 'outline'}
            className="flex-1"
            onClick={() => setDirection(direction === 'in' ? null : 'in')}
          >
            <ArrowDownLeft className="size-4" aria-hidden="true" />
            Traer
          </Button>
          <Button
            type="button"
            variant={direction === 'out' ? 'default' : 'outline'}
            className="flex-1"
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
