'use client'

import { DepositApproveStep } from '@/components/vault-aggregator/deposit-approve-step'
import { LemonAccountCard } from '@/components/vault-aggregator/lemon-account-card'
import { MoveSlider } from '@/components/vault-aggregator/move-slider'
import { formatUsdc } from '@/lib/format'
import type { MovePreview } from '@/lib/vault/move'
import { useMoveQueue } from '@/lib/vault/move-queue'
import { toButtonStage, type TxButtonStage } from '@/components/vault-aggregator/tx-button'
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
  const { pendingAmount, redeem, clearPending, txStage: withdrawTxStage } = useWithdrawFlow()
  const { deposit, txStage: depositTxStage } = useVaultWrite()
  const { enqueue, jobs } = useMoveQueue()

  // The slider CTA's lifecycle: while any queued job is unresolved the button is in flight
  // (confirming vs pending refined by whichever write hook is actually working); once the
  // latest job settles, its outcome plays the success/error beat and TxButton walks back.
  const txStage = depositTxStage !== 'idle' ? depositTxStage : withdrawTxStage
  const activeJob = jobs.find((j) => j.phase.kind === 'signing' || j.phase.kind === 'confirm')
  const lastJob = jobs.length > 0 ? jobs[jobs.length - 1] : undefined
  const sliderStage: TxButtonStage = activeJob
    ? txStage === 'pending'
      ? 'pending'
      : 'confirming'
    : toButtonStage(lastJob?.phase ?? null, txStage)

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
      {/* Hidden outside Lemon: the SDK is the only way across this boundary, so the buttons would
          be decoration anywhere else. Parked money still shows — it is sitting in the wallet tank. */}
      {isLemon && (
        <LemonAccountCard
          walletUsdc={balance}
          pendingAmount={pendingAmount}
          onSent={clearPending}
          onDone={refetchAll}
        />
      )}

      {/* Without weights this screen renders nothing extra: the "Definí tu estrategia"
          card below (HomePositionView) owns the empty state, so a second hint + CTA here was
          the same call to action twice on one screen. */}
      {hasWeights && (
        <>
          <MoveSlider
            walletUsdc={balance}
            poolUsdc={totalUsdc}
            stepLabel={isLemon ? 'Paso 2 · Poner a rendir' : undefined}
            stage={sliderStage}
            onMove={handleMove}
          />
          <DepositApproveStep isLemonRuntime={isLemon} amount={balance} />
        </>
      )}
    </div>
  )
}
