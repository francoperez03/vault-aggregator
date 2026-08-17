'use client'

import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { AllocationSliders } from '@/components/vault-aggregator/allocation-sliders'
import { StrategyRing } from '@/components/vault-aggregator/strategy-ring'
import { RebalanceCostDisclosure } from '@/components/vault-aggregator/rebalance-cost-disclosure'
import { TxButton, toButtonStage } from '@/components/vault-aggregator/tx-button'
import { TransactionState, type TxPhase } from '@/components/vault-aggregator/transaction-state'
import { normalizeToBps, sumBps } from '@/lib/vault/weights'
import { type AdapterId } from '@/lib/contracts/config'
import { useVaultPosition } from '@/hooks/useVaultPosition'
import { useVaultWrite } from '@/hooks/useVaultWrite'

/** How long the "Listo" note stays before the screen goes back to being just the sliders. */
const CONFIRMED_MS = 4000

interface RebalanceViewProps {
  /** D-13: with position cero the same route degenerates to writing weights, no cost to disclose. */
  isBootstrap: boolean
  initialAllocation: Partial<Record<AdapterId, number>>
  /** Mirrors every allocation change (user drags AND chain re-seeds) to a parent that renders
   * the ring itself — the home stepper's single persistent circle. */
  onAllocationChange?: (next: Partial<Record<AdapterId, number>>) => void
  /** True when a parent already owns the StrategyRing (home); the standalone route keeps its own. */
  hideRing?: boolean
}

/**
 * The allocation step: sliders that always sum to 100 (D-16 omits 0%-weighted protocols), a
 * mandatory cost disclosure before signing a real rebalance (D-15), and the bootstrap case where
 * this is really "definí tu estrategia" over a zero position (D-13/D-14).
 *
 * The sliders never leave the screen. A success used to replace them with a confirmation panel,
 * which left the user looking at a dead end: to rebalance again they had to navigate out and back.
 * Now the confirmation is a transient note over the same controls, and the sliders re-seed
 * themselves from the chain as soon as the refetch lands — so a second adjustment starts from what
 * the vault actually holds, not from what was on screen before the transaction.
 */
export function RebalanceView({
  isBootstrap,
  initialAllocation,
  onAllocationChange,
  hideRing = false,
}: RebalanceViewProps) {
  const [allocation, setAllocationState] = useState(initialAllocation)
  const setAllocation = (next: Partial<Record<AdapterId, number>>) => {
    setAllocationState(next)
    onAllocationChange?.(next)
  }
  const [showDisclosure, setShowDisclosure] = useState(false)
  const [phase, setPhase] = useState<TxPhase | null>(null)
  const [confirmed, setConfirmed] = useState(false)
  const { rebalance, txStage } = useVaultWrite()
  const { refetch } = useVaultPosition()

  const isValid = sumBps(allocation) === 100

  // Re-seed from the chain whenever the stored weights change under us. Keyed on the serialized
  // value, not the object: the parent rebuilds that object on every render.
  const chainKey = JSON.stringify(initialAllocation)
  useEffect(() => {
    setAllocation(initialAllocation)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainKey])

  useEffect(() => {
    if (!confirmed) return
    const timer = setTimeout(() => setConfirmed(false), CONFIRMED_MS)
    return () => clearTimeout(timer)
  }, [confirmed])

  async function armAndSign() {
    setShowDisclosure(false)
    setConfirmed(false)
    setPhase({ kind: 'signing' })
    const result = await rebalance(normalizeToBps(allocation))
    if (result.kind === 'success') {
      // The button holds its success beat while the green note carries the outcome and the
      // refetch lands; TxButton's onSettled walks the phase back to null.
      setPhase(result)
      setConfirmed(true)
      refetch()
      return
    }
    if (result.kind === 'rejected') {
      // Cancelling the wallet sheet is the user's own act — straight back to rest.
      setPhase(null)
      return
    }
    setPhase(result)
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
      {!hideRing && <StrategyRing allocation={allocation} />}
      <AllocationSliders value={allocation} onChange={setAllocation} />

      {confirmed && (
        <p className="rounded-[12px] flex items-center gap-3 border-[1.5px] border-[var(--yield)]/40 bg-[var(--yield)]/10 px-4 py-3.5 text-[15px] text-[var(--text-primary)]">
          <Check className="size-5 shrink-0 text-[var(--yield)]" aria-hidden="true" />
          Listo. Tu estrategia quedó aplicada.
        </p>
      )}

      {/* The whole lifecycle lives in the button: rest → wallet confirm → tx in flight →
          success/failure → back to normal. The panel survives only for `timeout`, which
          carries the Arbiscan link the button can't. */}
      {phase?.kind === 'timeout' ? (
        <TransactionState
          phase={phase}
          onPrimary={() => void armAndSign()}
          onSecondary={() => setPhase(null)}
          summary={<>Estrategia con {sumBps(allocation)}% asignado</>}
        />
      ) : showDisclosure && phase === null ? (
        <RebalanceCostDisclosure onConfirm={armAndSign} />
      ) : (
        <TxButton
          label={isBootstrap ? 'Definí tu estrategia' : 'Confirmar rebalanceo'}
          successLabel="Estrategia aplicada"
          stage={toButtonStage(phase, txStage)}
          disabled={!isValid}
          onClick={() => {
            if (phase?.kind === 'reverted') {
              void armAndSign()
              return
            }
            handlePrimary()
          }}
          onSettled={() => setPhase(null)}
        />
      )}
    </div>
  )
}
