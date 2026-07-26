'use client'

import { Check, Loader2, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMoveQueue } from '@/lib/vault/move-queue'

/**
 * Where a movement lives once it leaves the screen that started it: a strip pinned above the nav,
 * one line per job, visible from any route. It is the counterpart to the queue being asynchronous
 * — work you can walk away from still has to be work you can see.
 *
 * Nothing here auto-dismisses on failure. A movement that reverted is news the user has to
 * acknowledge; only the successful ones can be waved off.
 */
export function MoveQueueStrip() {
  const { jobs, dismiss } = useMoveQueue()
  if (jobs.length === 0) return null

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 left-1/2 z-40 flex w-full max-w-[430px] -translate-x-1/2 flex-col gap-1.5 px-4"
    >
      {jobs.map(({ id, label, phase }) => {
        const done = phase.kind === 'success'
        const failed = phase.kind === 'reverted' || phase.kind === 'rejected' || phase.kind === 'timeout'
        return (
          <div
            key={id}
            className={cn(
              'flex items-center gap-2 rounded-[12px] border px-3 py-2 text-xs',
              done
                ? 'border-[var(--yield)]/40 bg-[var(--yield)]/10 text-[var(--text-primary)]'
                : failed
                  ? 'border-[var(--error)]/40 bg-[var(--error)]/10 text-[var(--text-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
            )}
          >
            {done ? (
              <Check className="size-4 shrink-0 text-[var(--yield)]" aria-hidden="true" />
            ) : failed ? (
              <X className="size-4 shrink-0 text-[var(--error)]" aria-hidden="true" />
            ) : (
              <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}

            <span className="min-w-0 flex-1 truncate">
              {label}
              {failed && phase.kind === 'reverted' ? ` · ${phase.reason}` : ''}
              {failed && phase.kind === 'rejected' ? ' · cancelado' : ''}
              {failed && phase.kind === 'timeout' ? ' · sin confirmar' : ''}
            </span>

            <button
              type="button"
              aria-label={`Descartar ${label}`}
              onClick={() => dismiss(id)}
              className="shrink-0 rounded p-1 text-[var(--text-secondary)]"
            >
              <X className="size-3.5" aria-hidden="true" />
            </button>
          </div>
        )
      })}
    </div>
  )
}
