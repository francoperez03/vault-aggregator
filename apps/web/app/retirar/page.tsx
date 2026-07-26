import { Suspense } from 'react'
import { MoveScreen } from '@/components/vault-aggregator/move-screen'

/** Alias of `/mover` opening on the withdrawal tab. `?paso=2` still deep-links into step 2 — the
 * pending-settlement banner on `/` points here. */
export default function RetirarPage() {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={null}>
        <MoveScreen initialTab="withdraw" />
      </Suspense>
    </main>
  )
}
