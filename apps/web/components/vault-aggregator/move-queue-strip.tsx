'use client'

import { useState } from 'react'
import { Check, Copy, Loader2, X } from 'lucide-react'
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
              'rounded-[8px] flex items-center gap-2 border-[1.5px] px-3 py-2 font-mono text-xs',
              done
                ? 'border-[var(--yield)]/40 bg-[var(--yield)]/10 text-[var(--text-primary)]'
                : failed
                  ? 'border-[var(--danger)]/40 bg-[var(--danger)]/10 text-[var(--text-primary)]'
                  : 'border-[var(--border-default)] bg-[var(--bg-surface)] text-[var(--text-secondary)]',
            )}
          >
            {done ? (
              <Check className="size-4 shrink-0 text-[var(--yield)]" aria-hidden="true" />
            ) : failed ? (
              <X className="size-4 shrink-0 text-[var(--danger)]" aria-hidden="true" />
            ) : (
              <Loader2 className="size-4 shrink-0 animate-spin motion-reduce:animate-none" aria-hidden="true" />
            )}

            {/* A revert reason is the one thing here the user may need to send someone: it wraps
                in full and can be copied. Everything else is a single truncated line. */}
            <span className={cn('min-w-0 flex-1', phase.kind === 'reverted' ? 'break-words' : 'truncate')}>
              {label}
              {failed && phase.kind === 'reverted' ? ` · ${phase.reason}` : ''}
              {failed && phase.kind === 'rejected' ? ' · cancelado' : ''}
              {failed && phase.kind === 'timeout' ? ' · sin confirmar' : ''}
            </span>

            {phase.kind === 'reverted' && phase.reason && (
              <CopyButton text={`${label} · ${phase.reason}`} label={`Copiar el error de ${label}`} />
            )}

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

/** Copies the error to the clipboard and says so for a moment; no clipboard API (old WebViews)
 * degrades to a no-op instead of a crash. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      aria-label={label}
      onClick={async () => {
        try {
          await navigator.clipboard?.writeText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        } catch {
          // ponytail: no fallback path; the text stays visible in the strip to copy by hand.
        }
      }}
      className="shrink-0 rounded p-1 text-[var(--text-secondary)]"
    >
      {copied ? <Check className="size-3.5 text-[var(--yield)]" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
    </button>
  )
}
