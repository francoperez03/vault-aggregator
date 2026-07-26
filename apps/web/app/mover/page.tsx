import { Suspense } from 'react'
import { MoveScreen } from '@/components/vault-aggregator/move-screen'

/** Canonical route for moving money in or out. `/depositar` and `/retirar` render the same screen
 * with the other tab preselected, so every existing link keeps working. */
export default function MoverPage() {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={null}>
        <MoveScreen />
      </Suspense>
    </main>
  )
}
