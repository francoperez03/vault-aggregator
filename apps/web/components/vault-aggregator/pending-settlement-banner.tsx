'use client'

import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { formatUsdc } from '@/lib/format'

interface PendingSettlementBannerProps {
  /** The USDC step 1 measured from the on-chain redeem's balance delta (D-19), still sitting in
   * the mini-app balance until step 2 sends it to Lemon. */
  pendingAmount: bigint
}

/**
 * Persistent reminder that funds landed in the mini-app balance after step 1 of a withdrawal but
 * have not yet been sent to Lemon.
 *
 * Deliberately a persistent card, never an auto-dismissing notification: something that
 * disappears on its own would take with it the only signal that money is mid-flight
 * (T-14-10-04's own reasoning applied to visibility, not just retries). This banner survives a
 * refresh because the caller reads `pendingAmount` from
 * `useWithdrawFlow`, which persists it in `localStorage` per wallet address.
 */
export function PendingSettlementBanner({ pendingAmount }: PendingSettlementBannerProps) {
  return (
    <Card className="mb-4 rounded-[14px] border-[var(--warning)]/40 bg-[var(--warning)]/10">
      <CardContent className="p-4 text-sm text-[var(--text-primary)]">
        <p>
          Moviste ${formatUsdc(pendingAmount)} USDC al saldo de la app. Enviálo a Lemon para terminar.
        </p>
        <Link
          href="/retirar?paso=2"
          className="mt-2 inline-block text-sm font-semibold text-[var(--brand)] underline"
        >
          Ir a retirar
        </Link>
      </CardContent>
    </Card>
  )
}
