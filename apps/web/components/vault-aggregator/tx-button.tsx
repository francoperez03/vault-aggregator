'use client'

import { useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { TxPhase } from '@/components/vault-aggregator/transaction-state'
import type { TxStage } from '@/hooks/useVaultWrite'

/** What the button is living through right now. `error` keeps the click alive as a retry;
 * `success` and `error` walk themselves back to `idle`. */
export type TxButtonStage = 'idle' | 'confirming' | 'pending' | 'success' | 'error'

const SUCCESS_RESET_MS = 2500
const ERROR_RESET_MS = 6000

/** Derives the button stage from the caller's TxPhase + the write hook's txStage. A `rejected`
 * phase maps straight to idle: cancelling the wallet sheet was the user's own act, not an error
 * the button should scold them for. */
export function toButtonStage(phase: TxPhase | null, txStage: TxStage): TxButtonStage {
  if (phase?.kind === 'signing') return txStage === 'pending' ? 'pending' : 'confirming'
  if (phase?.kind === 'pending') return 'pending'
  if (phase?.kind === 'success') return 'success'
  if (phase?.kind === 'reverted' || phase?.kind === 'timeout') return 'error'
  return 'idle'
}

interface TxButtonProps {
  label: string
  /** Shown during the brief success beat; falls back to "¡Listo!". */
  successLabel?: string
  stage: TxButtonStage
  onClick: () => void
  /** Called when a success/error beat finishes and the button goes back to normal. */
  onSettled?: () => void
  disabled?: boolean
  variant?: 'default' | 'outline'
  className?: string
}

/**
 * The lifecycle button for every action that fires a transaction: rest → wallet confirmation →
 * tx in flight → success/failure → back to normal. One vocabulary for the whole app; the
 * caller derives `stage` (usually via `toButtonStage`) and this component owns the rendering
 * and the walk back to idle.
 */
export function TxButton({
  label,
  successLabel = '¡Listo!',
  stage,
  onClick,
  onSettled,
  disabled = false,
  variant = 'default',
  className,
}: TxButtonProps) {
  // Terminal beats (success/error) hold on screen briefly even after the caller's phase moves
  // on, then release. `held` is what actually renders.
  const [held, setHeld] = useState<TxButtonStage>(stage)
  const settleTimer = useRef<number | null>(null)

  useEffect(() => {
    setHeld(stage)
    if (stage !== 'success' && stage !== 'error') return
    settleTimer.current = window.setTimeout(
      () => {
        setHeld('idle')
        onSettled?.()
      },
      stage === 'success' ? SUCCESS_RESET_MS : ERROR_RESET_MS,
    )
    return () => {
      if (settleTimer.current) window.clearTimeout(settleTimer.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage])

  const busy = held === 'confirming' || held === 'pending'

  return (
    <Button
      type="button"
      size="lg"
      variant={variant}
      className={cn(
        'w-full',
        held === 'success' &&
          'border-[var(--yield)]/50 bg-[var(--yield)]/10 text-[var(--yield)] disabled:opacity-100',
        held === 'error' && 'border-[var(--danger)]/60 text-[var(--danger)]',
        className,
      )}
      disabled={disabled || busy || held === 'success'}
      aria-live="polite"
      onClick={onClick}
    >
      {busy && <Loader2 className="animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {held === 'success' && <Check aria-hidden="true" />}
      {held === 'confirming'
        ? 'Confirmá en tu wallet…'
        : held === 'pending'
          ? 'Esperando la transacción…'
          : held === 'success'
            ? successLabel
            : held === 'error'
              ? 'Falló · Reintentar'
              : label}
    </Button>
  )
}
