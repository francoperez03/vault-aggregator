import { MoveScreen } from '@/components/vault-aggregator/move-screen'

/** Alias of `/mover`: deposit and withdrawal share one control now, so there is nothing left to
 * preselect. Kept as a route so existing links keep working. */
export default function DepositarPage() {
  return (
    <main className="min-h-dvh bg-background">
      <MoveScreen />
    </main>
  )
}
