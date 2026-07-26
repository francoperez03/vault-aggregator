'use client'

import { ArrowLeft } from 'lucide-react'
import { RebalanceView } from '@/components/vault-aggregator/rebalance-view'
import { ADAPTER_IDS, type AdapterId } from '@/lib/contracts/config'
import { useVaultPosition } from '@/hooks/useVaultPosition'

/** bps (0-10000) -> percent (0-100), rounded: AllocationSliders works in plain percentages
 * (`lib/vault/weights.ts`'s `normalizeToBps` converts back before arming the tx). */
function bpsToPercent(bps: number): number {
  return Math.round(bps / 100)
}

/** The allocation step, wired to the live position. Rendered both as the second panel of the home
 * stepper and as the standalone `/rebalancear` route, which is why the back affordance is a
 * callback: sliding back is not the same gesture as navigating back. */
export function RebalancePanel({ onBack }: { onBack?: () => void }) {
  const vaultPosition = useVaultPosition()
  // D-13: position cero degenerates this step into "definí tu estrategia" over a zero balance.
  const isBootstrap = vaultPosition.totalUsdc === 0n

  const initialAllocation: Partial<Record<AdapterId, number>> = {}
  for (const id of ADAPTER_IDS) {
    initialAllocation[id] = bpsToPercent(vaultPosition.perAdapter[id]?.weightBps ?? 0)
  }

  return (
    <div className="flex flex-col">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex min-h-[44px] items-center gap-2 px-4 pt-[calc(0.5rem+env(safe-area-inset-top))] text-sm text-[var(--text-secondary)]"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Volver
        </button>
      )}
      <RebalanceView isBootstrap={isBootstrap} initialAllocation={initialAllocation} />
    </div>
  )
}
