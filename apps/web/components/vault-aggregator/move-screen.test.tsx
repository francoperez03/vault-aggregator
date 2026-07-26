import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MoveScreen } from './move-screen'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const U = 1_000_000n

const useUsdcBalanceMock = vi.fn()
const useVaultPositionMock = vi.fn()
const useWithdrawFlowMock = vi.fn()
const depositMock = vi.fn()
const redeemMock = vi.fn()

vi.mock('@/hooks/useUsdcBalance', () => ({ useUsdcBalance: () => useUsdcBalanceMock() }))
vi.mock('@/hooks/useVaultPosition', () => ({ useVaultPosition: () => useVaultPositionMock() }))
vi.mock('@/hooks/useWithdrawFlow', () => ({ useWithdrawFlow: () => useWithdrawFlowMock() }))
vi.mock('@/hooks/useVaultWrite', () => ({
  useVaultWrite: () => ({ deposit: depositMock, depositStep: 'idle' }),
}))
vi.mock('@/hooks/useUsdcAllowance', () => ({ useUsdcAllowance: () => ({ needsApproval: false }) }))
vi.mock('@/lib/lemon/bridge', () => ({
  isLemonWebView: () => false,
  getLemonBridge: () => ({ deposit: vi.fn(), withdraw: vi.fn() }),
}))

function setup({
  wallet = 50n * U,
  pool = 50n * U,
  hasWeights = true,
  isConnected = true,
  pendingAmount = null as bigint | null,
} = {}) {
  useUsdcBalanceMock.mockReturnValue({ balance: wallet, isLoading: false, isConnected, refetch: vi.fn() })
  useVaultPositionMock.mockReturnValue({ hasWeights, totalUsdc: pool, refetch: vi.fn() })
  useWithdrawFlowMock.mockReturnValue({
    pendingAmount,
    phase: { kind: 'confirm' },
    redeem: redeemMock,
    settleToLemon: vi.fn(),
    acknowledge: vi.fn(),
  })
}

/** Radix's slider reads its geometry from the DOM, which jsdom does not lay out; the keyboard is
 * the reliable way to move the thumb in tests (and the accessible one in the app). */
function nudgeSlider(times: number, key: 'ArrowRight' | 'ArrowLeft') {
  const slider = screen.getByRole('slider')
  slider.focus()
  for (let i = 0; i < times; i++) fireEvent.keyDown(slider, { key })
}

describe('MoveScreen', () => {
  it('shows both balances', () => {
    setup({ wallet: 13_596_595n, pool: 20n * U })
    render(<MoveScreen />)
    expect(screen.getByText('En tu wallet')).toBeInTheDocument()
    expect(screen.getByText('$13.59')).toBeInTheDocument()
    expect(screen.getByText('En el pool')).toBeInTheDocument()
    expect(screen.getByText('$20.00')).toBeInTheDocument()
  })

  it('does nothing until the slider moves', () => {
    setup()
    render(<MoveScreen />)
    expect(screen.getByRole('button', { name: /Mové la barra/ })).toBeDisabled()
  })

  it('right of rest offers a deposit', () => {
    setup()
    render(<MoveScreen />)
    nudgeSlider(10, 'ArrowRight')
    expect(screen.getByRole('button', { name: 'Depositar $10.00' })).toBeEnabled()
  })

  it('left of rest offers a withdrawal', () => {
    setup()
    render(<MoveScreen />)
    nudgeSlider(10, 'ArrowLeft')
    expect(screen.getByRole('button', { name: 'Retirar $10.00' })).toBeEnabled()
  })

  it('a withdrawal redeems a fraction of the position, not an absolute amount', async () => {
    setup()
    render(<MoveScreen />)
    nudgeSlider(25, 'ArrowLeft')
    fireEvent.click(screen.getByRole('button', { name: 'Retirar $25.00' }))
    expect(redeemMock).toHaveBeenCalledWith(5000n)
  })

  it('a deposit sends an absolute amount', async () => {
    setup()
    depositMock.mockResolvedValue({ kind: 'success', amount: 25n * U })
    render(<MoveScreen />)
    nudgeSlider(25, 'ArrowRight')
    fireEvent.click(screen.getByRole('button', { name: 'Depositar $25.00' }))
    expect(depositMock).toHaveBeenCalledWith(25n * U)
  })

  it('hides the Lemon card outside Lemon', () => {
    setup()
    render(<MoveScreen isLemonRuntime={false} />)
    expect(screen.queryByText('Tu cuenta Lemon')).not.toBeInTheDocument()
  })

  it('shows the Lemon card inside Lemon', () => {
    setup()
    render(<MoveScreen isLemonRuntime />)
    expect(screen.getByText('Tu cuenta Lemon')).toBeInTheDocument()
  })

  it('surfaces a pending settlement even outside Lemon: parked money always has a way out', () => {
    setup({ pendingAmount: 4n * U })
    render(<MoveScreen isLemonRuntime={false} />)
    expect(screen.getByRole('button', { name: 'Enviar $4.00 a Lemon' })).toBeInTheDocument()
  })

  it('gates on a defined strategy before offering to move anything into the pool', () => {
    setup({ hasWeights: false })
    render(<MoveScreen />)
    expect(screen.getByRole('link', { name: 'Definí tu estrategia' })).toHaveAttribute('href', '/rebalancear')
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('renders nothing without a connected wallet', () => {
    setup({ isConnected: false })
    const { container } = render(<MoveScreen />)
    expect(container).toBeEmptyDOMElement()
  })
})
