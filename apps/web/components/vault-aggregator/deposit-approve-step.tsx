'use client'

import { formatUsdc } from '@/lib/format'
import { useUsdcAllowance } from '@/hooks/useUsdcAllowance'

interface DepositApproveStepProps {
  isLemonRuntime: boolean
  amount: bigint
}

/** D-09: the approve is per-deposit, for the EXACT amount, every time, read from the real
 * allowance (never a local click-to-approve toggle) — `useVaultWrite().deposit` fires both
 * signatures itself, this step is informational only. Inside Lemon the SDK batches
 * `[approve, deposit]` into one prompt (D-11), so no separate approve copy renders there. */
export function DepositApproveStep({ isLemonRuntime, amount }: DepositApproveStepProps) {
  const { needsApproval } = useUsdcAllowance(amount)

  // Nothing to approve, nothing to say: an "approved · $0.00" line under a disabled slider is noise.
  if (amount === 0n) return null

  if (isLemonRuntime) {
    return (
      <p className="text-sm text-[var(--text-secondary)]">
        Lemon procesa la aprobación y el depósito juntos.
      </p>
    )
  }

  if (!needsApproval) {
    return (
      <p className="text-sm text-[var(--text-secondary)]">USDC ya aprobado · ${formatUsdc(amount)}</p>
    )
  }

  return (
    <p className="text-sm text-[var(--text-secondary)]">
      Vas a firmar dos veces: primero aprobás el monto exacto, después depositás.
    </p>
  )
}
