'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { DepositApproveStep } from '@/components/vault-aggregator/deposit-approve-step'
import { LemonAccountCard } from '@/components/vault-aggregator/lemon-account-card'
import { MoveSlider } from '@/components/vault-aggregator/move-slider'
import { formatUsdc } from '@/lib/format'
import type { MovePreview } from '@/lib/vault/move'
import { useMoveQueue } from '@/lib/vault/move-queue'
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
 *
 * Confirmed moves go to the queue instead of being awaited here, so the screen never freezes
 * behind a wallet prompt; `MoveQueueStrip` reports each one from wherever the user ends up.
 */
export function MoveScreen({ isLemonRuntime }: MoveScreenProps) {
  const isLemon = isLemonRuntime ?? isLemonWebView()
  const { hasWeights, totalUsdc, refetch: refetchPosition } = useVaultPosition()
  const { balance, isConnected, refetch: refetchBalance } = useUsdcBalance()
  const { pendingAmount, phase: withdrawPhase, redeem, settleToLemon } = useWithdrawFlow()
  const { deposit } = useVaultWrite()
  const { enqueue } = useMoveQueue()

  function refetchAll() {
    refetchPosition()
    refetchBalance()
  }

  function handleMove(preview: MovePreview) {
    const verb = preview.kind === 'deposit' ? 'Depositar' : 'Retirar'
    enqueue(`${verb} $${formatUsdc(preview.amount)}`, async () => {
      const result =
        preview.kind === 'deposit'
          ? await deposit(preview.amount)
          : // Withdrawals go out as a fraction of the position, never an absolute amount; the
            // pending-settlement bookkeeping stays inside useWithdrawFlow.
            await redeem(preview.withdrawBps)
      refetchAll()
      return result
    })
  }

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
          <MoveSlider
            walletUsdc={balance}
            poolUsdc={totalUsdc}
            stepLabel={isLemon ? 'Paso 2 · Poner a rendir' : undefined}
            onMove={handleMove}
          />
          <DepositApproveStep isLemonRuntime={isLemon} amount={balance} />
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
