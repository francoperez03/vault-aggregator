import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MoveScreen } from './move-screen'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const useUsdcBalanceMock = vi.fn()
const useWithdrawFlowMock = vi.fn()

vi.mock('@/hooks/useUsdcBalance', () => ({
  useUsdcBalance: () => useUsdcBalanceMock(),
}))

vi.mock('@/hooks/useVaultPosition', () => ({
  useVaultPosition: () => ({ hasWeights: true, totalUsdc: 10_000_000n, refetch: vi.fn() }),
}))

vi.mock('@/hooks/useWithdrawFlow', () => ({
  useWithdrawFlow: () => useWithdrawFlowMock(),
}))

vi.mock('@/hooks/useVaultWrite', () => ({
  useVaultWrite: () => ({ deposit: vi.fn(), depositStep: 'idle' }),
}))

vi.mock('@/hooks/useUsdcAllowance', () => ({
  useUsdcAllowance: () => ({ needsApproval: false }),
}))

vi.mock('next/navigation', () => ({
  usePathname: () => '/mover',
  useRouter: () => ({ replace: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))

function withFlow(pendingAmount: bigint | null) {
  useWithdrawFlowMock.mockReturnValue({
    pendingAmount,
    phase: { kind: 'confirm' },
    redeem: vi.fn(),
    settleToLemon: vi.fn(),
    acknowledge: vi.fn(),
  })
}

describe('MoveScreen', () => {
  it('shows the wallet USDC balance, not the vault position', () => {
    useUsdcBalanceMock.mockReturnValue({ balance: 13_596_595n, isLoading: false, isConnected: true })
    withFlow(null)
    render(<MoveScreen />)
    expect(screen.getByText(/Saldo en tu wallet/)).toBeInTheDocument()
    expect(screen.getByText('$13.59')).toBeInTheDocument()
  })

  it('renders `--` while the balance read is in flight, never a flashed $0.00', () => {
    useUsdcBalanceMock.mockReturnValue({ balance: 0n, isLoading: true, isConnected: true })
    withFlow(null)
    render(<MoveScreen />)
    expect(screen.getByText('--')).toBeInTheDocument()
  })

  it('hides the balance row when no wallet is connected, rather than claiming $0.00', () => {
    useUsdcBalanceMock.mockReturnValue({ balance: 0n, isLoading: false, isConnected: false })
    withFlow(null)
    render(<MoveScreen />)
    expect(screen.queryByText(/Saldo en tu wallet/)).not.toBeInTheDocument()
  })

  it('starts collapsed: balance and actions only, no form until asked', () => {
    useUsdcBalanceMock.mockReturnValue({ balance: 0n, isLoading: false, isConnected: true })
    withFlow(null)
    render(<MoveScreen />)
    expect(screen.getByRole('tab', { name: 'Depositar' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tab', { name: 'Retirar' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.queryByRole('button', { name: 'Depositar USDC' })).not.toBeInTheDocument()
  })

  it('tapping the open action collapses it again', () => {
    useUsdcBalanceMock.mockReturnValue({ balance: 0n, isLoading: false, isConnected: true })
    withFlow(null)
    render(<MoveScreen initialTab="withdraw" />)
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Retirar' }))
    fireEvent.click(screen.getByRole('tab', { name: 'Retirar' }))
    expect(screen.getByRole('tab', { name: 'Retirar' })).toHaveAttribute('aria-selected', 'false')
  })

  it('opens on the tab the entry route asks for', () => {
    useUsdcBalanceMock.mockReturnValue({ balance: 0n, isLoading: false, isConnected: true })
    withFlow(null)
    render(<MoveScreen initialTab="withdraw" />)
    expect(screen.getByRole('tab', { name: 'Retirar' })).toHaveAttribute('aria-selected', 'true')
  })

  it('switches tabs without navigating', () => {
    useUsdcBalanceMock.mockReturnValue({ balance: 0n, isLoading: false, isConnected: true })
    withFlow(null)
    render(<MoveScreen initialTab="deposit" />)
    // Radix activates a trigger on mousedown/focus, not on the synthetic click.
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Retirar' }))
    expect(screen.getByRole('tab', { name: 'Retirar' })).toHaveAttribute('aria-selected', 'true')
  })

  it('pins the Retirar tab while a settlement is pending, even entering from /depositar', () => {
    useUsdcBalanceMock.mockReturnValue({ balance: 0n, isLoading: false, isConnected: true })
    withFlow(4_000_000n)
    render(<MoveScreen initialTab="deposit" />)
    expect(screen.getByRole('tab', { name: 'Retirar' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tab', { name: 'Depositar' })).toBeDisabled()
  })
})
