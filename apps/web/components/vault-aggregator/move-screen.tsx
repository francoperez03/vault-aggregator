'use client'

import { useEffect, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { cn } from '@/lib/utils'
import { DepositView } from '@/components/vault-aggregator/deposit-view'
import { WithdrawView } from '@/components/vault-aggregator/withdraw-view'
import { formatUsdc } from '@/lib/format'
import { useUsdcBalance } from '@/hooks/useUsdcBalance'
import { useVaultPosition } from '@/hooks/useVaultPosition'
import { useWithdrawFlow } from '@/hooks/useWithdrawFlow'
import { isLemonWebView } from '@/lib/lemon/bridge'

export type MoveTab = 'deposit' | 'withdraw'

interface WalletBalanceProps {
  balance: bigint
  isLoading: boolean
}

/** The screen's focal point, same Display treatment as `PositionSummary`'s total (28px/600, mono,
 * tabular-nums) — but labelled "en tu wallet" so it never reads as a second opinion on the vault
 * position. `--` while the read is in flight: a flashed `$0.00` says "no tenés plata", which is a
 * claim we have not read yet. */
function WalletBalance({ balance, isLoading }: WalletBalanceProps) {
  return (
    <div className="flex flex-col items-center gap-1 py-4 text-center">
      <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
        Saldo en tu wallet
      </span>
      <span className="font-mono text-[28px] font-semibold leading-none tabular-nums text-[var(--text-primary)]">
        {isLoading ? '--' : `$${formatUsdc(balance)}`}
      </span>
    </div>
  )
}

/** Lemon's own home puts the actions as small labelled circles under the balance; matching that
 * shape keeps the mini-app feeling like part of the host app instead of a web page embedded in it.
 * Still a Radix tab under the hood — the roles, keyboard nav and `aria-selected` come for free,
 * and the visual is only a restyle. */
const TRIGGER_CLASS =
  'h-auto flex-none flex-col gap-2 rounded-none border-0 bg-transparent p-0 text-xs font-medium text-[var(--text-secondary)] shadow-none data-[state=active]:bg-transparent data-[state=active]:text-[var(--text-primary)] data-[state=active]:shadow-none'

const CIRCLE_CLASS =
  'flex size-14 items-center justify-center rounded-full border border-[var(--border-subtle)] bg-[var(--bg-overlay)] text-[var(--text-secondary)] transition-colors'

const CIRCLE_ACTIVE_CLASS = 'border-[var(--brand)] bg-[var(--brand)]/15 text-[var(--brand)]'

/** Owns the withdrawal's URL contract (`?paso=2`) now that the route is shared with the deposit
 * tab: the query param stays on whatever path the user is on (`/mover`, `/retirar`), so the
 * pending-settlement deep link keeps working from both. */
function WithdrawPanel() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const urlStep = searchParams.get('paso') === '2' ? 2 : 1

  const { totalUsdc } = useVaultPosition()
  const { pendingAmount, phase, redeem, settleToLemon, acknowledge } = useWithdrawFlow()
  // The flow itself is the source of truth once it has measured a pending amount (a refresh with
  // no `?paso=2` in the URL should still land on step 2, not silently drop the pending settlement).
  const step = pendingAmount !== null ? 2 : urlStep

  useEffect(() => {
    const params = new URLSearchParams(searchParams.toString())
    if (step === 2) params.set('paso', '2')
    else params.delete('paso')
    const query = params.toString()
    const target = query ? `${pathname}?${query}` : pathname
    if (`${pathname}${window.location.search}` !== target) router.replace(target)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function handleRedeem(bps: bigint) {
    await redeem(bps)
  }

  return (
    <WithdrawView
      totalUsdc={totalUsdc}
      step={step}
      pendingAmount={pendingAmount}
      phase={phase}
      onRedeem={handleRedeem}
      onSettle={settleToLemon}
      onAcknowledge={acknowledge}
    />
  )
}

interface MoveScreenProps {
  /** Which tab the entry route opens on. `/retirar` and `/depositar` survive as aliases of
   * `/mover` precisely so the home buttons and the pending-settlement deep link keep landing where
   * they always did, without a redirect flash. */
  initialTab?: MoveTab
  /** Test seam: injected instead of reading `useWithdrawFlow` twice, which would fork the flow's
   * state across two hook instances. */
  hasPendingSettlement?: boolean
}

/**
 * Deposit and withdrawal on one screen, because they are the same decision seen from two sides
 * (move money in, move money out) and the user reads the same wallet balance before either.
 *
 * The tab is local state, not a route: switching sides mid-thought should not push history the
 * back button then has to unwind. One exception overrides the user's choice — an unsettled
 * withdrawal (step 1 done, funds sitting in the mini-app balance) pins the Retirar tab, since
 * showing a deposit form while money is mid-flight is how money gets forgotten there.
 */
export function MoveScreen({ initialTab = 'deposit', hasPendingSettlement }: MoveScreenProps) {
  const [tab, setTab] = useState<MoveTab>(initialTab)
  const { hasWeights } = useVaultPosition()
  const { balance, isLoading, isConnected } = useUsdcBalance()
  const { pendingAmount } = useWithdrawFlow()

  const pinnedToWithdraw = hasPendingSettlement ?? pendingAmount !== null
  const activeTab = pinnedToWithdraw ? 'withdraw' : tab

  return (
    <div className="flex flex-col gap-4 px-4 pt-[calc(1rem+env(safe-area-inset-top))]">
      {isConnected && <WalletBalance balance={balance} isLoading={isLoading} />}

      <Tabs value={activeTab} onValueChange={(value) => setTab(value as MoveTab)}>
        <TabsList className="h-auto w-full justify-center gap-10 bg-transparent p-0">
          <TabsTrigger value="deposit" className={TRIGGER_CLASS} disabled={pinnedToWithdraw}>
            <span className={cn(CIRCLE_CLASS, activeTab === 'deposit' && CIRCLE_ACTIVE_CLASS)}>
              <ArrowDown className="size-6" aria-hidden="true" />
            </span>
            Depositar
          </TabsTrigger>
          <TabsTrigger value="withdraw" className={TRIGGER_CLASS}>
            <span className={cn(CIRCLE_CLASS, activeTab === 'withdraw' && CIRCLE_ACTIVE_CLASS)}>
              <ArrowUp className="size-6" aria-hidden="true" />
            </span>
            Retirar
          </TabsTrigger>
        </TabsList>

        <TabsContent value="deposit">
          <DepositView hasWeights={hasWeights} isLemonRuntime={isLemonWebView()} />
        </TabsContent>

        <TabsContent value="withdraw">
          <WithdrawPanel />
        </TabsContent>
      </Tabs>
    </div>
  )
}
