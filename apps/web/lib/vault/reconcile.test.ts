import { describe, expect, it } from 'vitest'
import { reconcileWithdrawal } from './reconcile'

describe('reconcileWithdrawal', () => {
  it('complete: actual === requested, remaining is 0n', () => {
    const result = reconcileWithdrawal({ requested: 1_000n, balanceBefore: 5_000n, balanceAfter: 4_000n })
    expect(result).toEqual({ requested: 1_000n, actual: 1_000n, remaining: 0n, outcome: 'complete' })
  })

  it('partial: actual < requested, remaining is the difference', () => {
    const result = reconcileWithdrawal({ requested: 1_000n, balanceBefore: 5_000n, balanceAfter: 4_400n })
    expect(result).toEqual({ requested: 1_000n, actual: 600n, remaining: 400n, outcome: 'partial' })
  })

  it('zero movement: actual === 0n is never "partial", it is "none"', () => {
    const result = reconcileWithdrawal({ requested: 1_000n, balanceBefore: 5_000n, balanceAfter: 5_000n })
    expect(result.actual).toBe(0n)
    expect(result.outcome).toBe('none')
  })

  it('balanceAfter > balanceBefore lanza (lectura corrupta)', () => {
    expect(() => reconcileWithdrawal({ requested: 1_000n, balanceBefore: 4_000n, balanceAfter: 5_000n })).toThrow()
  })

  it('actual never exceeds requested even when the delta is larger (remaining never negative)', () => {
    const result = reconcileWithdrawal({ requested: 500n, balanceBefore: 5_000n, balanceAfter: 4_000n })
    expect(result.actual).toBe(1_000n)
    expect(result.remaining).toBe(0n)
    expect(result.outcome).toBe('complete')
  })

  it('is pure: same input always produces the same output, no side effects', () => {
    const input = { requested: 1_000n, balanceBefore: 5_000n, balanceAfter: 4_400n }
    const first = reconcileWithdrawal(input)
    const second = reconcileWithdrawal(input)
    expect(first).toEqual(second)
  })
})
