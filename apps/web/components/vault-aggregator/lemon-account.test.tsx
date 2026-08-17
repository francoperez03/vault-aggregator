import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { LemonAccount } from './lemon-account-card'

const U = 1_000_000n
const bringFromLemon = vi.fn()
const sendToLemon = vi.fn()
vi.mock('@/hooks/useLemonTransfer', () => ({
  useLemonTransfer: () => ({ phase: null, isBusy: false, bringFromLemon, sendToLemon, reset: vi.fn() }),
}))

afterEach(cleanup)

function renderAccount(pendingAmount: bigint | null = null) {
  return render(<LemonAccount walletUsdc={4n * U} pendingAmount={pendingAmount} onSent={vi.fn()} onDone={vi.fn()} />)
}

describe('LemonAccount', () => {
  it('shows the mini-app balance and both directions as tabs, collapsed by default', () => {
    renderAccount()
    expect(screen.getByText('$4.00')).toBeInTheDocument()
    expect(screen.getAllByRole('tab')).toHaveLength(2)
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('Traer opens the inbound panel with its own CTA', () => {
    renderAccount()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Traer' }))
    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Traer de Lemon' })).toBeDisabled()
  })

  it('parked money seeds the outbound amount instead of a banner', () => {
    renderAccount(4n * U)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Enviar' }))
    expect(screen.getByRole('textbox')).toHaveValue('4.00')
    expect(screen.getByRole('button', { name: 'Enviar a Lemon' })).toBeEnabled()
  })
})
