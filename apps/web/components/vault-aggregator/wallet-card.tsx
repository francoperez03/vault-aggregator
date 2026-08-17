'use client'

import { useState } from 'react'
import { ArrowDownLeft, ArrowUpRight } from 'lucide-react'
import { isAddress } from 'viem'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AmountInput } from '@/components/vault-aggregator/amount-input'
import { FundHint } from '@/components/vault-aggregator/fund-hint'
import { TransactionState } from '@/components/vault-aggregator/transaction-state'
import { TxButton, toButtonStage } from '@/components/vault-aggregator/tx-button'
import { formatUsdc } from '@/lib/format'
import { useUsdcTransfer } from '@/hooks/useUsdcTransfer'

interface WalletCardProps {
  /** Ceiling for sending, and the balance shown. */
  walletUsdc: bigint
  /** The connected wallet: what "Recibir" hands out. */
  address: `0x${string}`
  /** After a successful send, so the balance above refetches. */
  onDone: () => void
}

type Direction = 'in' | 'out'

/** Radix Tabs needs a value; this one matches no trigger, so the block opens collapsed. */
const NONE = 'none'

const TAB_TRIGGER =
  'h-9 flex-1 gap-1.5 rounded-[8px] px-3 text-sm font-semibold text-[var(--text-secondary)] transition-colors data-[state=active]:bg-[var(--bg-elevated)] data-[state=active]:text-[var(--text-primary)] data-[state=active]:shadow-[0_1px_2px_rgba(0,0,0,0.3)] hover:text-[var(--text-primary)]'

function shortAddress(value: string): string {
  return `${value.slice(0, 6)}…${value.slice(-4)}`
}

/**
 * The web counterpart of the Lemon account block, in the same slot of the position card: the
 * money that is not in the pool yet, with the two ways it crosses the wallet boundary on the open
 * web. "Recibir" hands out this wallet's address; "Enviar" is a plain USDC transfer to any address
 * — the way out for someone who wants their money somewhere else, not only back in the pool.
 */
export function WalletCard({ walletUsdc, address, onDone }: WalletCardProps) {
  const [direction, setDirection] = useState<Direction | null>(null)
  const [to, setTo] = useState('')
  const [amount, setAmount] = useState(0n)
  const { phase, isBusy, send, reset } = useUsdcTransfer()

  const toValid = isAddress(to)
  const toInvalid = to.length > 0 && !toValid

  async function run() {
    if (!toValid) return
    const result = await send(to as `0x${string}`, amount)
    if (result.kind !== 'success') return
    setAmount(0n)
    setDirection(null)
    onDone()
  }

  return (
    <Tabs
      value={direction ?? NONE}
      onValueChange={(next) => {
        reset()
        setDirection(next === NONE ? null : (next as Direction))
      }}
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
            Recibir
          </TabsTrigger>
          <TabsTrigger value="out" className={TAB_TRIGGER} disabled={isBusy}>
            <ArrowUpRight className="size-4" aria-hidden="true" />
            Enviar
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="in" className="pt-1">
        <FundHint address={address} />
      </TabsContent>

      <TabsContent value="out" className="flex flex-col gap-3 pt-1">
        <div className="flex flex-col gap-1">
          <input
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            aria-label="Dirección de destino"
            aria-invalid={toInvalid || undefined}
            placeholder="0x… dirección de destino"
            value={to}
            onChange={(event) => setTo(event.target.value.trim())}
            className="min-h-[44px] w-full rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 font-mono text-sm text-[var(--text-primary)] outline-none placeholder:text-[var(--text-secondary)] focus:shadow-[0_0_12px_var(--action-glow)] aria-[invalid=true]:border-[var(--danger)]"
          />
          {toInvalid && <p className="text-xs text-[var(--danger)]">Dirección inválida.</p>}
        </div>
        <AmountInput value={amount} onChange={setAmount} />
        <TxButton
          label={amount === 0n ? 'Enviar' : `Enviar $${formatUsdc(amount)}`}
          stage={toButtonStage(phase ?? null, 'idle')}
          disabled={!toValid || amount === 0n || amount > walletUsdc}
          onClick={() => void run()}
        />
      </TabsContent>

      {phase && (phase.kind === 'reverted' || phase.kind === 'timeout') && (
        <TransactionState
          phase={phase}
          onPrimary={() => void run()}
          onSecondary={reset}
          summary={
            <>
              Enviás ${formatUsdc(amount)} USDC a {toValid ? shortAddress(to) : 'la dirección indicada'}
            </>
          }
        />
      )}
    </Tabs>
  )
}
