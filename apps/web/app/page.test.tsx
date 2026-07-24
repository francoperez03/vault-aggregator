import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { HomePositionView } from './page'
import { MOCK_EMPTY, MOCK_FUNDED, MOCK_WEIGHTS_ONLY } from '@/lib/mock/position'

afterEach(cleanup)

describe('HomePositionView', () => {
  it('MOCK_EMPTY: shows the empty state and the define-strategy CTA', () => {
    render(<HomePositionView position={MOCK_EMPTY} />)
    expect(screen.getByText('Todavía no tenés posición')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Definí tu estrategia' })).toHaveAttribute('href', '/rebalancear')
  })

  it('MOCK_WEIGHTS_ONLY: shows "Estrategia guardada" and no define-strategy CTA', () => {
    render(<HomePositionView position={MOCK_WEIGHTS_ONLY} />)
    expect(screen.getByText('Estrategia guardada')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Depositar ahora' })).toHaveAttribute('href', '/depositar')
    expect(screen.queryByRole('link', { name: 'Definí tu estrategia' })).not.toBeInTheDocument()
  })

  it('MOCK_FUNDED: shows the total, the protocol breakdown, and deposit/rebalance/withdraw actions', () => {
    render(<HomePositionView position={MOCK_FUNDED} />)
    expect(screen.getByText('$10,000.00')).toBeInTheDocument()
    expect(screen.getByText('Aave')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Depositar' })).toHaveAttribute('href', '/depositar')
    expect(screen.getByRole('link', { name: 'Rebalancear' })).toHaveAttribute('href', '/rebalancear')
    expect(screen.getByRole('link', { name: 'Retirar' })).toHaveAttribute('href', '/retirar')
  })

  it('shows the persistent pending-withdrawal banner (D-19) when set, never as a toast', () => {
    render(<HomePositionView position={{ ...MOCK_FUNDED, pendingWithdrawalUsdc: 500_000_000n }} />)
    expect(screen.getByText(/Moviste \$500.00 USDC al saldo de la app/)).toBeInTheDocument()
  })
})
