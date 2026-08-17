'use client'

import { Suspense, useEffect, useRef, useState, type ReactNode } from 'react'
import { animate } from 'animejs'
import { ArrowLeft, SlidersHorizontal } from 'lucide-react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { PositionSummary } from '@/components/vault-aggregator/position-summary'
import { ProtocolBreakdown } from '@/components/vault-aggregator/protocol-breakdown'
import { ProtocolLogo } from '@/components/vault-aggregator/protocol-logo'
import { LemonHandshake } from '@/components/vault-aggregator/lemon-handshake'
import { LemonAccount } from '@/components/vault-aggregator/lemon-account-card'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { getVaults } from '@/lib/vaults'
import { MoveScreen } from '@/components/vault-aggregator/move-screen'
import { RebalancePanel } from '@/components/vault-aggregator/rebalance-panel'
import { WalletBar } from '@/components/wallet-bar'
import { StrategyRing } from '@/components/vault-aggregator/strategy-ring'
import { Landing, VaultyWordmark } from '@/components/landing'
import { isLemonWebView } from '@/lib/lemon/bridge'
import { ADAPTER_IDS, type AdapterId } from '@/lib/contracts/config'
import { useVaultPosition } from '@/hooks/useVaultPosition'
import { useWalletAddress } from '@/hooks/useWalletAddress'
import { useVaultYield, type UseVaultYieldResult } from '@/hooks/useVaultYield'
import { useNetworkGuard } from '@/hooks/useNetworkGuard'
import { useWithdrawFlow } from '@/hooks/useWithdrawFlow'

/** Total-level tick state (15-UI-SPEC §Color): down wins over up so a net-negative moment is never
 * masked by a single up row; only all-flat/pre-sample renders --text-secondary. */
function deriveTotalState(perAdapter: UseVaultYieldResult['perAdapter']): 'flat' | 'up' | 'down' {
  const states = Object.values(perAdapter).map((e) => e?.state)
  if (states.some((s) => s === 'down')) return 'down'
  if (states.some((s) => s === 'up')) return 'up'
  return 'flat'
}

/** Same shape as the mock fixture module's PositionState (declared locally so this route no
 * longer imports that test-only fixture module). Plan 08 wires `/` to `useVaultPosition()`
 * instead, see `toPositionState` below. */
interface PositionState {
  perAdapter: Record<AdapterId, { shares: bigint; valueUsdc: bigint; weightBps: number; unavailable?: boolean }>
  totalUsdc: bigint
  hasWeights: boolean
  pendingWithdrawalUsdc?: bigint
}

/** One CTA, two behaviours: inside the home stepper it slides the allocation panel in, and
 * anywhere the callback is absent (direct render, tests) it degrades to the plain route link so
 * the step is never unreachable. */
function RebalanceCta({
  onRebalance,
  label,
  icon,
  variant,
  className,
}: {
  onRebalance?: () => void
  label: string
  /** Optional leading glyph; the accessible name stays the label alone. */
  icon?: ReactNode
  variant?: 'outline'
  className?: string
}) {
  const content = (
    <>
      {icon}
      {label}
    </>
  )
  if (onRebalance) {
    return (
      <Button
        type="button"
        size="lg"
        variant={variant}
        className={cn('w-full', className)}
        onClick={onRebalance}
      >
        {content}
      </Button>
    )
  }
  return (
    <Button asChild size="lg" variant={variant} className={cn('w-full', className)}>
      <Link href="/rebalance">{content}</Link>
    </Button>
  )
}

interface HomePositionViewProps {
  position: PositionState
  /** Slides the allocation step in. Absent (tests, the standalone route) falls back to a link. */
  onRebalance?: () => void
  /** VFE-02 live yield, threaded from `useVaultYield`. Optional so direct-render tests keep
   * working: absent → the total falls back to `position.totalUsdc` flat, rows to their static
   * `valueUsdc` (see `ProtocolBreakdown`). */
  yieldByAdapter?: UseVaultYieldResult['perAdapter']
}

/** Composes the home route's three entry states (D-13/D-14/D-26). Plan 08 swaps the `position`
 * prop's source from a mock fixture to `useVaultPosition()` without touching this component;
 * Plan 15 threads the live yield in (VFE-02) while keeping the fixture-only fallback. */
export function HomePositionView({
  position,
  onRebalance,
  yieldByAdapter,
}: HomePositionViewProps) {
  const weightedAdapterCount = ADAPTER_IDS.filter((id) => position.perAdapter[id].weightBps > 0).length
  const isFunded = position.totalUsdc > 0n

  return (
    // Top gap: this sits under MoveScreen (its own gap-5 stack) and needs a section break, not a
    // component gap, before its kicker.
    <div className="px-4 pt-6">
      {isFunded ? (
        <>
          <Card className="mb-4 px-4 py-4">
            <CardContent className="p-0">
              <ProtocolBreakdown position={position} yieldByAdapter={yieldByAdapter} />
            </CardContent>
          </Card>
          {/* Depositar and Retirar used to live here as two more buttons; they are the screen
              above now, so the only thing left is the allocation step. */}
          <RebalanceCta onRebalance={onRebalance} label="Rebalancear" variant="outline" />
        </>
      ) : position.hasWeights ? (
        // No wrapper here: the ring above already frames the strategy, so this is just the
        // strategy spelled out (who, how much) and the one thing you can do with it.
        <div className="flex flex-col gap-4">
          <div>
            <h2 className="kicker mb-3 block">Tu estrategia</h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-2">
              {getVaults()
                .filter((vault) => position.perAdapter[vault.id].weightBps > 0)
                .map((vault) => (
                  <li key={vault.id} className="flex items-center gap-2 text-sm">
                    <ProtocolLogo id={vault.id} />
                    <span className="font-semibold text-[var(--text-primary)]">{vault.protocol}</span>
                    <span className="font-mono tabular-nums text-[var(--text-secondary)]">
                      {position.perAdapter[vault.id].weightBps / 100}%
                    </span>
                  </li>
                ))}
            </ul>
          </div>
          <RebalanceCta
            onRebalance={onRebalance}
            label="Editar estrategia"
            icon={<SlidersHorizontal aria-hidden="true" />}
            variant="outline"
          />
          <p className="text-sm text-[var(--text-secondary)]">
            Todavía no depositaste. Con USDC en tu wallet, el control de arriba lo reparte así.
          </p>
        </div>
      ) : (
        // Same shape as the saved-strategy block above, minus the chips: kicker, one primary
        // action, one line of hint. No card, no headline — the gray ring above already says
        // "nothing here yet".
        <div className="flex flex-col gap-4">
          <h2 className="kicker block">Tu estrategia</h2>
          <RebalanceCta
            onRebalance={onRebalance}
            label="Definí tu estrategia"
            icon={<SlidersHorizontal aria-hidden="true" />}
          />
          <p className="text-sm text-[var(--text-secondary)]">
            Elegís protocolos y porcentajes; el primer depósito se reparte solo.
          </p>
        </div>
      )}
    </div>
  )
}

/** The stored weights as slider-style percentages for the StrategyRing. */
function toRingAllocation(position: PositionState): Partial<Record<AdapterId, number>> {
  return Object.fromEntries(
    ADAPTER_IDS.map((id) => [id, position.perAdapter[id].weightBps / 100]),
  )
}

/** Composes a `useVaultPosition()` read into `HomePositionView`'s prop shape. Unconfigured
 * adapters (missing env var) render as an empty zero entry, same as an adapter with no position. */
function toPositionState(
  vaultPosition: ReturnType<typeof useVaultPosition>,
  pendingWithdrawalUsdc: bigint | null,
): PositionState {
  const perAdapter = {} as PositionState['perAdapter']
  for (const id of ADAPTER_IDS) {
    const adapter = vaultPosition.perAdapter[id]
    perAdapter[id] = adapter
      ? { shares: adapter.shares, valueUsdc: adapter.valueUsdc, weightBps: adapter.weightBps, unavailable: adapter.unavailable }
      : { shares: 0n, valueUsdc: 0n, weightBps: 0 }
  }
  return {
    perAdapter,
    totalUsdc: vaultPosition.totalUsdc,
    hasWeights: vaultPosition.hasWeights,
    pendingWithdrawalUsdc: pendingWithdrawalUsdc ?? undefined,
  }
}

export default function Page() {
  // SIWE wallet inside Lemon, wagmi account otherwise: wagmi alone never connects in the WebView.
  const isConnected = Boolean(useWalletAddress())
  const { isWrongNetwork, expectedName, switchNetwork } = useNetworkGuard()
  const vaultPosition = useVaultPosition()
  // VFE-02: turn the already-fetched positions into the live per-second counter. No txNonce is
  // threaded here because deposits/withdraws/rebalances complete on their own routes, not on `/`;
  // the snapshot's MIN_SAMPLE_INTERVAL gate absorbs the between-visit share jump (Pitfall 2/3).
  const vaultYield = useVaultYield(vaultPosition.perAdapter)
  // D-19: the banner (plan 03/08) is only real once step 1 of a withdrawal actually measured and
  // persisted an amount, which is what useWithdrawFlow reads back from localStorage on mount.
  const { pendingAmount, clearPending } = useWithdrawFlow()
  const { balance: walletUsdc, refetch: refetchBalance } = useUsdcBalance()
  const [step, setStep] = useState<'move' | 'rebalance'>('move')
  // The single persistent ring's draft source while the allocation step is editing. Null until
  // RebalanceView seeds it (bootstrap's even split included).
  const [draftAllocation, setDraftAllocation] = useState<Partial<Record<AdapterId, number>> | null>(null)

  // A wallet arriving on another network (Ethereum, usually) gets taken to the app's chain
  // without having to find the button: the switch prompt fires once per wrong-network episode.
  // The card below stays as the fallback for a rejected/unsupported prompt.
  const attemptedSwitchRef = useRef(false)
  useEffect(() => {
    if (!isConnected || !isWrongNetwork) {
      attemptedSwitchRef.current = false
      return
    }
    if (attemptedSwitchRef.current) return
    attemptedSwitchRef.current = true
    switchNetwork()
  }, [isConnected, isWrongNetwork, switchNetwork])

  // Unconnected web visitors get the pitch, not a sad empty card. Inside Lemon the injected
  // wallet connects on its own, so the landing never flashes there; the mounted gate keeps the
  // server-rendered markup stable while isLemonWebView() waits for `window`.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const showLanding = mounted && !isConnected && !isLemonWebView()

  const prefersReducedMotion = () =>
    typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  // The rail slides under the fixed ring; anime drives it so the motion shares the ring's easing
  // language instead of a parallel CSS timing.
  const railRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const rail = railRef.current
    if (!rail) return
    const to = step === 'rebalance' ? -50 : 0
    if (prefersReducedMotion()) {
      rail.style.transform = `translateX(${to}%)`
      return
    }
    const animation = animate(rail, { translateX: `${to}%`, duration: 550, ease: 'outQuint' })
    return () => {
      animation.pause()
    }
  }, [step])

  // "Volver" fades in above the ring when the allocation step is active; the row keeps its
  // height in both steps so the ring never jumps.
  const backRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const el = backRef.current
    if (!el) return
    const show = step === 'rebalance'
    if (prefersReducedMotion()) {
      el.style.opacity = show ? '1' : '0'
      return
    }
    const animation = animate(el, {
      opacity: show ? 1 : 0,
      translateY: show ? 0 : -6,
      duration: 350,
      ease: 'outQuad',
    })
    return () => {
      animation.pause()
    }
  }, [step])

  if (showLanding) {
    return (
      <div className="flex flex-1 flex-col bg-background">
        <Landing />
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col bg-background">
      <header className="flex items-center justify-between pl-4 pt-[calc(0.5rem+env(safe-area-inset-top))]">
        <VaultyWordmark compact />
        <WalletBar />
      </header>
      {!isConnected ? (
        // Inside Lemon this is the SIWE handshake in progress (a failed one puts a retry in the
        // header); a blank column read as "nothing loads" in QA.
        // Locked to the viewport: a short handshake state that scrolls reads as a broken page.
        <div className="flex flex-1 flex-col items-center justify-center gap-5 px-4">
          {mounted && isLemonWebView() && <LemonHandshake />}
        </div>
      ) : isWrongNetwork ? (
        <div className="px-4 pt-8">
          <Card className="border-[var(--warning)]/40 bg-[var(--warning)]/10 px-4 py-8 text-center">
            <CardContent className="flex flex-col items-center gap-3 p-0">
              <p className="text-sm text-[var(--text-primary)]">
                Tu wallet está en otra red. Cambiá a Arbitrum {expectedName} para continuar.
              </p>
              <Button type="button" size="lg"  onClick={switchNetwork}>
                Cambiar de red
              </Button>
            </CardContent>
          </Card>
        </div>
      ) : (
        // One circle, fixed; what moves is everything below it: the stored weights on the move
        // step, the live draft while editing (anime morphs between states because only the prop
        // changes). With no strategy yet there is no ring: an empty gray wheel over "Definí tu
        // estrategia" was a placeholder pretending to be content.
        <>
          {/* Money in and out of the mini-app, above everything and on both steps: it is the
              precondition for the rest, not a step of it. Only Lemon can cross this boundary. */}
          {mounted && isLemonWebView() && (
            <div className="px-4 pb-4 pt-3">
              <LemonAccount
                // Remount on step change so an open Traer/Enviar panel folds back to the two
                // tabs when the allocation step slides in; a transfer mid-flight is queued by
                // the SDK, not by this component, so nothing is lost.
                key={step}
                walletUsdc={walletUsdc}
                pendingAmount={pendingAmount}
                onSent={clearPending}
                onDone={() => {
                  refetchBalance()
                  vaultPosition.refetch()
                }}
              />
            </div>
          )}
          <button
            ref={backRef}
            type="button"
            onClick={() => setStep('move')}
            tabIndex={step === 'rebalance' ? 0 : -1}
            aria-hidden={step === 'move'}
            className={cn(
              'flex min-h-[44px] items-center gap-2 px-4 text-sm text-[var(--text-secondary)] opacity-0',
              step === 'move' && 'pointer-events-none',
              // The row reserves height only when there is a ring below to keep steady.
              step === 'move' && !vaultPosition.hasWeights && 'hidden',
            )}
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
            Volver
          </button>
          {(step === 'rebalance' || vaultPosition.hasWeights) && (
            <div data-testid="strategy-ring">
              <StrategyRing
                allocation={
                  step === 'rebalance' && draftAllocation
                    ? draftAllocation
                    : toRingAllocation(toPositionState(vaultPosition, pendingAmount))
                }
                // Editing shows percentages (they are the validation guard); at rest the center
                // only claims a number when there is actually money behind it.
                funded={step === 'rebalance' || vaultPosition.totalUsdc > 0n}
              />
            </div>
          )}
          {/* Two steps side by side on one rail. Rebalancing is a detour from the same money, not
              a different place, so it slides in under the fixed ring instead of navigating away
              and dropping the scroll position on the way back. */}
          <div className="overflow-x-hidden">
          <div ref={railRef} className="flex w-[200%]">
            <div className="w-1/2" aria-hidden={step === 'rebalance'}>
              {/* Move first, position second: the reason to open the app is to put money in or
                  take it out; the position is what you check on the way past. */}
              {/* The money first, always — $0 included: the card is where the position lives,
                  and a user with nothing yet still needs to see where the number will appear. */}
              <div className="px-4">
                <PositionSummary
                  displayedValueUsdc={vaultYield.totalDisplayedUsdc}
                  state={deriveTotalState(vaultYield.perAdapter)}
                  ratePerSecond={Object.values(vaultYield.perAdapter).reduce((sum, e) => sum + (e?.rate ?? 0), 0)}
                />
              </div>
              <Suspense fallback={null}>
                <MoveScreen />
              </Suspense>
              <HomePositionView
                position={toPositionState(vaultPosition, pendingAmount)}
                yieldByAdapter={vaultYield.perAdapter}
                onRebalance={() => setStep('rebalance')}
              />
            </div>
            <div className="w-1/2" aria-hidden={step === 'move'}>
              {/* No onBack: the shared "Volver" above the ring owns the way back now. */}
              <RebalancePanel onAllocationChange={setDraftAllocation} hideRing />
            </div>
          </div>
          </div>
        </>
      )}
    </div>
  )
}
