import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { AmountInput } from './amount-input'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function typeAmount(text: string) {
  const onChange = vi.fn()
  render(<AmountInput value={0n} onChange={onChange} />)
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } })
  return onChange
}

describe('AmountInput', () => {
  it('parses free text into atomic USDC units', () => {
    expect(typeAmount('37.5')).toHaveBeenCalledWith(37_500_000n)
  })

  it('drops anything that is not a digit or a dot', () => {
    expect(typeAmount('1a2')).toHaveBeenCalledWith(12_000_000n)
  })

  it('keeps a single dot', () => {
    expect(typeAmount('1.2.3')).toHaveBeenCalledWith(1_230_000n)
  })

  it('caps at USDC 6 decimals', () => {
    expect(typeAmount('1.1234567')).toHaveBeenCalledWith(1_123_456n)
  })

  it('treats an emptied field as zero instead of throwing', () => {
    const onChange = vi.fn()
    render(<AmountInput value={0n} onChange={onChange} />)
    const field = screen.getByRole('textbox')
    fireEvent.change(field, { target: { value: '12' } })
    fireEvent.change(field, { target: { value: '' } })
    expect(onChange).toHaveBeenLastCalledWith(0n)
  })

  it('opens empty at zero, showing only the placeholder', () => {
    render(<AmountInput value={0n} onChange={vi.fn()} />)
    expect(screen.getByRole('textbox')).toHaveValue('')
  })
})
