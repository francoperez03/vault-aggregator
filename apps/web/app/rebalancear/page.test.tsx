import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { RebalanceView } from './page'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const rebalanceMock = vi.fn()
const refetchMock = vi.fn()

vi.mock('@/hooks/useVaultWrite', () => ({
  useVaultWrite: () => ({ rebalance: rebalanceMock }),
}))

vi.mock('@/hooks/useVaultPosition', () => ({
  useVaultPosition: () => ({ refetch: refetchMock }),
}))

/** Never resolves within the test's own assertions — lets a test observe the "signing" phase. */
function pendingForever() {
  return new Promise(() => {})
}

describe('RebalanceView', () => {
  it('bootstrap mode (zero position, D-13): CTA reads "Definí tu estrategia" and is disabled until sliders sum 100%', () => {
    render(<RebalanceView isBootstrap initialAllocation={{ morpho: 50, fluid: 50, euler: 0, aave: 0 }} />)
    expect(screen.getByRole('button', { name: 'Definí tu estrategia' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Confirmar rebalanceo' })).not.toBeInTheDocument()
  })

  it('bootstrap CTA disables when sliders do not sum to 100%', () => {
    render(<RebalanceView isBootstrap initialAllocation={{ morpho: 40, fluid: 40, euler: 0, aave: 0 }} />)
    expect(screen.getByRole('button', { name: 'Definí tu estrategia' })).toBeDisabled()
  })

  it('bootstrap mode never shows the D-15 cost disclosure and fires rebalance() directly', async () => {
    rebalanceMock.mockReturnValue(pendingForever())
    render(<RebalanceView isBootstrap initialAllocation={{ morpho: 100, fluid: 0, euler: 0, aave: 0 }} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Definí tu estrategia' }))
    })

    expect(screen.queryByText(/el rendimiento acumulado hasta ahora se realiza en esta operación/)).not.toBeInTheDocument()
    expect(screen.getByText('Confirmá en tu wallet…')).toBeInTheDocument()
    expect(rebalanceMock).toHaveBeenCalledWith({ morpho: 10000, fluid: 0, euler: 0, aave: 0 })
  })

  it('rebalance mode: primary CTA reads "Confirmar rebalanceo" and shows the cost disclosure before signing (D-15)', async () => {
    rebalanceMock.mockReturnValue(pendingForever())
    render(<RebalanceView isBootstrap={false} initialAllocation={{ morpho: 30, fluid: 20, euler: 10, aave: 40 }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar rebalanceo' }))
    expect(screen.getByText(/el rendimiento acumulado hasta ahora se realiza en esta operación/)).toBeInTheDocument()
    // Signing hasn't started yet: the disclosure's own CTA is the one that actually confirms.
    expect(screen.queryByText('Confirmá en tu wallet…')).not.toBeInTheDocument()

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Confirmar rebalanceo' }))
    })
    expect(screen.getByText('Confirmá en tu wallet…')).toBeInTheDocument()
  })

  it('a successful rebalance renders success and refetches the position', async () => {
    rebalanceMock.mockResolvedValue({ kind: 'success' })
    render(<RebalanceView isBootstrap initialAllocation={{ morpho: 100, fluid: 0, euler: 0, aave: 0 }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Definí tu estrategia' }))

    await waitFor(() => expect(screen.getByText('¡Listo!')).toBeInTheDocument())
    expect(refetchMock).toHaveBeenCalled()
  })

  it('a rejected signature renders the rejected copy, never the partial state', async () => {
    rebalanceMock.mockResolvedValue({ kind: 'rejected' })
    render(<RebalanceView isBootstrap initialAllocation={{ morpho: 100, fluid: 0, euler: 0, aave: 0 }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Definí tu estrategia' }))

    await waitFor(() =>
      expect(screen.getByText('Cancelaste la firma. No pasó nada, no se movió plata.')).toBeInTheDocument(),
    )
  })

  it('a throttled rebalance is the normal reverted state, never the partial state (Pitfall 4)', async () => {
    rebalanceMock.mockResolvedValue({ kind: 'reverted', reason: 'un adapter frenó el retiro (throttle)' })
    render(<RebalanceView isBootstrap initialAllocation={{ morpho: 100, fluid: 0, euler: 0, aave: 0 }} />)

    fireEvent.click(screen.getByRole('button', { name: 'Definí tu estrategia' }))

    await waitFor(() => expect(screen.getByText(/La transacción no se completó/)).toBeInTheDocument())
    expect(screen.queryByText(/quedan \$/)).not.toBeInTheDocument()
  })
})
