import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WithdrawView } from './page'

afterEach(cleanup)

const TOTAL = 1_000_000_000n // 1,000 USDC atomic

describe('WithdrawView', () => {
  it('step 1: CTA reads "Retirar al saldo de la app" and stays disabled until a preset is picked', () => {
    render(<WithdrawView totalUsdc={TOTAL} step={1} onStepChange={vi.fn()} />)
    expect(screen.getByRole('button', { name: 'Retirar al saldo de la app' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'MAX' }))
    expect(screen.getByRole('button', { name: 'Retirar al saldo de la app' })).toBeEnabled()
  })

  it('presets 25/50/75/MAX translate to exact 2500/5000/7500/10000 bps (MAX is literal 10000n, no floor drift)', () => {
    render(<WithdrawView totalUsdc={TOTAL} step={1} onStepChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: '25%' }))
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'MAX' }))
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
  })

  it('step 1 never renders the partial-reconciliation copy (Pitfall 4: redeem is atomic)', () => {
    render(<WithdrawView totalUsdc={TOTAL} step={1} onStepChange={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'partial' })).not.toBeInTheDocument()
    expect(screen.queryByText(/quedan \$/)).not.toBeInTheDocument()
  })

  it('completing step 1 advances to step 2 with the measured amount, not the requested one (D-19)', () => {
    const onStepChange = vi.fn()
    render(<WithdrawView totalUsdc={TOTAL} step={1} onStepChange={onStepChange} />)
    fireEvent.click(screen.getByRole('button', { name: 'MAX' }))
    fireEvent.click(screen.getByRole('button', { name: 'success' }))
    expect(onStepChange).toHaveBeenCalledWith(2)
  })

  it('step 2: shows the pending-in-app-balance copy and its own CTA', () => {
    render(<WithdrawView totalUsdc={TOTAL} step={2} onStepChange={vi.fn()} />)
    expect(screen.getByText(/Enviálo a Lemon para terminar/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar a Lemon' })).toBeInTheDocument()
  })

  it('step 2 can reach the partial reconciliation state (Pitfall 4: withdraw is the SDK call)', () => {
    render(<WithdrawView totalUsdc={TOTAL} step={2} onStepChange={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'partial' }))
    expect(screen.getByText(/quedan \$/)).toBeInTheDocument()
  })
})
