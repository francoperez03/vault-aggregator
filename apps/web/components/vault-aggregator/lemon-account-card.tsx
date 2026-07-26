'use client'

import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { AmountInput } from '@/components/vault-aggregator/amount-input'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { formatUsdc } from '@/lib/format'
import { getLemonBridge, type LemonTxOutcome } from '@/lib/lemon/bridge'

type Direction = 'in' | 'out'

/** Lemon's own error codes, mapped to copy that says what the user can do about it. An
 * INSUFFICIENT_BALANCE on the way in is the one case we cannot pre-empt: the mini-app has no way to
 * read the Lemon account balance, so the amount is always sent blind and the rejection is the
 * first news we get. */
function outcomeToPhase(outcome: LemonTxOutcome, direction: Direction): TxPhase {
  if (outcome.result === 'SUCCESS') return { kind: 'success', amount: outcome.amount }
  if (outcome.result === 'PENDING') return { kind: 'timeout', txHash: outcome.txHash }
  if (outcome.result === 'CANCELLED') return { kind: 'rejected' }
  const insufficient = outcome.error.includes('INSUFFICIENT_BALANCE')
  return {
    kind: 'reverted',
    reason: insufficient
      ? direction === 'in'
        ? 'No te alcanza el saldo de tu cuenta Lemon para ese monto.'
        : 'No te alcanza el saldo de tu wallet para ese monto.'
      : outcome.error,
  }
}

interface LemonAccountCardProps {
  /** Wallet-side ceiling for the outbound direction. The inbound one has no ceiling we can know. */
  walletUsdc: bigint
  /** Set when a withdrawal has landed in the wallet and has not been sent to Lemon yet. */
  pendingAmount: bigint | null
  onSettle: () => void
  settlePhase: TxPhase
  onDone: () => void
}

/**
 * Moving USDC between the user's Lemon account and this mini-app's wallet — a different boundary
 * from the pool below, which is why it gets its own card instead of another slider position.
 *
 * Only rendered inside Lemon (the SDK is the only way across this boundary), with one exception:
 * a pending settlement always shows, everywhere, because money parked in the mini-app wallet with
 * no visible way out is how it gets forgotten.
 */
export function LemonAccountCard({
  walletUsdc,
  pendingAmount,
  onSettle,
  settlePhase,
  onDone,
}: LemonAccountCardProps) {
  const [direction, setDirection] = useState<Direction | null>(null)
  const [amount, setAmount] = useState(0n)
  const [phase, setPhase] = useState<TxPhase | null>(null)

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

  async function run(dir: Direction) {
    setPhase({ kind: 'signing' })
    const bridge = getLemonBridge()
    const outcome =
      dir === 'in'
        ? await bridge.deposit({ amount, tokenName: 'USDC' })
        : await bridge.withdraw({ amount, tokenName: 'USDC' })
    const settled = outcome.result === 'PENDING' ? await outcome.settle() : outcome
    const next = outcomeToPhase(settled, dir)
    setPhase(next)
    if (next.kind === 'success') {
      setDirection(null)
      onDone()
    }
  }

  return (
    <Card className="rounded-[14px] border-[var(--border-subtle)]">
      <CardContent className="flex flex-col gap-3 p-4">
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Tu cuenta Lemon
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
                ? 'Desde tu cuenta de Lemon a la wallet de la mini-app. Cuánto tenés en Lemon lo ves en su pantalla de confirmación: la mini-app no puede leer ese saldo.'
                : `Desde la wallet de la mini-app a tu cuenta de Lemon. Disponible: $${formatUsdc(walletUsdc)}.`}
            </p>
            <Button
              type="button"
              size="lg"
              className="min-h-[44px]"
              disabled={amount === 0n || (direction === 'out' && amount > walletUsdc) || phase?.kind === 'signing'}
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
            onSecondary={() => setPhase(null)}
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
