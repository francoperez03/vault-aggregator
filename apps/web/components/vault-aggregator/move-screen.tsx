'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DepositApproveStep } from '@/components/vault-aggregator/deposit-approve-step'
import { LemonAccountCard } from '@/components/vault-aggregator/lemon-account-card'
import { MoveSlider } from '@/components/vault-aggregator/move-slider'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { formatUsdc } from '@/lib/format'
import type { MovePreview } from '@/lib/vault/move'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { useVaultPosition } from '@/hooks/useVaultPosition'
import { useVaultWrite } from '@/hooks/useVaultWrite'
import { useWithdrawFlow } from '@/hooks/useWithdrawFlow'
import { isLemonWebView } from '@/lib/lemon/bridge'

interface MoveScreenProps {
  /** Test seam. Left undefined in the app, where the runtime decides. */
  isLemonRuntime?: boolean
}

/**
 * Everything that moves money, in the order the money moves: the Lemon account on top (only
 * reachable through the SDK, so only rendered inside Lemon), then the wallet and the pool with one
 * slider between them.
 *
 * The slider carries both directions because deposit and withdrawal are the same decision — how
 * much of my USDC should be earning — and two separate screens made the user do the subtraction.
 * Here both numbers move under the thumb and the button names what will happen.
 */
export function MoveScreen({ isLemonRuntime }: MoveScreenProps) {
  const isLemon = isLemonRuntime ?? isLemonWebView()
  const { hasWeights, totalUsdc, refetch: refetchPosition } = useVaultPosition()
  const { balance, isConnected, refetch: refetchBalance } = useUsdcBalance()
  const { pendingAmount, phase: withdrawPhase, redeem, settleToLemon } = useWithdrawFlow()
  const { deposit, depositStep } = useVaultWrite()
  const [depositPhase, setDepositPhase] = useState<TxPhase | null>(null)
  const [lastMove, setLastMove] = useState<MovePreview | null>(null)

  function refetchAll() {
    refetchPosition()
    refetchBalance()
  }

  async function handleMove(preview: MovePreview) {
    setLastMove(preview)
    if (preview.kind === 'deposit') {
      setDepositPhase({ kind: 'signing' })
      const result = await deposit(preview.amount)
      setDepositPhase(result)
      if (result.kind === 'success') refetchAll()
      return
    }
    if (preview.kind === 'withdraw') {
      // `redeem` owns its own phase (and the pending-settlement bookkeeping) inside useWithdrawFlow.
      setDepositPhase(null)
      await redeem(preview.withdrawBps)
      refetchAll()
    }
  }

  const isBusy = depositPhase?.kind === 'signing' || withdrawPhase.kind === 'signing'
  // Whichever flow is mid-air owns the status area; only one can be at a time.
  const phase = depositPhase ?? (withdrawPhase.kind !== 'confirm' ? withdrawPhase : null)

  if (!isConnected) return null

  return (
    <div className="flex flex-col gap-5 px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      {/* Hidden outside Lemon, where the SDK does not exist — except with money parked in the
          wallet mid-withdrawal, which always needs a visible way out. */}
      {(isLemon || pendingAmount !== null) && (
        <LemonAccountCard
          walletUsdc={balance}
          pendingAmount={pendingAmount}
          onSettle={settleToLemon}
          settlePhase={withdrawPhase}
          onDone={refetchAll}
        />
      )}

      {hasWeights ? (
        <>
          <MoveSlider walletUsdc={balance} poolUsdc={totalUsdc} busy={isBusy} onMove={handleMove} />

          {phase &&
            (phase.kind === 'signing' && !isLemon ? (
              <p className="text-center text-sm text-[var(--text-secondary)]">
                {depositStep === 'approving' ? 'Aprobando USDC…' : 'Confirmá en tu wallet…'}
              </p>
            ) : (
              <TransactionState
                phase={phase}
                onPrimary={() => lastMove && handleMove(lastMove)}
                onSecondary={() => setDepositPhase(null)}
                summary={
                  lastMove ? (
                    <>
                      {lastMove.kind === 'deposit' ? 'Depositás' : 'Retirás'} $
                      {formatUsdc(lastMove.amount)} USDC
                    </>
                  ) : null
                }
              />
            ))}

          {lastMove?.kind === 'deposit' && !isLemon && (
            <DepositApproveStep isLemonRuntime={false} amount={lastMove.amount} />
          )}
        </>
      ) : (
        <div className="flex flex-col items-center gap-3 py-6 text-center">
          <p className="text-sm text-[var(--text-secondary)]">
            Todavía no definiste en qué protocolos invertir.
          </p>
          <Button asChild className="min-h-[44px]">
            <Link href="/rebalancear">Definí tu estrategia</Link>
          </Button>
        </div>
      )}
    </div>
  )
}
