'use client'

import { useRouter } from 'next/navigation'
import { RebalancePanel } from '@/components/vault-aggregator/rebalance-panel'

/** Standalone route, kept for deep links. On `/` the same panel slides in as the second step
 * instead of navigating. */
export default function RebalancearPage() {
  const router = useRouter()
  return (
    <main className="min-h-dvh bg-background">
      <RebalancePanel onBack={() => router.push('/')} />
    </main>
  )
}
