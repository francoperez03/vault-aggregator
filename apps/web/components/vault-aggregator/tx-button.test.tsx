import { afterEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, act } from '@testing-library/react'
import { TxButton, toButtonStage } from './tx-button'

afterEach(() => {
  vi.useRealTimers()
  vi.clearAllMocks()
})

describe('toButtonStage', () => {
  it('splits signing into confirming vs pending by the write stage', () => {
    expect(toButtonStage({ kind: 'signing' }, 'confirming')).toBe('confirming')
    expect(toButtonStage({ kind: 'signing' }, 'pending')).toBe('pending')
  })

  it('rejected maps to idle — cancelling the wallet sheet is not an error', () => {
    expect(toButtonStage({ kind: 'rejected' }, 'idle')).toBe('idle')
  })

  it('reverted and timeout are the error beat; success is success', () => {
    expect(toButtonStage({ kind: 'reverted' }, 'idle')).toBe('error')
    expect(toButtonStage({ kind: 'timeout' }, 'idle')).toBe('error')
    expect(toButtonStage({ kind: 'success' }, 'idle')).toBe('success')
  })
})

describe('TxButton', () => {
  it('renders the whole lifecycle: rest, confirming, pending', () => {
    const { rerender } = render(<TxButton label="Definí tu estrategia" stage="idle" onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Definí tu estrategia' })).toBeEnabled()

    rerender(<TxButton label="Definí tu estrategia" stage="confirming" onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Confirmá en tu wallet/ })).toBeDisabled()

    rerender(<TxButton label="Definí tu estrategia" stage="pending" onClick={vi.fn()} />)
    expect(screen.getByRole('button', { name: /Esperando la transacción/ })).toBeDisabled()
  })

  it('holds the success beat and walks back to normal on its own', () => {
    vi.useFakeTimers()
    const onSettled = vi.fn()
    render(
      <TxButton label="Definí tu estrategia" successLabel="Estrategia aplicada" stage="success" onClick={vi.fn()} onSettled={onSettled} />,
    )
    expect(screen.getByRole('button', { name: 'Estrategia aplicada' })).toBeDisabled()

    act(() => {
      vi.advanceTimersByTime(2600)
    })
    expect(onSettled).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Definí tu estrategia' })).toBeInTheDocument()
  })

  it('the error beat stays clickable as a retry', () => {
    const onClick = vi.fn()
    render(<TxButton label="Definí tu estrategia" stage="error" onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Falló · Reintentar' })
    expect(button).toBeEnabled()
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })
})
