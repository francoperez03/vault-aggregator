'use client'

import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'
import { getYieldPerSecond } from '@/lib/vaults'

interface BalanceCounterProps {
  allocatedBalance: number
  apy: number
  className?: string
}

function formatBalance(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value)
}

export function BalanceCounter({ allocatedBalance, apy, className }: BalanceCounterProps) {
  const [displayBalance, setDisplayBalance] = useState(allocatedBalance)
  const yieldPerSecond = getYieldPerSecond(allocatedBalance, apy)

  useEffect(() => {
    setDisplayBalance(allocatedBalance)
  }, [allocatedBalance])

  useEffect(() => {
    if (allocatedBalance <= 0 || apy <= 0) return
    const interval = setInterval(() => {
      setDisplayBalance((prev) => prev + yieldPerSecond)
    }, 1000)
    return () => clearInterval(interval)
  }, [allocatedBalance, apy, yieldPerSecond])

  const intPart = Math.floor(displayBalance)
  const decPart = (displayBalance % 1).toFixed(4).slice(1)

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-[24px] border border-[var(--border-default)] px-6 py-7',
        'bg-gradient-to-br from-[#111C2A] to-[#0D1420]',
        'before:pointer-events-none before:absolute before:-top-20 before:-left-20 before:h-60 before:w-60 before:rounded-full before:bg-[radial-gradient(circle,var(--brand-glow)_0%,transparent_70%)]',
        'after:pointer-events-none after:absolute after:-bottom-14 after:-right-14 after:h-[180px] after:w-[180px] after:rounded-full after:bg-[radial-gradient(circle,var(--yield-glow)_0%,transparent_70%)]',
        className
      )}
    >
      <p className="font-sans text-[10px] font-semibold uppercase tracking-[0.15em] text-[var(--text-secondary)] mb-3">
        TOTAL BALANCE
      </p>
      <p className="font-sans text-[48px] font-semibold leading-none tracking-[-0.03em] text-[var(--text-primary)] mb-4">
        ${intPart.toLocaleString('en-US')}
        <span className="text-[32px] text-[var(--text-secondary)]">{decPart}</span>
      </p>
      <div
        className={cn(
          'inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1 font-mono text-[13px] font-semibold mb-4',
          'bg-[var(--yield-ghost)] text-[var(--yield)] border-[rgba(38,212,138,0.2)]',
          'animate-[apyPulse_2.5s_ease-in-out_infinite]'
        )}
      >
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--yield)] animate-[dotBlink_2.5s_ease-in-out_infinite]"
          aria-hidden
        />
        {apy.toFixed(2)}% APY ›
      </div>
      {allocatedBalance > 0 && (
        <div className="flex flex-col gap-3 border-t border-[var(--border-subtle)] pt-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--text-tertiary)]">
              Earnings / sec
            </span>
            <span className="font-sans text-[13px] font-medium text-[var(--yield)]">
              +${yieldPerSecond.toFixed(6)}/s
            </span>
          </div>
        </div>
      )}
    </div>
  )
}
