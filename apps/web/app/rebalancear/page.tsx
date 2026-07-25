'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AllocationSliders } from '@/components/vault-aggregator/allocation-sliders'
import { RebalanceCostDisclosure } from '@/components/vault-aggregator/rebalance-cost-disclosure'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { normalizeToBps, sumBps } from '@/lib/vault/weights'
import { ADAPTER_IDS, type AdapterId } from '@/lib/contracts/config'
import { useVaultPosition } from '@/hooks/useVaultPosition'
import { useVaultWrite } from '@/hooks/useVaultWrite'

interface RebalanceViewProps {
  /** D-13: with position cero the same route degenerates to writing weights, no cost to disclose. */
  isBootstrap: boolean
  initialAllocation: Partial<Record<AdapterId, number>>
}

/** `/rebalancear`: sliders that sum to 100% (D-16 omits 0%-weighted protocols), a mandatory cost
 * disclosure before signing a real rebalance (D-15), and the bootstrap degenerate case where the
 * route is really "definí tu estrategia" over a zero position (D-13/D-14). `useVaultWrite().rebalance`
 * drives the real write; a throttled adapter reverts the tx outright, never `partial` (Pitfall 4). */
export function RebalanceView({ isBootstrap, initialAllocation }: RebalanceViewProps) {
  const [allocation, setAllocation] = useState(initialAllocation)
  const [showDisclosure, setShowDisclosure] = useState(false)
  const [phase, setPhase] = useState<TxPhase | null>(null)
  const { rebalance } = useVaultWrite()
  const { refetch } = useVaultPosition()

  const isValid = sumBps(allocation) === 100

  async function armAndSign() {
    setShowDisclosure(false)
    setPhase({ kind: 'signing' })
    const result = await rebalance(normalizeToBps(allocation))
    setPhase(result)
    if (result.kind === 'success') refetch()
  }

  function handlePrimary() {
    if (isBootstrap) {
      void armAndSign()
      return
    }
    setShowDisclosure(true)
  }

  return (
    <div className="flex flex-col gap-6 p-4">
      {phase === null ? (
        <>
          <AllocationSliders value={allocation} onChange={setAllocation} />

          {showDisclosure ? (
            <RebalanceCostDisclosure onConfirm={armAndSign} />
          ) : (
            <Button type="button" size="lg" className="min-h-[44px]" disabled={!isValid} onClick={handlePrimary}>
              {isBootstrap ? 'Definí tu estrategia' : 'Confirmar rebalanceo'}
            </Button>
          )}
        </>
      ) : (
        <TransactionState
          phase={phase}
          onPrimary={() => void armAndSign()}
          onSecondary={() => setPhase(null)}
          summary={<>Estrategia con {sumBps(allocation)}% asignado</>}
        />
      )}
    </div>
  )
}

/** bps (0-10000) -> percent (0-100), rounded: AllocationSliders works in plain percentages
 * (`lib/vault/weights.ts`'s `normalizeToBps` converts back before arming the tx). */
function bpsToPercent(bps: number): number {
  return Math.round(bps / 100)
}

export default function RebalancePage() {
  const vaultPosition = useVaultPosition()
  // D-13: position cero degenerates this route into "definí tu estrategia" over a zero balance.
  const isBootstrap = vaultPosition.totalUsdc === 0n

  const initialAllocation: Partial<Record<AdapterId, number>> = {}
  for (const id of ADAPTER_IDS) {
    initialAllocation[id] = bpsToPercent(vaultPosition.perAdapter[id]?.weightBps ?? 0)
  }

  return (
    <main className="min-h-dvh bg-background">
      <RebalanceView isBootstrap={isBootstrap} initialAllocation={initialAllocation} />
    </main>
  )
}
