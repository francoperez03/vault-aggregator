import { describe, expect, it } from 'vitest'
import { reconcileWithdrawal } from './reconcile'

describe('reconcileWithdrawal', () => {
  it('completo: actual === requested, remaining es 0n', () => {
    const result = reconcileWithdrawal({ requested: 1_000n, balanceBefore: 5_000n, balanceAfter: 4_000n })
    expect(result).toEqual({ requested: 1_000n, actual: 1_000n, remaining: 0n, outcome: 'complete' })
  })

  it('parcial: actual < requested, remaining es la diferencia', () => {
    const result = reconcileWithdrawal({ requested: 1_000n, balanceBefore: 5_000n, balanceAfter: 4_400n })
    expect(result).toEqual({ requested: 1_000n, actual: 600n, remaining: 400n, outcome: 'partial' })
  })

  it('cero movimiento: actual === 0n nunca es "partial", es "none"', () => {
    const result = reconcileWithdrawal({ requested: 1_000n, balanceBefore: 5_000n, balanceAfter: 5_000n })
    expect(result.actual).toBe(0n)
    expect(result.outcome).toBe('none')
  })

  it('balanceAfter > balanceBefore lanza (lectura corrupta)', () => {
    expect(() => reconcileWithdrawal({ requested: 1_000n, balanceBefore: 4_000n, balanceAfter: 5_000n })).toThrow()
  })

  it('actual nunca supera el requested aunque el delta sea mayor (remaining nunca negativo)', () => {
    const result = reconcileWithdrawal({ requested: 500n, balanceBefore: 5_000n, balanceAfter: 4_000n })
    expect(result.actual).toBe(1_000n)
    expect(result.remaining).toBe(0n)
    expect(result.outcome).toBe('complete')
  })

  it('es pura: mismo input produce siempre el mismo output, sin efectos secundarios', () => {
    const input = { requested: 1_000n, balanceBefore: 5_000n, balanceAfter: 4_400n }
    const first = reconcileWithdrawal(input)
    const second = reconcileWithdrawal(input)
    expect(first).toEqual(second)
  })
})
