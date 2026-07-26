import { MoveScreen } from '@/components/vault-aggregator/move-screen'

/** Money movements on their own route, without the position below. `/` shows the same screen with
 * the position; `/depositar` and `/retirar` are kept as aliases so old links still land here. */
export default function MoverPage() {
  return (
    <main className="min-h-dvh bg-background">
      <MoveScreen />
    </main>
  )
}
