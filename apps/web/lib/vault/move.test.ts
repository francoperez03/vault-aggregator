import { describe, expect, it } from 'vitest'
import { currentPoolBps, previewMove } from './move'

const U = 1_000_000n // 1 USDC

describe('currentPoolBps', () => {
  it('is the pool share of wallet+pool', () => {
    expect(currentPoolBps(75n * U, 25n * U)).toBe(2500n)
  })

  it('is 0 when the user holds nothing anywhere', () => {
    expect(currentPoolBps(0n, 0n)).toBe(0n)
  })
})

describe('previewMove', () => {
  it('resting on the current split moves nothing, rounding included', () => {
    // 1/3 in the pool floors to 3333 bps; opening the screen must not offer to move the remainder.
    const move = previewMove(20n * U, 10n * U, currentPoolBps(20n * U, 10n * U))
    expect(move.kind).toBe('none')
    expect(move.amount).toBe(0n)
  })

  it('right of rest is a deposit of the difference', () => {
    const move = previewMove(50n * U, 50n * U, 7500n)
    expect(move.kind).toBe('deposit')
    expect(move.amount).toBe(25n * U)
    expect(move.poolUsdc).toBe(75n * U)
    expect(move.walletUsdc).toBe(25n * U)
  })

  it('all the way right deposits the whole wallet, never more', () => {
    const move = previewMove(50n * U, 50n * U, 10_000n)
    expect(move.amount).toBe(50n * U)
    expect(move.walletUsdc).toBe(0n)
  })

  it('left of rest is a withdrawal, expressed as a fraction of the position', () => {
    const move = previewMove(50n * U, 50n * U, 2500n)
    expect(move.kind).toBe('withdraw')
    expect(move.amount).toBe(25n * U)
    expect(move.withdrawBps).toBe(5000n)
  })

  it('all the way left redeems a literal 10000 bps, never a floored 9999', () => {
    // 1 wei of dust in the pool would floor any computed ratio; the extreme must stay exact.
    const move = previewMove(3n * U, 1n * U + 1n, 0n)
    expect(move.kind).toBe('withdraw')
    expect(move.withdrawBps).toBe(10_000n)
  })

  it('does nothing when there is no money at all', () => {
    expect(previewMove(0n, 0n, 10_000n).kind).toBe('none')
  })

  it('does nothing when the move rounds down to zero', () => {
    // A sub-1-bps nudge on a tiny position: better a dead slider than a dust transaction.
    expect(previewMove(1n, 1n, 5001n).kind).toBe('none')
  })
})
