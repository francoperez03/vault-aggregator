import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomePositionView } from './page'
import Page from './page'
import { MOCK_EMPTY, MOCK_FUNDED, MOCK_WEIGHTS_ONLY } from '@/lib/mock/position'

const useAccountMock = vi.fn()
// useVaultYield (wired in Plan 15) also pulls useChainId from wagmi — mock both.
vi.mock('wagmi', () => ({ useAccount: () => useAccountMock(), useChainId: () => 421614 }))

const useNetworkGuardMock = vi.fn()
vi.mock('@/hooks/useNetworkGuard', () => ({ useNetworkGuard: () => useNetworkGuardMock() }))

const useVaultPositionMock = vi.fn()
vi.mock('@/hooks/useVaultPosition', () => ({ useVaultPosition: () => useVaultPositionMock() }))

const useWithdrawFlowMock = vi.fn(() => ({ pendingAmount: null }))
vi.mock('@/hooks/useWithdrawFlow', () => ({ useWithdrawFlow: () => useWithdrawFlowMock() }))

vi.mock('@/components/wallet-bar', () => ({ WalletBar: () => null }))

// The move actions now sit on top of `/`; they have their own suite (move-screen.test.tsx) and
// pull the whole wagmi config, which this file deliberately mocks down to two hooks.
vi.mock('@/components/vault-aggregator/move-screen', () => ({
  MoveScreen: () => <div data-testid="move-screen" />,
}))

afterEach(cleanup)

describe('HomePositionView', () => {
  it('MOCK_EMPTY: shows the empty state without a second define-strategy CTA', () => {
    render(<HomePositionView position={MOCK_EMPTY} />)
    expect(screen.getByText('Todavía no tenés posición')).toBeInTheDocument()
    // The only "Definí tu estrategia" on `/` is the deposit panel's, rendered above this view.
    expect(screen.queryByRole('link', { name: 'Definí tu estrategia' })).not.toBeInTheDocument()
  })

  it('MOCK_WEIGHTS_ONLY: shows "Estrategia guardada" and no define-strategy CTA', () => {
    render(<HomePositionView position={MOCK_WEIGHTS_ONLY} />)
    expect(screen.getByText('Estrategia guardada')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Depositar ahora' })).toHaveAttribute('href', '/depositar')
    expect(screen.queryByRole('link', { name: 'Definí tu estrategia' })).not.toBeInTheDocument()
  })

  it('MOCK_FUNDED: shows the total, the protocol breakdown, and only the rebalance action', () => {
    render(<HomePositionView position={MOCK_FUNDED} />)
    // VFE-02: the total now renders through YieldCounter at 6-dp precision (formatUsdcPrecise).
    expect(screen.getByText('$10,000.000000')).toBeInTheDocument()
    expect(screen.getByText('Aave')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rebalancear' })).toHaveAttribute('href', '/rebalancear')
    // Depositar/Retirar are the MoveScreen above this view now, not two more buttons here.
    expect(screen.queryByRole('link', { name: 'Depositar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Retirar' })).not.toBeInTheDocument()
  })

  it('shows the persistent pending-withdrawal banner (D-19) when set, never as a toast', () => {
    render(<HomePositionView position={{ ...MOCK_FUNDED, pendingWithdrawalUsdc: 500_000_000n }} />)
    expect(screen.getByText(/Moviste \$500.00 USDC al saldo de la app/)).toBeInTheDocument()
  })
})

describe('Page (default export)', () => {
  afterEach(() => vi.clearAllMocks())

  it('sin wallet conectada muestra la CTA de conectar, no ceros', () => {
    useAccountMock.mockReturnValue({ isConnected: false })
    useNetworkGuardMock.mockReturnValue({ isWrongNetwork: false, expectedName: 'Sepolia', switchNetwork: vi.fn() })
    useVaultPositionMock.mockReturnValue({ perAdapter: {}, totalUsdc: 0n, hasWeights: false, isLoading: false, refetch: vi.fn() })

    render(<Page />)

    expect(screen.getByText('Conectá tu wallet')).toBeInTheDocument()
    expect(screen.queryByText('Todavía no tenés posición')).not.toBeInTheDocument()
  })

  it('en la red equivocada muestra el copy exacto y no arma HomePositionView', () => {
    const switchNetwork = vi.fn()
    useAccountMock.mockReturnValue({ isConnected: true })
    useNetworkGuardMock.mockReturnValue({ isWrongNetwork: true, expectedName: 'Sepolia', switchNetwork })
    useVaultPositionMock.mockReturnValue({ perAdapter: {}, totalUsdc: 0n, hasWeights: false, isLoading: false, refetch: vi.fn() })

    render(<Page />)

    expect(screen.getByText('Cambiá a Arbitrum Sepolia para continuar.')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar de red' }))
    expect(switchNetwork).toHaveBeenCalledTimes(1)
  })

  it('conectada y en la red correcta, arma la posición desde useVaultPosition', () => {
    useAccountMock.mockReturnValue({ isConnected: true })
    useNetworkGuardMock.mockReturnValue({ isWrongNetwork: false, expectedName: 'Sepolia', switchNetwork: vi.fn() })
    useVaultPositionMock.mockReturnValue({
      perAdapter: { morpho: { shares: 1n, adapterTotalShares: 1n, totalAssets: 10_000_000n, valueUsdc: 10_000_000n, weightBps: 10000 } },
      totalUsdc: 10_000_000n,
      hasWeights: true,
      isLoading: false,
      refetch: vi.fn(),
    })

    render(<Page />)

    // 6-dp precision via YieldCounter (total + the single morpho row).
    expect(screen.getAllByText('$10.000000').length).toBeGreaterThan(0)
  })

  it('con un monto pendiente medido por useWithdrawFlow, muestra el banner persistente', () => {
    useAccountMock.mockReturnValue({ isConnected: true })
    useNetworkGuardMock.mockReturnValue({ isWrongNetwork: false, expectedName: 'Sepolia', switchNetwork: vi.fn() })
    useVaultPositionMock.mockReturnValue({
      perAdapter: { morpho: { shares: 1n, adapterTotalShares: 1n, totalAssets: 10_000_000n, valueUsdc: 10_000_000n, weightBps: 10000 } },
      totalUsdc: 10_000_000n,
      hasWeights: true,
      isLoading: false,
      refetch: vi.fn(),
    })
    useWithdrawFlowMock.mockReturnValue({ pendingAmount: 500_000n })

    render(<Page />)

    expect(screen.getByText(/Moviste \$0.50 USDC al saldo de la app/)).toBeInTheDocument()
  })
})
