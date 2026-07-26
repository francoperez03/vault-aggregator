import { Suspense } from 'react'
import { MoveScreen } from '@/components/vault-aggregator/move-screen'

/** Alias of `/mover` opening on the deposit tab. Kept as a real route rather than a redirect so
 * the home page's "Depositar" button lands without a navigation flash. */
export default function DepositarPage() {
  return (
    <main className="min-h-dvh bg-background">
      <Suspense fallback={null}>
        <MoveScreen initialTab="deposit" />
      </Suspense>
    </main>
  )
}
