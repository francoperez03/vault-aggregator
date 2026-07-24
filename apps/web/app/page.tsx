'use client'

import { useAccount } from 'wagmi'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PositionSummary } from '@/components/vault-aggregator/position-summary'
import { ProtocolBreakdown } from '@/components/vault-aggregator/protocol-breakdown'
import { PendingSettlementBanner } from '@/components/vault-aggregator/pending-settlement-banner'
import { WalletBar } from '@/components/wallet-bar'
import { ADAPTER_IDS, type AdapterId } from '@/lib/contracts/config'
import { useVaultPosition } from '@/hooks/useVaultPosition'
import { useNetworkGuard } from '@/hooks/useNetworkGuard'
import { useWithdrawFlow } from '@/hooks/useWithdrawFlow'

/** Same shape as the mock fixture module's PositionState (declared locally so this route no
 * longer imports that test-only fixture module). Plan 08 wires `/` to `useVaultPosition()`
 * instead, see `toPositionState` below. */
interface PositionState {
  perAdapter: Record<AdapterId, { shares: bigint; valueUsdc: bigint; weightBps: number; unavailable?: boolean }>
  totalUsdc: bigint
  hasWeights: boolean
  pendingWithdrawalUsdc?: bigint
}

interface HomePositionViewProps {
  position: PositionState
}

/** Composes the home route's three entry states (D-13/D-14/D-26). Plan 08 swaps the `position`
 * prop's source from a mock fixture to `useVaultPosition()` without touching this component. */
export function HomePositionView({ position }: HomePositionViewProps) {
  const weightedAdapterCount = ADAPTER_IDS.filter((id) => position.perAdapter[id].weightBps > 0).length
  const isFunded = position.totalUsdc > 0n

  return (
    <div className="px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      {position.pendingWithdrawalUsdc !== undefined && position.pendingWithdrawalUsdc > 0n && (
        <PendingSettlementBanner pendingAmount={position.pendingWithdrawalUsdc} />
      )}

      {isFunded ? (
        <>
          <PositionSummary totalUsdc={position.totalUsdc} />
          <Card className="mb-4 rounded-[14px] border-[var(--border-subtle)] px-4 py-4">
            <CardContent className="p-0">
              <ProtocolBreakdown position={position} />
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button asChild size="lg" className="min-h-[44px] flex-1">
              <Link href="/depositar">Depositar</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="min-h-[44px] flex-1">
              <Link href="/rebalancear">Rebalancear</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="min-h-[44px] flex-1">
              <Link href="/retirar">Retirar</Link>
            </Button>
          </div>
        </>
      ) : position.hasWeights ? (
        <Card className="rounded-[14px] border-[var(--border-subtle)] px-4 py-8 text-center">
          <CardContent className="flex flex-col items-center gap-3 p-0">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Estrategia guardada</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Tu asignación está definida en {weightedAdapterCount} protocolos. Depositá cuando quieras.
            </p>
            <Button asChild size="lg" className="mt-2 min-h-[44px]">
              <Link href="/depositar">Depositar ahora</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-[14px] border-dashed border-[var(--border-subtle)] px-4 py-8 text-center">
          <CardContent className="flex flex-col items-center gap-3 p-0">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Todavía no tenés posición</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Definí tu estrategia y hacé tu primer depósito: se reparte solo entre los protocolos que elijas.
            </p>
            <Button asChild size="lg" className="mt-2 min-h-[44px]">
              <Link href="/rebalancear">Definí tu estrategia</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

/** Composes a `useVaultPosition()` read into `HomePositionView`'s prop shape. Unconfigured
 * adapters (missing env var) render as an empty zero entry, same as an adapter with no position. */
function toPositionState(
  vaultPosition: ReturnType<typeof useVaultPosition>,
  pendingWithdrawalUsdc: bigint | null,
): PositionState {
  const perAdapter = {} as PositionState['perAdapter']
  for (const id of ADAPTER_IDS) {
    const adapter = vaultPosition.perAdapter[id]
    perAdapter[id] = adapter
      ? { shares: adapter.shares, valueUsdc: adapter.valueUsdc, weightBps: adapter.weightBps, unavailable: adapter.unavailable }
      : { shares: 0n, valueUsdc: 0n, weightBps: 0 }
  }
  return {
    perAdapter,
    totalUsdc: vaultPosition.totalUsdc,
    hasWeights: vaultPosition.hasWeights,
    pendingWithdrawalUsdc: pendingWithdrawalUsdc ?? undefined,
  }
}

export default function Page() {
  const { isConnected } = useAccount()
  const { isWrongNetwork, expectedName, switchNetwork } = useNetworkGuard()
  const vaultPosition = useVaultPosition()
  // D-19: the banner (plan 03/08) is only real once step 1 of a withdrawal actually measured and
  // persisted an amount, which is what useWithdrawFlow reads back from localStorage on mount.
  const { pendingAmount } = useWithdrawFlow()

  return (
    <main className="min-h-dvh bg-background">
      <WalletBar />
      {!isConnected ? (
        <div className="px-4 pt-8">
          <Card className="rounded-[14px] border-dashed border-[var(--border-subtle)] px-4 py-8 text-center">
            <CardContent className="flex flex-col items-center gap-3 p-0">
              <h1 className="text-xl font-semibold text-[var(--text-primary)]">Conectá tu wallet</h1>
              <p className="text-sm text-[var(--text-secondary)]">
                Necesitás conectar tu wallet para ver tu posición.
              </p>
            </CardContent>
          </Card>
        </div>
      ) : isWrongNetwork ? (
        <div className="px-4 pt-8">
          <Card className="rounded-[14px] border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-8 text-center">
            <CardContent className="flex flex-col items-center gap-3 p-0">
              <p className="text-sm text-[var(--text-primary)]">Cambiá a Arbitrum {expectedName} para continuar.</p>
              <Button type="button" size="lg" className="min-h-[44px]" onClick={switchNetwork}>
                Cambiar de red
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        <HomePositionView position={toPositionState(vaultPosition, pendingAmount)} />
      )}
    </main>
  )
}
