'use client'

import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
  EmptyContent,
} from '@/components/ui/empty'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Wallet, TrendingUp, AlertTriangle, RefreshCw } from 'lucide-react'

interface EmptyBalanceStateProps {
  onDeposit?: () => void
}

const VAULT_TAGS = [
  { name: 'Aave 4.2%', color: 'bg-[#6366F1]' },
  { name: 'Morpho 5.8%', color: 'bg-[#3B82F6]' },
  { name: 'Fluid 4.9%', color: 'bg-[#22D3EE]' },
  { name: 'Euler 5.3%', color: 'bg-[#8A9BB8]' },
] as const

export function EmptyBalanceState({ onDeposit }: EmptyBalanceStateProps) {
  return (
    <Empty className="rounded-[14px] border-[var(--border-subtle)] border-dashed py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="rounded-full bg-[var(--yield-ghost)] [&_svg]:text-[var(--yield)]">
          <Wallet className="size-6" />
        </EmptyMedia>
        <EmptyTitle>Start earning yield</EmptyTitle>
        <EmptyDescription>
          Deposit USDC and allocate it across curated vaults in one transaction.
        </EmptyDescription>
      </EmptyHeader>
      {onDeposit && (
        <EmptyContent className="flex flex-col items-center gap-4">
          <Button variant="deposit" onClick={onDeposit} size="lg" className="min-h-[44px]">
            Deposit USDC
          </Button>
          <div className="mt-8 flex flex-wrap justify-center gap-2">
            {VAULT_TAGS.map((tag) => (
              <span
                key={tag.name}
                className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-subtle)] bg-[var(--bg-overlay)] px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)]"
              >
                <span className={`size-1.5 shrink-0 rounded-full ${tag.color}`} />
                {tag.name}
              </span>
            ))}
          </div>
        </EmptyContent>
      )}
    </Empty>
  )
}

interface EmptyPortfolioStateProps {
  onConfigure?: () => void
}

export function EmptyPortfolioState({ onConfigure }: EmptyPortfolioStateProps) {
  return (
    <Empty className="rounded-[14px] border-[var(--border-subtle)] border-dashed py-10">
      <EmptyHeader>
        <EmptyMedia variant="icon" className="rounded-full bg-[var(--yield-ghost)] [&_svg]:text-[var(--yield)]">
          <TrendingUp className="size-6" />
        </EmptyMedia>
        <EmptyTitle>Configure your allocation</EmptyTitle>
        <EmptyDescription>
          Your balance is ready. Use the Custom Yield Builder below to distribute capital across vaults and start earning.
        </EmptyDescription>
      </EmptyHeader>
      {onConfigure && (
        <EmptyContent>
          <Button variant="outline" onClick={onConfigure} size="lg" className="min-h-[44px]">
            Open Yield Builder
          </Button>
        </EmptyContent>
      )}
    </Empty>
  )
}

interface ErrorStateProps {
  title?: string
  message?: string
  onRetry?: () => void
}

export function ErrorState({
  title = 'Something went wrong',
  message = "We couldn't load your data. Please check your connection and try again.",
  onRetry,
}: ErrorStateProps) {
  return (
    <Alert variant="destructive" className="rounded-[14px] border-destructive/50">
      <AlertTriangle className="size-4" />
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <p className="mb-3">{message}</p>
        {onRetry && (
          <Button variant="outline" size="sm" onClick={onRetry} className="border-destructive/50 text-destructive hover:bg-destructive/10">
            <RefreshCw className="mr-2 size-3.5" />
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  )
}

export function LoadingBalanceState() {
  return (
    <div className="relative overflow-hidden rounded-[24px] border border-[var(--border-default)] px-7 py-9 bg-gradient-to-br from-[#111C2A] to-[#0D1420]">
      <Skeleton className="mb-3 h-3 w-24" />
      <Skeleton className="mb-4 h-12 w-32" />
      <Skeleton className="mb-5 h-8 w-24 rounded-full" />
    </div>
  )
}

export function LoadingPortfolioState() {
  return (
    <div className="space-y-3 rounded-[14px] border border-[var(--border-subtle)] p-4">
      <Skeleton className="h-3 w-32" />
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-1">
            <div className="flex justify-between">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-4 w-16" />
            </div>
            <Skeleton className="h-1.5 w-full rounded-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
