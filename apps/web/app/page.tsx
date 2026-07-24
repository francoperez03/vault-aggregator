'use client'

import { useCallback, useMemo, useState } from 'react'
import { BalanceCounter } from '@/components/vault-aggregator'
import { YieldAllocationBuilder } from '@/components/vault-aggregator'
import { PortfolioAllocation } from '@/components/vault-aggregator'
import { DepositWithdrawDialog, WithdrawFlowModal } from '@/components/vault-aggregator'
import {
  EmptyBalanceState,
  EmptyPortfolioState,
  ErrorState,
  LoadingBalanceState,
  LoadingPortfolioState,
} from '@/components/vault-aggregator/empty-states'
import { StateShortcuts, type DemoState } from '@/components/vault-aggregator/state-shortcuts'
import { AtomicFlowLogo } from '@/components/atomic-flow-logo'
import { Button } from '@/components/ui/button'
import { ArrowUpFromLine } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { getWeightedApy } from '@/lib/vaults'
import type { Allocation } from '@/types'
import { toast } from 'sonner'

const DEFAULT_ALLOCATION: Allocation = {
  aave: 40,
  morpho: 30,
  fluid: 20,
  beefy: 10,
}

const MOCK_ALLOCATED = 10_000 // In vaults (staking)
const MOCK_USDC_AVAILABLE = 2_500 // USDC available for withdraw to Lemon

export default function Page() {
  const [allocatedBalance, setAllocatedBalance] = useState(MOCK_ALLOCATED)
  const [usdcBalance, setUsdcBalance] = useState(MOCK_USDC_AVAILABLE)
  const [allocations, setAllocations] = useState<Allocation>(DEFAULT_ALLOCATION)
  const [demoState, setDemoState] = useState<DemoState>('default')
  const [depositDialogOpen, setDepositDialogOpen] = useState(false)
  const [withdrawModalOpen, setWithdrawModalOpen] = useState(false)
  const [yieldBuilderOpen, setYieldBuilderOpen] = useState(false)

  const apy = useMemo(() => getWeightedApy(allocations), [allocations])

  const handleStateChange = useCallback((state: DemoState) => {
    setDemoState(state)
    if (state === 'empty') {
      setAllocatedBalance(0)
      setUsdcBalance(0)
    }
    if (state === 'default') {
      setAllocatedBalance(MOCK_ALLOCATED)
      setUsdcBalance(MOCK_USDC_AVAILABLE)
    }
  }, [])

  // Lemon → miniapp (available USDC)
  const handleDeposit = useCallback((amount: number) => {
    setUsdcBalance((b) => b + amount)
    if (allocatedBalance === 0 && usdcBalance === 0 && amount > 0) setDemoState('default')
  }, [allocatedBalance, usdcBalance])

  // Vaults → available USDC (redeem)
  const handleRedeem = useCallback((amount: number) => {
    setAllocatedBalance((b) => Math.max(0, b - amount))
    setUsdcBalance((b) => b + amount)
  }, [])

  // Available USDC → Lemon (outside the miniapp)
  const handleWithdraw = useCallback((amount: number) => {
    setUsdcBalance((b) => Math.max(0, b - amount))
  }, [])

  const handleApplyAllocations = useCallback((newAllocations: Allocation) => {
    setAllocations(newAllocations)
    setYieldBuilderOpen(false)
    toast.success('Allocation applied')
    // In production this would trigger the router transaction
  }, [])

  const displayAllocated = demoState === 'empty' ? 0 : allocatedBalance
  const displayUsdc = demoState === 'empty' ? 0 : usdcBalance
  const hasAnyBalance = displayAllocated > 0 || displayUsdc > 0

  const showError = demoState === 'error'
  const showLoading = demoState === 'loading'
  const showEmptyBalance = demoState === 'empty' && !hasAnyBalance
  const showEmptyPortfolio = demoState === 'default' && hasAnyBalance && Object.values(allocations).every((v) => v === 0)

  return (
    <main className="min-h-dvh bg-background">
      <header className="sticky top-0 z-10 bg-[rgba(10,12,15,0.85)] backdrop-blur-[16px] pt-[calc(1rem+env(safe-area-inset-top))] pb-4">
        <div className="flex items-center justify-between px-4 py-2">
          <AtomicFlowLogo size={18} wordmarkSize={14} showWordmark variant="muted" />
          <span
            className="text-[11px] font-medium uppercase tracking-[0.06em] text-[#4A5A72] shrink-0"
            aria-label="Arbitrum network"
          >
            Arbitrum
          </span>
        </div>
      </header>

      <div className="px-3 pt-0 pb-[calc(1rem+env(safe-area-inset-bottom))]">
        {/* Error state */}
        {showError && (
          <section className="mb-4">
            <ErrorState
              title="Failed to load vault data"
              message="Unable to connect to the network. Please check your connection and try again."
              onRetry={() => handleStateChange('default')}
            />
          </section>
        )}

        {/* Balance & Actions */}
        <section className="mb-6">
          {showLoading ? (
            <LoadingBalanceState />
          ) : showEmptyBalance ? (
            <EmptyBalanceState onDeposit={() => setDepositDialogOpen(true)} />
          ) : (
            <>
              <BalanceCounter
                allocatedBalance={displayAllocated}
                apy={apy}
              />
              <div className="mt-4 flex gap-2">
                <DepositWithdrawDialog
                  variant="deposit"
                  balance={displayUsdc}
                  onDeposit={handleDeposit}
                  open={depositDialogOpen}
                  onOpenChange={setDepositDialogOpen}
                  showTrigger
                  className="flex-[2] min-w-0"
                />
                <Button
                  variant="outline"
                  size="lg"
                  disabled={withdrawModalOpen}
                  className="flex-[1] min-w-0 min-h-[44px] touch-manipulation rounded-[12px] bg-[#1A202C] border border-[#2D3748] hover:bg-[#252B36] hover:border-[#374151] text-[#38bdf8] [&_svg]:text-[#38bdf8] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] disabled:opacity-50"
                  onClick={() => setWithdrawModalOpen(true)}
                >
                  <ArrowUpFromLine className="size-4 shrink-0" strokeWidth={2} />
                  Withdraw
                </Button>
              </div>
              <WithdrawFlowModal
                open={withdrawModalOpen}
                onOpenChange={setWithdrawModalOpen}
                allocatedBalance={displayAllocated}
                usdcBalance={displayUsdc}
                allocations={allocations}
                onRedeem={handleRedeem}
                onWithdraw={handleWithdraw}
              />
            </>
          )}

          {!showLoading && showEmptyBalance && (
            <DepositWithdrawDialog
              variant="deposit"
              balance={displayUsdc}
              onDeposit={handleDeposit}
              open={depositDialogOpen}
              onOpenChange={setDepositDialogOpen}
              showTrigger={false}
            />
          )}
        </section>

        {/* Portfolio Summary */}
        {showLoading ? (
          <div className="mb-4">
            <LoadingPortfolioState />
          </div>
        ) : showEmptyPortfolio ? (
          <Card className="mb-4 rounded-[14px] border-[var(--border-subtle)] py-4">
            <CardContent className="pt-4 px-4">
              <EmptyPortfolioState onConfigure={() => setYieldBuilderOpen(true)} />
            </CardContent>
          </Card>
        ) : (
          displayAllocated > 0 && (
            <Card className="mb-4 rounded-[14px] border-[var(--border-subtle)] py-5 px-6">
              <CardContent className="p-0">
                <PortfolioAllocation allocations={allocations} balance={displayAllocated} />
              </CardContent>
            </Card>
          )
        )}

        {/* Custom Yield Builder */}
        {showEmptyBalance ? null : showLoading ? (
          <div className="space-y-2 rounded-[14px] border border-[var(--border-subtle)] p-4">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-full" />
            <div className="space-y-3 pt-2">
              {[1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14 w-full rounded-xl" />
              ))}
            </div>
          </div>
        ) : (
          <YieldAllocationBuilder
            allocations={allocations}
            onApply={handleApplyAllocations}
            open={yieldBuilderOpen}
            onOpenChange={setYieldBuilderOpen}
          />
        )}

        <p
          className="text-muted-foreground mt-3 text-center text-[11px]"
          role="note"
        >
          Fund security is contingent upon the integrity of underlying protocol smart contracts. Users assume all risks and should conduct due diligence before depositing.
        </p>
      </div>

      {/* State shortcuts for demo */}
      <StateShortcuts currentState={demoState} onStateChange={handleStateChange} />
    </main>
  )
}
