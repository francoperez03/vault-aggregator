'use client'

import { Button } from '@/components/ui/button'

interface RebalanceCostDisclosureProps {
  onConfirm: () => void
}

/** D-15: nobody signs a rebalance without seeing what it costs first. This is a confirmation step
 * with an explicit cost, not a destructive `AlertDialog` — rebalance moves funds, it does not
 * destroy anything (14-UI-SPEC §Copywriting Contract). */
export function RebalanceCostDisclosure({ onConfirm }: RebalanceCostDisclosureProps) {
  return (
    <div className="flex flex-col gap-4 rounded-[12px] border border-[var(--warning)]/40 bg-[var(--warning)]/10 p-4">
      <p className="text-sm text-[var(--text-primary)]">
        Rebalancear retira de todos los protocolos y vuelve a depositar según tus pesos nuevos. Puede haber una diferencia chica por redondeo o slippage, y el rendimiento acumulado hasta ahora se realiza en esta operación.
      </p>
      <Button type="button" size="lg"  onClick={onConfirm}>
        Confirmar rebalanceo
      </Button>
    </div>
  )
}
