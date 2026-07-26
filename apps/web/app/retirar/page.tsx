import { MoveScreen } from '@/components/vault-aggregator/move-screen'

/** Alias of `/mover`. The old `?paso=2` deep link still lands somewhere correct: a pending
 * settlement always renders its own card at the top of this screen, on any route. */
export default function RetirarPage() {
  return (
    <main className="min-h-dvh bg-background">
      <MoveScreen />
    </main>
  )
}
