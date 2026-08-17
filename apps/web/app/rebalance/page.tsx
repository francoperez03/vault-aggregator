'use client'

import { useRouter } from 'next/navigation'
import { RebalancePanel } from '@/components/vault-aggregator/rebalance-panel'

/** Standalone route, kept for deep links. On `/` the same panel slides in as the second step
 * instead of navigating. */
export default function RebalancePage() {
  const router = useRouter()
  return (
    <div className="flex flex-1 flex-col bg-background">
      <RebalancePanel onBack={() => router.push('/')} />
    </div>
  )
}
