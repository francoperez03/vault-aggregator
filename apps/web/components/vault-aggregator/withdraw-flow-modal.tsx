'use client'

import { useState, useCallback, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import type { Allocation } from '@/types'
import { Delete, Check, ArrowUpFromLine, Info } from 'lucide-react'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

const PRESET_PERCENTS = [25, 50, 75] as const

interface WithdrawFlowModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  allocatedBalance: number
  usdcBalance: number
  allocations: Allocation
  onRedeem: (amount: number) => void
  onWithdraw: (amount: number) => void
}

export function WithdrawFlowModal({
  open,
  onOpenChange,
  allocatedBalance,
  usdcBalance,
  allocations,
  onRedeem,
  onWithdraw,
}: WithdrawFlowModalProps) {
  const [step, setStep] = useState<1 | 2>(1)
  const [redeemAmount, setRedeemAmount] = useState('')
  const [redeemedAmountForStep2, setRedeemedAmountForStep2] = useState(0)
  const [isConfirming, setIsConfirming] = useState(false)

  useEffect(() => {
    if (open) {
      setStep(1)
      setRedeemAmount('')
      setRedeemedAmountForStep2(0)
      setIsConfirming(false)
    }
  }, [open])

  const handleOpenChange = useCallback(
    (next: boolean) => {
      if (!next && step === 2) return // Block close on step 2; must complete withdraw
      onOpenChange(next)
    },
    [onOpenChange, step]
  )

  const handleKeypad = useCallback(
    (key: string, setAmount: (updater: (prev: string) => string) => void) => {
      if (key === '.') {
        setAmount((prev) => (prev.includes('.') ? prev : prev === '' ? '0.' : prev + '.'))
        return
      }
      if (key === 'backspace') {
        setAmount((prev) => prev.slice(0, -1))
        return
      }
      setAmount((prev) => {
        let next = prev + key
        if (prev === '0' && key !== '.') next = key
        const [int, dec] = next.split('.')
        if (dec && dec.length > 2) return prev
        if (int.length > 12) return prev
        return next
      })
    },
    []
  )

  const numRedeem = parseFloat(redeemAmount) || 0
  const canRedeem = numRedeem > 0 && numRedeem <= allocatedBalance

  const handleRedeem = async () => {
    if (!canRedeem) return
    setIsConfirming(true)
    await new Promise((r) => setTimeout(r, 1200))
    onRedeem(numRedeem)
    setRedeemedAmountForStep2(numRedeem)
    setIsConfirming(false)
    setRedeemAmount('')
    setStep(2)
  }

  const handleWithdraw = () => {
    onWithdraw(redeemedAmountForStep2)
    const amountStr = redeemedAmountForStep2.toLocaleString('en-US', { minimumFractionDigits: 2 })
    toast.success(`Funds sent to Lemon · $${amountStr}`)
    setRedeemedAmountForStep2(0)
    onOpenChange(false)
  }

  const Keypad = ({ amount, setAmount }: { amount: string; setAmount: (s: string) => void }) => (
    <div className="grid grid-cols-3 gap-1.5">
      {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'backspace'].map((key) => (
        <button
          key={key}
          type="button"
          onClick={() => handleKeypad(key, setAmount as (u: (p: string) => string) => void)}
          className={cn(
            'min-h-[48px] rounded-xl font-mono text-lg font-medium tabular-nums touch-manipulation',
            'transition-all duration-150 ease-out active:scale-[0.96]',
            'border border-[var(--border-subtle)] bg-[var(--bg-overlay)]',
            'hover:bg-[var(--bg-elevated)] hover:border-[var(--border-default)]',
            'active:bg-[var(--border-subtle)]',
            key === 'backspace'
              ? 'text-[var(--text-secondary)] col-span-1 flex items-center justify-center'
              : 'text-[var(--text-primary)]'
          )}
        >
          {key === 'backspace' ? <Delete className="size-5 shrink-0" strokeWidth={2.5} /> : key}
        </button>
      ))}
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        className="touch-manipulation text-left bg-[#111418] border-[var(--border-subtle)] max-h-[90dvh] overflow-y-auto"
        showCloseButton={step === 1}
        onInteractOutside={(e) => { if (step === 2) e.preventDefault() }}
        onEscapeKeyDown={(e) => { if (step === 2) e.preventDefault() }}
      >
        {/* Step indicator */}
        <div className="flex w-full items-center justify-start gap-2 pb-4">
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'size-6 rounded-full flex items-center justify-center flex-shrink-0',
                step === 1 ? 'bg-[#12AAFF] text-[#0A0C0F]' : 'bg-[#26D48A] text-[#0A0C0F]'
              )}
            >
              {step > 1 ? <Check className="size-3.5" strokeWidth={3} /> : '1'}
            </span>
            <span className={cn('text-xs font-semibold', step >= 1 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
              Redeem
            </span>
          </div>
          <div className="h-px w-8 bg-[var(--border-subtle)]" />
          <div className="flex items-center gap-1.5">
            <span
              className={cn(
                'size-6 rounded-full flex items-center justify-center flex-shrink-0',
                step === 2 ? 'bg-[#12AAFF] text-[#0A0C0F]' : 'bg-[var(--bg-overlay)] border border-[var(--border-subtle)] text-[var(--text-tertiary)]'
              )}
            >
              2
            </span>
            <span className={cn('text-xs font-semibold', step === 2 ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]')}>
              Send to Lemon
            </span>
          </div>
        </div>

        {step === 1 && (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold text-[var(--text-primary)]">Redeem from vaults</DialogTitle>
              <DialogDescription className="text-[var(--text-secondary)]">
                Move your funds from yield vaults to your available balance.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              {/* Quick amount selector */}
              <div className="flex flex-wrap gap-1.5">
                {PRESET_PERCENTS.map((pct) => {
                  const val = (allocatedBalance * pct) / 100
                  return (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setRedeemAmount(val.toFixed(2))}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-all touch-manipulation',
                        'bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
                        'hover:border-[var(--brand)]/40 hover:text-[var(--text-primary)]',
                        'active:scale-[0.97]',
                        Math.abs(numRedeem - val) < 0.01 && 'border-[var(--brand)]/60 bg-[var(--brand-ghost)] text-[var(--brand)]'
                      )}
                    >
                      {pct}%
                    </button>
                  )
                })}
                <button
                  type="button"
                  onClick={() => setRedeemAmount(allocatedBalance.toString())}
                  className={cn(
                    'px-3 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-all touch-manipulation',
                    'bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
                    'hover:border-[var(--brand)]/40 hover:text-[var(--text-primary)]',
                    'active:scale-[0.97]',
                    Math.abs(numRedeem - allocatedBalance) < 0.01 && 'border-[var(--brand)]/60 bg-[var(--brand-ghost)] text-[var(--brand)] ring-1 ring-[var(--brand)]/50'
                  )}
                >
                  MAX
                </button>
              </div>

              {/* Amount display */}
              <div className="flex justify-between items-center">
                <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">Amount</label>
                <span className="text-xs text-[var(--text-secondary)]">
                  Available in vaults: <span className="font-mono text-[var(--text-primary)]">${allocatedBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </span>
              </div>
              <div
                className="flex items-center gap-2 min-h-[56px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 ring-1 ring-[var(--border-subtle)]/50"
                style={{ touchAction: 'manipulation' }}
              >
                <span className="text-[var(--text-tertiary)] font-mono text-lg">$</span>
                <span className="font-mono text-2xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums flex-1 min-w-0 overflow-hidden text-ellipsis">
                  {redeemAmount || '0'}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--bg-overlay)] text-[var(--text-secondary)] text-xs font-semibold border border-[var(--border-subtle)]">
                  USDC
                </span>
              </div>

              <Keypad amount={redeemAmount} setAmount={setRedeemAmount} />

              <p className="flex items-start gap-2 text-xs text-[var(--text-secondary)] bg-[var(--bg-overlay)] rounded-xl px-4 py-3 border border-[var(--border-subtle)]">
                <Info className="size-4 shrink-0 mt-0.5 text-[var(--brand)]" />
                <span>Once you redeem, you must complete the withdrawal to Lemon. You won&apos;t be able to close until the full flow is done.</span>
              </p>

              <Button
                variant={canRedeem && !isConfirming ? 'deposit' : 'outline'}
                className="w-full min-h-[48px] touch-manipulation"
                onClick={handleRedeem}
                disabled={!canRedeem || isConfirming}
              >
                {isConfirming ? (
                  <span className="flex items-center gap-2">
                    <span className="size-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                    Confirming transaction...
                  </span>
                ) : (
                  `Redeem ${numRedeem > 0 ? `$${numRedeem.toLocaleString('en-US', { minimumFractionDigits: 2 })}` : ''}`
                )}
              </Button>
            </div>
          </>
        )}

        {step === 2 && (
          <>
            <DialogHeader>
              <DialogTitle className="text-lg font-semibold text-[var(--text-primary)]">Send to Lemon</DialogTitle>
              <DialogDescription className="text-[var(--text-secondary)]">
                Withdraw the redeemed amount to your Lemon account.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-2">
              <div
                className="flex items-center gap-2 min-h-[56px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 ring-1 ring-[var(--border-subtle)]/50"
                style={{ touchAction: 'manipulation' }}
              >
                <span className="text-[var(--text-tertiary)] font-mono text-lg">$</span>
                <span className="font-mono text-2xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums flex-1 min-w-0 overflow-hidden text-ellipsis">
                  {redeemedAmountForStep2.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                </span>
                <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--bg-overlay)] text-[var(--text-secondary)] text-xs font-semibold border border-[var(--border-subtle)]">
                  USDC
                </span>
              </div>

              <Button
                variant="outline"
                size="lg"
                className="w-full min-h-[44px] touch-manipulation rounded-[12px] bg-[#1A202C] border border-[#2D3748] hover:bg-[#252B36] hover:border-[#374151] text-[#38bdf8] [&_svg]:text-[#38bdf8] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
                onClick={handleWithdraw}
              >
                <ArrowUpFromLine className="size-4 shrink-0" strokeWidth={2} />
                Withdraw
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
