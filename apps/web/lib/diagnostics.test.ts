import { describe, expect, it } from 'vitest'
import { describeFailure, safeJson } from './diagnostics'

describe('describeFailure', () => {
  it('serializes request, raw response and context, bigints included', () => {
    const text = describeFailure({
      request: { contracts: [{ functionParams: [1_000_000n] }] },
      response: { result: 'FAILED', error: undefined },
      context: { sdk: 'callSmartContract' },
    })
    expect(text).toContain('"sdk": "callSmartContract"')
    expect(text).toContain('"1000000n"')
    expect(text).toContain('"result": "FAILED"')
    expect(text).toMatch(/"at": "\d{4}-/)
  })

  it('keeps the stack, own props and nested causes of an error', () => {
    const cause = Object.assign(new Error('inner'), { details: 'execution reverted' })
    const error = Object.assign(new Error('outer'), { shortMessage: 'short', cause })
    const text = describeFailure({ error })
    expect(text).toContain('Error: outer')
    expect(text).toContain('"shortMessage": "short"')
    expect(text).toContain('cause: Error: inner')
    expect(text).toContain('"details": "execution reverted"')
  })

  it('never throws on unserializable values', () => {
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => safeJson(cyclic)).not.toThrow()
  })
})
