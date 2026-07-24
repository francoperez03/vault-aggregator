'use client'

import { Progress } from '@/components/ui/progress'
import { VAULTS } from '@/lib/vaults'
import type { Allocation } from '@/types'
import { cn } from '@/lib/utils'

const PROTOCOL_COLORS: Record<string, string> = {
  aave: 'var(--aave)',
  morpho: 'var(--morpho)',
  fluid: 'var(--fluid)',
  euler: 'var(--euler)',
}

interface PortfolioAllocationProps {
  allocations: Allocation
  balance: number
  className?: string
}

export function PortfolioAllocation({
  allocations,
  balance,
  className,
}: PortfolioAllocationProps) {
  const entries = VAULTS.filter((v) => (allocations[v.id] ?? 0) > 0)

  if (entries.length === 0 || balance <= 0) return null

  return (
    <div className={cn('space-y-2', className)}>
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-5">Current Allocation</h3>
      <div className="space-y-2">
        {entries.map((vault) => {
          const pct = allocations[vault.id] ?? 0
          const amount = (balance * pct) / 100

          return (
            <div key={vault.id} className="space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-sm">
                <div className="flex items-center gap-2 min-w-0">
                  {vault.logoUrl ? (
                    <div className="size-5 shrink-0 overflow-hidden rounded-full">
                      <img
                        src={vault.logoUrl}
                        alt={vault.protocol}
                        className="size-full object-cover"
                      />
                    </div>
                  ) : (
                    <div
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: PROTOCOL_COLORS[vault.id] ?? 'var(--muted)' }}
                    />
                  )}
                  <span className="font-semibold shrink-0">{vault.protocol}</span>
                  <span className="font-semibold shrink-0">{pct}%</span>
                </div>
                <div className="flex items-baseline gap-2 shrink-0">
                  <span className="font-medium tabular-nums">
                    ${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                  </span>
                  <span className="text-[11px] text-muted-foreground/80 font-normal tabular-nums">
                    {vault.apy}% APY
                  </span>
                </div>
              </div>
              <Progress value={pct} />
            </div>
          )
        })}
      </div>
    </div>
  )
}
