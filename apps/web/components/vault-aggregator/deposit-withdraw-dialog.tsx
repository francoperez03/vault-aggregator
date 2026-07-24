'use client'

import { useState } from 'react'
import { toast } from 'sonner'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { ArrowDownToLine, ArrowUpFromLine, Delete, RotateCcw } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Preset amounts for quick deposit (common DeFi pattern) */
const DEPOSIT_PRESETS = [100, 500, 1000, 5000] as const

interface DepositWithdrawDialogProps {
  variant: 'deposit' | 'redeem' | 'withdraw'
  balance: number
  onDeposit?: (amount: number) => void
  onRedeem?: (amount: number) => void
  onWithdraw?: (amount: number) => void
  disabled?: boolean
  /** Controlled open state - when provided, dialog is controlled externally */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** When false, no trigger button is shown (use with controlled open for programmatic opening) */
  showTrigger?: boolean
  /** Optional className for the trigger button wrapper */
  className?: string
}

export function DepositWithdrawDialog({
  variant,
  balance,
  onDeposit,
  onRedeem,
  onWithdraw,
  disabled,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
  showTrigger = true,
  className,
}: DepositWithdrawDialogProps) {
  const [amount, setAmount] = useState('')
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen

  const numAmount = parseFloat(amount) || 0
  const isValid =
    numAmount > 0 &&
    (variant === 'deposit' ? true : numAmount <= balance)

  const handleSubmit = () => {
    if (!isValid) return
    if (variant === 'deposit') {
      onDeposit?.(numAmount)
      setAmount('')
      setOpen(false)
      // Toast after dialog closes so it's visible above the overlay
      setTimeout(() => {
        toast.success(`Deposit successful · $${numAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`)
      }, 200)
    } else {
      if (variant === 'redeem') onRedeem?.(numAmount)
      else onWithdraw?.(numAmount)
      setAmount('')
      setOpen(false)
    }
  }

  const handleMax = () => {
    setAmount((variant === 'withdraw' || variant === 'redeem') ? balance.toString() : '')
  }

  const handleKeypad = (key: string) => {
    if (key === '.') {
      if (amount.includes('.')) return
      setAmount((prev) => (prev === '' ? '0.' : prev + '.'))
      return
    }
    if (key === 'backspace') {
      setAmount((prev) => prev.slice(0, -1))
      return
    }
    // Avoid leading zeros (except "0." or "0")
    let next = amount + key
    if (amount === '0' && key !== '.') next = key
    const [int, dec] = next.split('.')
    if (dec && dec.length > 2) return
    if (int.length > 12) return
    setAmount(next)
  }

  const label = variant === 'deposit' ? 'Deposit' : variant === 'redeem' ? 'Redeem' : 'Withdraw'
  const Icon = variant === 'deposit' ? ArrowDownToLine : variant === 'redeem' ? RotateCcw : ArrowUpFromLine

  const trigger = showTrigger ? (
    <DialogTrigger asChild>
      <Button
        variant={variant === 'deposit' ? 'deposit' : 'outline'}
        size="lg"
        disabled={disabled}
        className={cn('min-h-[44px] touch-manipulation', className ?? 'min-w-0 flex-1 basis-0')}
      >
        <Icon className="size-4" />
        {label}
      </Button>
    </DialogTrigger>
  ) : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {trigger}
      <DialogContent className="touch-manipulation">
        <DialogHeader>
          <DialogTitle>{label} USDC</DialogTitle>
          <DialogDescription>
            {variant === 'deposit'
              ? 'Deposit USDC from Lemon to start earning yield in vaults.'
              : variant === 'redeem'
                ? `Withdraw funds from vaults to your available USDC balance. In staking: $${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`
                : `Withdraw available USDC to your Lemon account (outside the miniapp). Available: $${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-3">
            {/* Quick presets — DeFi pattern (above input) */}
            <div className="flex flex-wrap gap-1.5">
              {variant === 'deposit' ? (
                DEPOSIT_PRESETS.map((val) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setAmount(val.toString())}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-all touch-manipulation',
                      'bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
                      'hover:border-[var(--brand)]/40 hover:text-[var(--text-primary)]',
                      'active:scale-[0.97]',
                      Math.abs(numAmount - val) < 0.01 && 'border-[var(--brand)]/60 bg-[var(--brand-ghost)] text-[var(--brand)]'
                    )}
                  >
                    ${val >= 1000 ? `${val / 1000}K` : val}
                  </button>
                ))
              ) : (variant === 'redeem' || variant === 'withdraw') && (
                balance > 0 && (
                  <>
                    {[25, 50, 75].map((pct) => {
                      const val = (balance * pct) / 100
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => setAmount(val.toFixed(2))}
                          className={cn(
                            'px-3 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-all touch-manipulation',
                            'bg-[var(--bg-overlay)] text-[var(--text-secondary)] border border-[var(--border-subtle)]',
                            'hover:border-[var(--brand)]/40 hover:text-[var(--text-primary)]',
                            'active:scale-[0.97]',
                            Math.abs(numAmount - val) < 0.01 && 'border-[var(--brand)]/60 bg-[var(--brand-ghost)] text-[var(--brand)]'
                          )}
                        >
                          {pct}%
                        </button>
                      )
                    })}
                    <button
                      type="button"
                      onClick={handleMax}
                      className={cn(
                        'px-3 py-1.5 rounded-lg text-xs font-semibold tabular-nums transition-all touch-manipulation',
                        'bg-[var(--brand-ghost)] text-[var(--brand)] border border-[var(--brand)]/40',
                        'hover:bg-[var(--brand-ghost)] hover:border-[var(--brand)]/60',
                        'active:scale-[0.97]',
                        balance > 0 && Math.abs(numAmount - balance) < 0.01 && 'ring-1 ring-[var(--brand)]/50'
                      )}
                    >
                      MAX
                    </button>
                  </>
                )
              )}
            </div>

            {/* Amount input — DeFi card style */}
            <div className="flex justify-between items-center">
              <label className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                Amount
              </label>
              {(variant === 'redeem' || variant === 'withdraw') && (
                <span className="text-xs text-[var(--text-secondary)]">
                  {variant === 'redeem' ? 'In staking' : 'Available'}: <span className="font-mono text-[var(--text-primary)]">${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</span>
                </span>
              )}
            </div>
            <div
              className="flex items-center gap-2 min-h-[56px] rounded-xl border border-[var(--border-default)] bg-[var(--bg-surface)] px-4 py-3 ring-1 ring-[var(--border-subtle)]/50"
              style={{ touchAction: 'manipulation' }}
            >
              <span className="text-[var(--text-tertiary)] font-mono text-lg">$</span>
              <span className="font-mono text-2xl font-semibold tracking-tight text-[var(--text-primary)] tabular-nums flex-1 min-w-0 overflow-hidden text-ellipsis">
                {amount || '0'}
              </span>
              <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-[var(--bg-overlay)] text-[var(--text-secondary)] text-xs font-semibold border border-[var(--border-subtle)]">
                USDC
              </span>
            </div>

            {/* Numeric keypad — DeFi-friendly styling */}
            <div className="grid grid-cols-3 gap-1.5">
              {['7', '8', '9', '4', '5', '6', '1', '2', '3', '.', '0', 'backspace'].map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => handleKeypad(key)}
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
          </div>
          <Button
            variant={isValid ? 'deposit' : 'outline'}
            className="w-full min-h-[48px] touch-manipulation"
            onClick={handleSubmit}
            disabled={!isValid}
          >
            {label} {numAmount > 0 && `$${numAmount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
