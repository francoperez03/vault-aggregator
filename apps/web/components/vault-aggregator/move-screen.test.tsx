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
vi.mock('@/hooks/useWalletAddress', () => ({ useWalletAddress: () => '0xA818000000000000000000000000000000061d8' }))
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

/** The pool tank's number is the input: typing a target amount is how the user moves money. */
function typePoolTarget(value: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Cuánto querés tener en el pool' }), { target: { value } })
}

describe('MoveScreen', () => {
  it('shows both balances', () => {
    setup({ wallet: 13_596_595n, pool: 20n * U })
    render(<MoveScreen />)
    expect(screen.getByText('En tu wallet')).toBeInTheDocument()
    expect(screen.getByText('$13.59')).toBeInTheDocument()
    expect(screen.getByText('En el pool')).toBeInTheDocument()
    // The pool amount is the input; at rest it shows the current position as its placeholder.
    expect(screen.getByRole('textbox', { name: 'Cuánto querés tener en el pool' })).toHaveAttribute('placeholder', '20.00')
  })

  it('does nothing until a target is chosen', () => {
    setup()
    render(<MoveScreen />)
    expect(screen.getByRole('button', { name: /Elegí cuánto va al pool/ })).toBeDisabled()
  })

  it('a target above the current position offers a deposit', () => {
    setup()
    render(<MoveScreen />)
    typePoolTarget('60')
    expect(screen.getByRole('button', { name: 'Depositar $10.00' })).toBeEnabled()
  })

  it('a target below the current position offers a withdrawal', () => {
    setup()
    render(<MoveScreen />)
    typePoolTarget('40')
    expect(screen.getByRole('button', { name: 'Retirar $10.00' })).toBeEnabled()
  })

  it('a withdrawal redeems a fraction of the position, not an absolute amount', async () => {
    setup()
    render(<MoveScreen />)
    typePoolTarget('25')
    fireEvent.click(screen.getByRole('button', { name: 'Retirar $25.00' }))
    expect(redeemMock).toHaveBeenCalledWith(5000n)
  })

  it('a deposit sends an absolute amount', async () => {
    setup()
    depositMock.mockResolvedValue({ kind: 'success', amount: 25n * U })
    render(<MoveScreen />)
    typePoolTarget('75')
    fireEvent.click(screen.getByRole('button', { name: 'Depositar $25.00' }))
    expect(depositMock).toHaveBeenCalledWith(25n * U)
  })

  it('the 100% pill puts everything in the pool, the 0% pill takes everything out', () => {
    setup()
    render(<MoveScreen />)
    fireEvent.click(screen.getByRole('radio', { name: '100%' }))
    expect(screen.getByRole('button', { name: 'Depositar $50.00' })).toBeEnabled()
    fireEvent.click(screen.getByRole('radio', { name: '0%' }))
    expect(screen.getByRole('button', { name: 'Retirar $50.00' })).toBeEnabled()
    fireEvent.click(screen.getByRole('button', { name: 'Retirar $50.00' }))
    expect(redeemMock).toHaveBeenCalledWith(10000n)
  })

  it('a share pill fills the input with the matching amount and stays selected', () => {
    setup()
    render(<MoveScreen />)
    fireEvent.click(screen.getByRole('radio', { name: '25%' }))
    expect(screen.getByRole('textbox', { name: 'Cuánto querés tener en el pool' })).toHaveValue('25.00')
    expect(screen.getByRole('radio', { name: '25%' })).toHaveAttribute('data-state', 'on')
    expect(screen.getByRole('button', { name: 'Retirar $25.00' })).toBeEnabled()
  })

  it('a typed target above wallet+pool clamps to depositing the whole wallet', () => {
    setup()
    render(<MoveScreen />)
    typePoolTarget('999')
    expect(screen.getByRole('button', { name: 'Depositar $50.00' })).toBeEnabled()
    expect(screen.getByRole('radio', { name: '100%' })).toHaveAttribute('data-state', 'on')
  })

  it('clearing the input goes back to rest', () => {
    setup()
    render(<MoveScreen />)
    typePoolTarget('60')
    typePoolTarget('')
    expect(screen.getByRole('button', { name: /Elegí cuánto va al pool/ })).toBeDisabled()
  })

  it('renders no move UI and NO duplicate CTA without a strategy — the position card owns the empty state', () => {
    setup({ hasWeights: false })
    render(<MoveScreen />)
    expect(screen.queryByRole('link', { name: 'Definí tu estrategia' })).not.toBeInTheDocument()
    expect(screen.queryByText(/no definiste/)).not.toBeInTheDocument()
    expect(screen.queryByRole('slider')).not.toBeInTheDocument()
  })

  it('renders nothing without a connected wallet', () => {
    setup({ isConnected: false })
    const { container } = render(<MoveScreen />)
    expect(container).toBeEmptyDOMElement()
  })
})
