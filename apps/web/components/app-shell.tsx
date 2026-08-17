'use client'

import { ConfigErrorBanner } from '@/components/config-error-banner'
import { FaultInjectionPanel } from '@/components/vault-aggregator/fault-injection-panel'
import { MoveQueueStrip } from '@/components/vault-aggregator/move-queue-strip'

/** No bottom nav: `/` carries both steps of the flow (money movements, then the allocation panel
 * sliding in from the side), so a persistent tab bar would point at places the user is already in. */
export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col pb-[env(safe-area-inset-bottom)]">
      <ConfigErrorBanner />
      <main className="flex flex-1 flex-col pb-8">{children}</main>
      <MoveQueueStrip />
      <FaultInjectionPanel />
    </div>
  )
}
