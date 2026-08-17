'use client'

import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react'
import type { TxPhase } from '@/components/vault-aggregator/transaction-state'

export interface MoveJob {
  id: number
  /** Human label for the strip: "Depositar $25.00". */
  label: string
  phase: TxPhase
}

interface MoveQueueValue {
  jobs: MoveJob[]
  /** Returns immediately. The screen stays usable while the job runs. */
  enqueue: (label: string, run: () => Promise<TxPhase>) => void
  dismiss: (id: number) => void
}

const MoveQueueContext = createContext<MoveQueueValue | null>(null)

const FAILED: TxPhase = { kind: 'reverted', reason: 'El movimiento no se pudo completar.' }

/**
 * A single-consumer async queue for money movements, so a deposit or a withdrawal stops holding
 * the screen hostage: you fire it, keep reading your position or line up the next one, and the
 * strip tells you where each is.
 *
 * Deliberately NOT a Web Worker. Signing needs the wallet provider, which only exists on the main
 * thread (`window.ethereum` in the browser, the ReactNativeWebView bridge inside Lemon), and the
 * work here is waiting on the network, not computing — a worker would buy nothing and cost the
 * ability to sign at all.
 *
 * Jobs run strictly one at a time, in order. Two transactions from the same EOA in flight together
 * race for the same nonce, and the loser reverts for a reason the user cannot act on.
 */
export function MoveQueueProvider({ children }: { children: ReactNode }) {
  const [jobs, setJobs] = useState<MoveJob[]>([])
  const pending = useRef<{ id: number; run: () => Promise<TxPhase> }[]>([])
  const draining = useRef(false)
  const nextId = useRef(1)

  const setPhase = useCallback((id: number, phase: TxPhase) => {
    setJobs((current) => current.map((job) => (job.id === id ? { ...job, phase } : job)))
  }, [])

  const drain = useCallback(async () => {
    if (draining.current) return
    draining.current = true
    try {
      while (pending.current.length > 0) {
        const next = pending.current.shift()
        if (!next) break
        setPhase(next.id, { kind: 'signing' })
        let phase: TxPhase
        try {
          phase = await next.run()
        } catch (error) {
          // Keep the thrown message: it is the only trace the user (or we) get of what failed.
          phase = error instanceof Error && error.message ? { kind: 'reverted', reason: error.message } : FAILED
        }
        setPhase(next.id, phase)
      }
    } finally {
      draining.current = false
    }
  }, [setPhase])

  const enqueue = useCallback(
    (label: string, run: () => Promise<TxPhase>) => {
      const id = nextId.current++
      setJobs((current) => [...current, { id, label, phase: { kind: 'confirm' } }])
      pending.current.push({ id, run })
      void drain()
    },
    [drain],
  )

  const dismiss = useCallback((id: number) => {
    setJobs((current) => current.filter((job) => job.id !== id))
  }, [])

  return (
    <MoveQueueContext.Provider value={{ jobs, enqueue, dismiss }}>{children}</MoveQueueContext.Provider>
  )
}

/** Outside a provider the queue degrades to running the job inline — a screen rendered in a test
 * or in isolation still works, it just does not get the strip. */
export function useMoveQueue(): MoveQueueValue {
  const value = useContext(MoveQueueContext)
  if (value) return value
  return {
    jobs: [],
    enqueue: (_label, run) => void run(),
    dismiss: () => {},
  }
}
