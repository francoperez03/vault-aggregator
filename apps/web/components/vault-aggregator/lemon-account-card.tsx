'use client'

import { useEffect, useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AmountInput } from '@/components/vault-aggregator/amount-input'
import { TransactionState } from '@/components/vault-aggregator/transaction-state'
import { TxButton, toButtonStage } from '@/components/vault-aggregator/tx-button'
import { formatUsdc } from '@/lib/format'
import { useLemonTransfer, type LemonDirection } from '@/hooks/useLemonTransfer'

interface LemonAccountProps {
  /** Ceiling for the outbound direction, and the balance shown. The inbound one has no ceiling
   * we can know: the SDK exposes no read of the Lemon account balance. */
  walletUsdc: bigint
  /** USDC a withdrawal left parked in the wallet. Used only to prefill the outbound amount — the
   * balance right here already shows the money, so it needs no banner shouting about it. */
  pendingAmount: bigint | null
  /** Called after a successful send, to forget a parked amount that has now left. */
  onSent: () => void
  onDone: () => void
}

/** Radix Tabs needs a value; this one matches no trigger, so the block opens collapsed. */
const NONE = 'none'

const TAB_TRIGGER =
  'h-9 flex-1 gap-1.5 rounded-[8px] px-3 text-sm font-semibold text-[var(--text-secondary)] transition-colors data-[state=active]:bg-[var(--bg-elevated)] data-[state=active]:text-[var(--text-primary)] data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.3)] hover:text-[var(--text-primary)]'

/**
 * Moving USDC between the user's Lemon account and this mini-app's wallet. A
 * different boundary from the pool below — the SDK crosses this one, the chain crosses that one —
 * which is why it sits in the position card's footer, present on both steps of the home: bringing
 * money in comes before having a strategy, and must not slide away with the allocation step.
 *
 * Deliberately not chained into the pool deposit. `deposit()` can return PENDING with the funds
 * still in flight, so auto-firing an on-chain deposit behind it would revert against a wallet that
 * is about to be funded. Two visible steps beat one that fails for reasons the user cannot see.
 */
export function LemonAccount({ walletUsdc, pendingAmount, onSent, onDone }: LemonAccountProps) {
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

  const panel = (dir: LemonDirection) => (
    <TabsContent value={dir} className="flex flex-col gap-3 pt-1">
      <AmountInput value={amount} onChange={setAmount} />
      <p className="text-xs text-[var(--text-secondary)]">
        {dir === 'in'
          ? 'De tu cuenta de Lemon a la wallet de la mini-app. Cuánto tenés en Lemon lo ves en su pantalla de confirmación: la mini-app no puede leer ese saldo.'
          : `De la wallet de la mini-app a tu cuenta de Lemon. Disponible: $${formatUsdc(walletUsdc)}.`}
      </p>
      <TxButton
        label={dir === 'in' ? 'Traer de Lemon' : 'Enviar a Lemon'}
        stage={toButtonStage(phase ?? null, 'idle')}
        disabled={amount === 0n || (dir === 'out' && amount > walletUsdc)}
        onClick={() => run(dir)}
      />
    </TabsContent>
  )

  return (
    <Tabs
      value={direction ?? NONE}
      onValueChange={(next) => setDirection(next === NONE ? null : (next as LemonDirection))}
      className="flex flex-col gap-3"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 flex-col">
          <span className="whitespace-nowrap text-xs text-[var(--text-secondary)]">Disponible</span>
          <span className="mt-0.5 font-mono text-xl font-semibold tabular-nums leading-none text-[var(--text-primary)]">
            ${formatUsdc(walletUsdc)}
          </span>
        </div>
        {/* Segmented control, 44px tall: two directions of one boundary, not two features. */}
        <TabsList className="h-11 shrink-0 gap-0.5 rounded-[10px] border border-[var(--border-default)] bg-[var(--bg-base)]/60 p-1">
          <TabsTrigger value="in" className={TAB_TRIGGER} disabled={isBusy}>
            <ArrowDownLeft className="size-4" aria-hidden="true" />
            Traer
          </TabsTrigger>
          <TabsTrigger value="out" className={TAB_TRIGGER} disabled={isBusy}>
            <ArrowUpRight className="size-4" aria-hidden="true" />
            Enviar
          </TabsTrigger>
        </TabsList>
      </div>

      {panel('in')}
      {panel('out')}

      {phase && (phase.kind === 'partial' || phase.kind === 'timeout') && (
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
    </Tabs>
  )
}
