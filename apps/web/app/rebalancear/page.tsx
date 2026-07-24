'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { AllocationSliders } from '@/components/vault-aggregator/allocation-sliders'
import { RebalanceCostDisclosure } from '@/components/vault-aggregator/rebalance-cost-disclosure'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { normalizeToBps, sumBps, toContractWeights } from '@/lib/vault/weights'
import { ADAPTER_IDS, getAdapterAddresses, type AdapterId } from '@/lib/contracts/config'
import { useVaultPosition } from '@/hooks/useVaultPosition'

const DEMO_PHASES: { key: string; phase: TxPhase }[] = [
  { key: 'signing', phase: { kind: 'signing' } },
  { key: 'pending', phase: { kind: 'pending' } },
  { key: 'success', phase: { kind: 'success' } },
  { key: 'rejected', phase: { kind: 'rejected' } },
  // Pitfall 4: a throttled adapter reverts the rebalance tx outright. It is never the partial
  // state; partial only exists for deposit/withdraw's Lemon SDK calls.
  { key: 'reverted', phase: { kind: 'reverted', reason: 'un adapter frenó el retiro (throttle)' } },
]

interface RebalanceViewProps {
  /** D-13: with position cero the same route degenerates to writing weights, no cost to disclose. */
  isBootstrap: boolean
  initialAllocation: Partial<Record<AdapterId, number>>
  addresses: Partial<Record<AdapterId, `0x${string}`>>
}

/** `/rebalancear`: sliders that sum to 100% (D-16 omits 0%-weighted protocols), a mandatory cost
 * disclosure before signing a real rebalance (D-15), and the bootstrap degenerate case where the
 * route is really "definí tu estrategia" over a zero position (D-13/D-14). */
export function RebalanceView({ isBootstrap, initialAllocation, addresses }: RebalanceViewProps) {
  const [allocation, setAllocation] = useState(initialAllocation)
  const [showDisclosure, setShowDisclosure] = useState(false)
  const [phase, setPhase] = useState<TxPhase | null>(null)

  const isValid = sumBps(allocation) === 100

  function armAndSign() {
    // toContractWeights antes de armar la tx: convierte % -> bps -> (adapters[], bps[]) del ABI.
    try {
      toContractWeights(normalizeToBps(allocation), addresses)
    } catch {
      setPhase({ kind: 'reverted', reason: 'la estrategia quedó en cero protocolos' })
      return
    }
    setShowDisclosure(false)
    setPhase({ kind: 'signing' })
  }

  function handlePrimary() {
    if (isBootstrap) {
      armAndSign()
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
          onPrimary={() => setPhase({ kind: 'signing' })}
          onSecondary={() => setPhase(null)}
          summary={<>Estrategia con {sumBps(allocation)}% asignado</>}
        />
      )}

      {/* ponytail: 14a-only phase selector, same pattern as /depositar. */}
      <div className="flex flex-wrap gap-1.5" aria-label="Selector de estado (solo desarrollo)">
        {DEMO_PHASES.map(({ key, phase: demoPhase }) => (
          <button
            key={key}
            type="button"
            onClick={() => setPhase(demoPhase)}
            className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]"
          >
            {key}
          </button>
        ))}
      </div>
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
      <RebalanceView isBootstrap={isBootstrap} initialAllocation={initialAllocation} addresses={getAdapterAddresses()} />
    </main>
  )
}
