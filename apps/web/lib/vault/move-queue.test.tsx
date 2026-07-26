import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import { MoveQueueProvider, useMoveQueue } from './move-queue'
import type { TxPhase } from '@/components/vault-aggregator/transaction-state'

afterEach(cleanup)

/** Resolves only when the test says so, which is how job overlap becomes observable. */
function deferred() {
  let resolve!: (phase: TxPhase) => void
  const promise = new Promise<TxPhase>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

function Harness({ jobs }: { jobs: { label: string; run: () => Promise<TxPhase> }[] }) {
  const { jobs: queued, enqueue } = useMoveQueue()
  return (
    <>
      <button type="button" onClick={() => jobs.forEach((j) => enqueue(j.label, j.run))}>
        go
      </button>
      <ul>
        {queued.map((job) => (
          <li key={job.id}>{`${job.label}:${job.phase.kind}`}</li>
        ))}
      </ul>
    </>
  )
}

describe('MoveQueueProvider', () => {
  it('runs jobs one at a time, in order — two txs in flight would race the same nonce', async () => {
    const first = deferred()
    const second = deferred()
    const secondStarted = vi.fn()
    const jobs = [
      { label: 'a', run: () => first.promise },
      {
        label: 'b',
        run: () => {
          secondStarted()
          return second.promise
        },
      },
    ]

    render(
      <MoveQueueProvider>
        <Harness jobs={jobs} />
      </MoveQueueProvider>,
    )

    await act(async () => {
      screen.getByRole('button', { name: 'go' }).click()
    })

    expect(screen.getByText('a:signing')).toBeInTheDocument()
    expect(secondStarted).not.toHaveBeenCalled()

    await act(async () => {
      first.resolve({ kind: 'success', amount: 1n })
    })

    expect(screen.getByText('a:success')).toBeInTheDocument()
    expect(secondStarted).toHaveBeenCalledOnce()

    await act(async () => {
      second.resolve({ kind: 'reverted', reason: 'nope' })
    })
    expect(screen.getByText('b:reverted')).toBeInTheDocument()
  })

  it('a thrown job lands as a failure instead of stalling the queue', async () => {
    const jobs = [
      { label: 'boom', run: () => Promise.reject(new Error('x')) },
      { label: 'after', run: () => Promise.resolve<TxPhase>({ kind: 'success', amount: 1n }) },
    ]

    render(
      <MoveQueueProvider>
        <Harness jobs={jobs} />
      </MoveQueueProvider>,
    )

    await act(async () => {
      screen.getByRole('button', { name: 'go' }).click()
    })

    expect(screen.getByText('boom:reverted')).toBeInTheDocument()
    expect(screen.getByText('after:success')).toBeInTheDocument()
  })
})
