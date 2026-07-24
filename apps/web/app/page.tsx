'use client'

import { useState } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { PositionSummary } from '@/components/vault-aggregator/position-summary'
import { ProtocolBreakdown } from '@/components/vault-aggregator/protocol-breakdown'
import { formatUsdc } from '@/lib/format'
import { ADAPTER_IDS } from '@/lib/contracts/config'
import { MOCK_EMPTY, MOCK_FUNDED, MOCK_WEIGHTS_ONLY, type PositionState } from '@/lib/mock/position'

interface HomePositionViewProps {
  position: PositionState
}

/** Composes the home route's three entry states (D-13/D-14/D-26). Plan 08 swaps the `position`
 * prop's source from a mock fixture to `useVaultPosition()` without touching this component. */
export function HomePositionView({ position }: HomePositionViewProps) {
  const weightedAdapterCount = ADAPTER_IDS.filter((id) => position.perAdapter[id].weightBps > 0).length
  const isFunded = position.totalUsdc > 0n

  return (
    <div className="px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      {position.pendingWithdrawalUsdc !== undefined && position.pendingWithdrawalUsdc > 0n && (
        <Card className="mb-4 rounded-[14px] border-[var(--warning)]/40 bg-[var(--warning)]/10">
          <CardContent className="p-4 text-sm text-[var(--text-primary)]">
            <p>
              Moviste ${formatUsdc(position.pendingWithdrawalUsdc)} USDC al saldo de la app. Enviálo a Lemon para
              terminar.
            </p>
            <Link href="/retirar" className="mt-2 inline-block text-sm font-semibold text-[var(--brand)] underline">
              Ir a retirar
            </Link>
          </CardContent>
        </Card>
      )}

      {isFunded ? (
        <>
          <PositionSummary totalUsdc={position.totalUsdc} />
          <Card className="mb-4 rounded-[14px] border-[var(--border-subtle)] px-4 py-4">
            <CardContent className="p-0">
              <ProtocolBreakdown position={position} />
            </CardContent>
          </Card>
          <div className="flex gap-2">
            <Button asChild size="lg" className="min-h-[44px] flex-1">
              <Link href="/depositar">Depositar</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="min-h-[44px] flex-1">
              <Link href="/rebalancear">Rebalancear</Link>
            </Button>
            <Button asChild variant="outline" size="lg" className="min-h-[44px] flex-1">
              <Link href="/retirar">Retirar</Link>
            </Button>
          </div>
        </>
      ) : position.hasWeights ? (
        <Card className="rounded-[14px] border-[var(--border-subtle)] px-4 py-8 text-center">
          <CardContent className="flex flex-col items-center gap-3 p-0">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Estrategia guardada</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Tu asignación está definida en {weightedAdapterCount} protocolos. Depositá cuando quieras.
            </p>
            <Button asChild size="lg" className="mt-2 min-h-[44px]">
              <Link href="/depositar">Depositar ahora</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card className="rounded-[14px] border-dashed border-[var(--border-subtle)] px-4 py-8 text-center">
          <CardContent className="flex flex-col items-center gap-3 p-0">
            <h1 className="text-xl font-semibold text-[var(--text-primary)]">Todavía no tenés posición</h1>
            <p className="text-sm text-[var(--text-secondary)]">
              Definí tu estrategia y hacé tu primer depósito: se reparte solo entre los protocolos que elijas.
            </p>
            <Button asChild size="lg" className="mt-2 min-h-[44px]">
              <Link href="/rebalancear">Definí tu estrategia</Link>
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

// ponytail: dev-only fixture switcher. Plan 08 replaces `position` with useVaultPosition() and
// this switcher goes away; kept minimal (no gate) since fixtures carry no sensitive data.
const DEMO_FIXTURES = {
  empty: MOCK_EMPTY,
  weightsOnly: MOCK_WEIGHTS_ONLY,
  funded: MOCK_FUNDED,
} as const

export default function Page() {
  const [fixtureKey, setFixtureKey] = useState<keyof typeof DEMO_FIXTURES>('funded')

  return (
    <main className="min-h-dvh bg-background">
      <HomePositionView position={DEMO_FIXTURES[fixtureKey]} />
      <div className="flex justify-center gap-2 px-4 pb-6 pt-2">
        {(Object.keys(DEMO_FIXTURES) as (keyof typeof DEMO_FIXTURES)[]).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setFixtureKey(key)}
            className="rounded-full border border-[var(--border-subtle)] px-2.5 py-1 text-[10px] text-[var(--text-secondary)]"
          >
            {key}
          </button>
        ))}
      </div>
    </main>
  )
}
