import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { RebalanceView } from './page'

afterEach(cleanup)

const ADDRESSES = {
  morpho: '0x0000000000000000000000000000000000000001',
  fluid: '0x0000000000000000000000000000000000000002',
  euler: '0x0000000000000000000000000000000000000003',
  aave: '0x0000000000000000000000000000000000000004',
} as const

describe('RebalanceView', () => {
  it('bootstrap mode (zero position, D-13): CTA reads "Definí tu estrategia" and is disabled until sliders sum 100%', () => {
    render(
      <RebalanceView
        isBootstrap
        initialAllocation={{ morpho: 50, fluid: 50, euler: 0, aave: 0 }}
        addresses={ADDRESSES}
      />,
    )
    expect(screen.getByRole('button', { name: 'Definí tu estrategia' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Confirmar rebalanceo' })).not.toBeInTheDocument()
  })

  it('bootstrap CTA disables when sliders do not sum to 100%', () => {
    render(
      <RebalanceView isBootstrap initialAllocation={{ morpho: 40, fluid: 40, euler: 0, aave: 0 }} addresses={ADDRESSES} />,
    )
    expect(screen.getByRole('button', { name: 'Definí tu estrategia' })).toBeDisabled()
  })

  it('bootstrap mode never shows the D-15 cost disclosure (nothing to unwind)', () => {
    render(
      <RebalanceView isBootstrap initialAllocation={{ morpho: 100, fluid: 0, euler: 0, aave: 0 }} addresses={ADDRESSES} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Definí tu estrategia' }))
    expect(screen.queryByText(/el rendimiento acumulado hasta ahora se realiza en esta operación/)).not.toBeInTheDocument()
    expect(screen.getByText('Confirmá en tu wallet…')).toBeInTheDocument()
  })

  it('rebalance mode: primary CTA reads "Confirmar rebalanceo" and shows the cost disclosure before signing (D-15)', () => {
    render(
      <RebalanceView
        isBootstrap={false}
        initialAllocation={{ morpho: 30, fluid: 20, euler: 10, aave: 40 }}
        addresses={ADDRESSES}
      />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rebalanceo' }))
    expect(screen.getByText(/el rendimiento acumulado hasta ahora se realiza en esta operación/)).toBeInTheDocument()
    // Signing hasn't started yet: the disclosure's own CTA is the one that actually confirms.
    expect(screen.queryByText('Confirmá en tu wallet…')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rebalanceo' }))
    expect(screen.getByText('Confirmá en tu wallet…')).toBeInTheDocument()
  })

  it('walks through signing, pending, success, rejected and reverted via the 14a-only phase selector', () => {
    render(
      <RebalanceView isBootstrap initialAllocation={{ morpho: 100, fluid: 0, euler: 0, aave: 0 }} addresses={ADDRESSES} />,
    )
    fireEvent.click(screen.getByRole('button', { name: 'signing' }))
    expect(screen.getByText('Confirmá en tu wallet…')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'pending' }))
    expect(screen.getByText('Tu transacción está en curso.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'success' }))
    expect(screen.getByText('¡Listo!')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'rejected' }))
    expect(screen.getByText('Cancelaste la firma. No pasó nada, no se movió plata.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'reverted' }))
    expect(screen.getByText(/La transacción no se completó/)).toBeInTheDocument()
  })

  it('a throttled rebalance is the normal reverted state, never the partial state (Pitfall 4)', () => {
    render(
      <RebalanceView isBootstrap initialAllocation={{ morpho: 100, fluid: 0, euler: 0, aave: 0 }} addresses={ADDRESSES} />,
    )
    expect(screen.queryByRole('button', { name: 'partial' })).not.toBeInTheDocument()
  })
})
