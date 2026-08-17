import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { HomePositionView } from './page'
import Page from './page'
import { MOCK_EMPTY, MOCK_FUNDED, MOCK_WEIGHTS_ONLY } from '@/lib/mock/position'

const useAccountMock = vi.fn()
// useVaultYield (wired in Plan 15) also pulls useChainId from wagmi — mock both.
vi.mock('wagmi', () => ({ useAccount: () => useAccountMock(), useChainId: () => 421614 }))
vi.mock('@/hooks/useWalletAddress', () => ({
  useWalletAddress: () => (useAccountMock().isConnected ? '0x000000000000000000000000000000000000dEaD' : undefined),
}))

const useNetworkGuardMock = vi.fn()
vi.mock('@/hooks/useNetworkGuard', () => ({ useNetworkGuard: () => useNetworkGuardMock() }))

const useVaultPositionMock = vi.fn()
vi.mock('@/hooks/useVaultPosition', () => ({ useVaultPosition: () => useVaultPositionMock() }))

const useWithdrawFlowMock = vi.fn(() => ({ pendingAmount: null, clearPending: vi.fn() }))
vi.mock('@/hooks/useWithdrawFlow', () => ({ useWithdrawFlow: () => useWithdrawFlowMock() }))

vi.mock('@/hooks/useUsdcBalance', () => ({
  useUsdcBalance: () => ({ balance: 4_000_000n, isLoading: false, isConnected: true, refetch: vi.fn() }),
}))

// The Lemon account block above the ring renders only inside the WebView; flip per test.
const isLemonWebViewMock = vi.fn(() => false)
vi.mock('@/lib/lemon/bridge', () => ({
  isLemonWebView: () => isLemonWebViewMock(),
  getLemonBridge: () => ({ deposit: vi.fn(), withdraw: vi.fn() }),
}))
vi.mock('@/hooks/useLemonTransfer', () => ({
  useLemonTransfer: () => ({ phase: null, isBusy: false, bringFromLemon: vi.fn(), sendToLemon: vi.fn(), reset: vi.fn() }),
}))

vi.mock('@/components/wallet-bar', () => ({ WalletBar: () => null }))

// The landing pulls the whole wagmi config (RainbowKit + connectors); it has its own concerns.
vi.mock('@/components/landing', () => ({
  Landing: () => <div data-testid="landing" />,
  VaultyWordmark: () => <span>Vaulty</span>,
}))

// The move actions now sit on top of `/`; they have their own suite (move-screen.test.tsx) and
// pull the whole wagmi config, which this file deliberately mocks down to two hooks.
vi.mock('@/components/vault-aggregator/move-screen', () => ({
  MoveScreen: () => <div data-testid="move-screen" />,
}))

// Same reason for the allocation step, which `/` now carries as its second panel.
vi.mock('@/components/vault-aggregator/rebalance-panel', () => ({
  RebalancePanel: () => <div data-testid="rebalance-panel" />,
}))

afterEach(cleanup)

describe('HomePositionView', () => {
  it('MOCK_EMPTY: shows the empty state and the define-strategy CTA', () => {
    render(<HomePositionView position={MOCK_EMPTY} />)
    expect(screen.getByText('Tu estrategia')).toBeInTheDocument()
    // The deposit panel above starts collapsed, so this is the only CTA on screen.
    expect(screen.getByRole('link', { name: 'Definí tu estrategia' })).toHaveAttribute('href', '/rebalance')
  })

  it('MOCK_WEIGHTS_ONLY: spells the strategy out inline with a way to edit it, no define-strategy CTA', () => {
    render(<HomePositionView position={MOCK_WEIGHTS_ONLY} />)
    expect(screen.getByText('Tu estrategia')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Editar estrategia' })).toHaveAttribute('href', '/rebalance')
    expect(screen.queryByRole('link', { name: 'Definí tu estrategia' })).not.toBeInTheDocument()
  })

  it('MOCK_FUNDED: shows the protocol breakdown and only the rebalance action (the total is the page card above)', () => {
    render(<HomePositionView position={MOCK_FUNDED} />)
    expect(screen.getByText('Aave')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Rebalancear' })).toHaveAttribute('href', '/rebalance')
    // Depositar/Retirar are the MoveScreen above this view now, not two more buttons here.
    expect(screen.queryByRole('link', { name: 'Depositar' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'Retirar' })).not.toBeInTheDocument()
  })

  it('no banner for parked money: the wallet tank above already shows it', () => {
    render(<HomePositionView position={{ ...MOCK_FUNDED, pendingWithdrawalUsdc: 500_000_000n }} />)
    expect(screen.queryByText(/al saldo de la app/)).not.toBeInTheDocument()
  })
})

describe('Page (default export)', () => {
  afterEach(() => vi.clearAllMocks())

  it('without a connected wallet shows the connect CTA, not zeros', () => {
    useAccountMock.mockReturnValue({ isConnected: false })
    useNetworkGuardMock.mockReturnValue({ isWrongNetwork: false, expectedName: 'Sepolia', switchNetwork: vi.fn() })
    useVaultPositionMock.mockReturnValue({ perAdapter: {}, totalUsdc: 0n, hasWeights: false, isLoading: false, refetch: vi.fn() })

    render(<Page />)

    // Unconnected web visitors get the landing, never the app's zeros.
    expect(screen.getByTestId('landing')).toBeInTheDocument()
    expect(screen.queryByText('Todavía no tenés posición')).not.toBeInTheDocument()
  })

  it('on the wrong network shows the exact copy and does not build HomePositionView', () => {
    const switchNetwork = vi.fn()
    useAccountMock.mockReturnValue({ isConnected: true })
    useNetworkGuardMock.mockReturnValue({ isWrongNetwork: true, expectedName: 'Sepolia', switchNetwork })
    useVaultPositionMock.mockReturnValue({ perAdapter: {}, totalUsdc: 0n, hasWeights: false, isLoading: false, refetch: vi.fn() })

    render(<Page />)

    expect(
      screen.getByText('Tu wallet está en otra red. Cambiá a Arbitrum Sepolia para continuar.'),
    ).toBeInTheDocument()
    // The switch prompt fires on its own on arrival (once), and the button retries it.
    expect(switchNetwork).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Cambiar de red' }))
    expect(switchNetwork).toHaveBeenCalledTimes(2)
  })

  it('connected and on the right network, builds the position from useVaultPosition', () => {
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

    // 6-dp precision: the position card on top plus the single morpho row.
    expect(screen.getByRole('region', { name: 'Tu posición' })).toHaveTextContent('$10.000000')
    expect(screen.getAllByText('$10.000000').length).toBeGreaterThan(0)
    // Web: the card footer is the wallet balance, not the Lemon tabs.
    expect(screen.queryByRole('tab')).not.toBeInTheDocument()
    expect(screen.getByText('En tu wallet')).toBeInTheDocument()
    // The overview has no ring and one primary action; the ring belongs to the weights screen.
    expect(screen.queryByTestId('strategy-ring')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Mover plata' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Rebalancear' }))
    expect(screen.getByTestId('strategy-ring')).toBeInTheDocument()
  })

  it('with weights and no funds the overview offers "Poner a rendir", which opens the tanks', () => {
    useAccountMock.mockReturnValue({ isConnected: true })
    useNetworkGuardMock.mockReturnValue({ isWrongNetwork: false, expectedName: 'Sepolia', switchNetwork: vi.fn() })
    useVaultPositionMock.mockReturnValue({
      perAdapter: { morpho: { shares: 0n, adapterTotalShares: 1n, totalAssets: 0n, valueUsdc: 0n, weightBps: 10000 } },
      totalUsdc: 0n,
      hasWeights: true,
      isLoading: false,
      refetch: vi.fn(),
    })
    render(<Page />)
    const move = screen.getByTestId('move-screen').closest('[aria-hidden]')!
    expect(move).toHaveAttribute('aria-hidden', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Poner a rendir' }))
    expect(move).toHaveAttribute('aria-hidden', 'false')
    expect(screen.queryByTestId('strategy-ring')).not.toBeInTheDocument()
  })

  it('without a strategy there is no ring: the empty wheel was a placeholder, not content', () => {
    useAccountMock.mockReturnValue({ isConnected: true })
    useNetworkGuardMock.mockReturnValue({ isWrongNetwork: false, expectedName: 'Sepolia', switchNetwork: vi.fn() })
    useVaultPositionMock.mockReturnValue({ perAdapter: {}, totalUsdc: 0n, hasWeights: false, isLoading: false, refetch: vi.fn() })
    render(<Page />)
    expect(screen.queryByTestId('strategy-ring')).not.toBeInTheDocument()
  })

  it('inside Lemon the account block sits above the rail with the mini-app balance and the two tabs', async () => {
    isLemonWebViewMock.mockReturnValue(true)
    useAccountMock.mockReturnValue({ isConnected: true })
    useNetworkGuardMock.mockReturnValue({ isWrongNetwork: false, expectedName: 'Sepolia', switchNetwork: vi.fn() })
    useVaultPositionMock.mockReturnValue({ perAdapter: {}, totalUsdc: 0n, hasWeights: false, isLoading: false, refetch: vi.fn() })
    render(<Page />)
    expect(await screen.findByText('$4.00')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Traer' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Enviar' })).toBeInTheDocument()
    isLemonWebViewMock.mockReturnValue(false)
  })

  it('a pending amount no longer triggers a banner: it lives in the wallet tank and in the Lemon send', () => {
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

    expect(screen.queryByText(/al saldo de la app/)).not.toBeInTheDocument()
  })
})
