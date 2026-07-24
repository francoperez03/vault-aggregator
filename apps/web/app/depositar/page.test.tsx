import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { DepositView } from './page'

afterEach(cleanup)

describe('DepositView', () => {
  it('gates on hasWeights: no deposit CTA, links to /rebalancear (D-13)', () => {
    render(<DepositView hasWeights={false} isLemonRuntime={false} />)
    expect(screen.getByRole('link', { name: 'Definí tu estrategia' })).toHaveAttribute('href', '/rebalancear')
    expect(screen.queryByRole('button', { name: 'Depositar USDC' })).not.toBeInTheDocument()
  })

  it('browser runtime: shows the separate "Aprobar USDC" approve step (D-09)', () => {
    render(<DepositView hasWeights isLemonRuntime={false} />)
    expect(screen.getByRole('button', { name: 'Aprobar USDC' })).toBeInTheDocument()
    expect(screen.getByText(/Vas a firmar dos veces/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Depositar USDC' })).toBeDisabled()
  })

  it('Lemon runtime: no separate approve CTA, batching copy shown, deposit CTA enabled (D-11)', () => {
    render(<DepositView hasWeights isLemonRuntime />)
    expect(screen.queryByRole('button', { name: 'Aprobar USDC' })).not.toBeInTheDocument()
    expect(screen.getByText('Lemon procesa la aprobación y el depósito juntos.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Depositar USDC' })).toBeEnabled()
  })

  it('walks through all five transaction states via the 14a-only phase selector', () => {
    render(<DepositView hasWeights isLemonRuntime />)

    fireEvent.click(screen.getByRole('button', { name: 'signing' }))
    expect(screen.getByText('Confirmá en tu wallet…')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'pending' }))
    expect(screen.getByText('Tu transacción está en curso.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'success' }))
    expect(screen.getByText('¡Listo!')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'rejected' }))
    expect(screen.getByText('Cancelaste la firma. No pasó nada, no se movió plata.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'partial' }))
    expect(screen.getByText(/Pediste \$100\.00, se movieron \$60\.00/)).toBeInTheDocument()
  })
})
