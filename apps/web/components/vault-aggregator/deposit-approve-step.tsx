'use client'

import { Button } from '@/components/ui/button'
import { formatUsdc } from '@/lib/format'

interface DepositApproveStepProps {
  isLemonRuntime: boolean
  amount: bigint
  approved: boolean
  onApprove: () => void
}

/** D-09: the approve is per-deposit, for the EXACT amount, every time, and never persists between
 * deposits. Browser runtime shows it as its own signature (two firmas); inside Lemon the SDK
 * batches `[approve, deposit]` into one prompt (D-11), so no separate approve CTA renders there. */
export function DepositApproveStep({ isLemonRuntime, amount, approved, onApprove }: DepositApproveStepProps) {
  if (isLemonRuntime) {
    return (
      <p className="text-sm text-[var(--text-secondary)]">
        Lemon procesa la aprobación y el depósito juntos.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-[var(--text-secondary)]">
        Vas a firmar dos veces: primero aprobás el monto exacto, después depositás.
      </p>
      <Button type="button" onClick={onApprove} disabled={approved} className="min-h-[44px]">
        {approved ? `USDC aprobado · $${formatUsdc(amount)}` : 'Aprobar USDC'}
      </Button>
    </div>
  )
}
