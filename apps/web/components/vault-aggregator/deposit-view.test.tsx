import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { DepositView } from './deposit-view'

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

const depositMock = vi.fn()
const refetchMock = vi.fn()
const useUsdcAllowanceMock = vi.fn()

vi.mock('@/hooks/useVaultWrite', () => ({
  useVaultWrite: () => ({ deposit: depositMock, depositStep: 'idle' }),
}))

vi.mock('@/hooks/useVaultPosition', () => ({
  useVaultPosition: () => ({ refetch: refetchMock }),
}))

vi.mock('@/hooks/useUsdcAllowance', () => ({
  useUsdcAllowance: (amount: bigint) => useUsdcAllowanceMock(amount),
}))

/** Never resolves within the test's own assertions — lets a test observe the "signing" phase. */
function pendingForever() {
  return new Promise(() => {})
}

describe('DepositView', () => {
  it('gates on hasWeights: no deposit CTA, links to /rebalancear (D-13)', () => {
    useUsdcAllowanceMock.mockReturnValue({ needsApproval: true })
    render(<DepositView hasWeights={false} isLemonRuntime={false} />)
    expect(screen.getByRole('link', { name: 'Definí tu estrategia' })).toHaveAttribute('href', '/rebalancear')
    expect(screen.queryByRole('button', { name: 'Depositar USDC' })).not.toBeInTheDocument()
  })

  it('browser runtime: shows the real allowance state, sourced from useUsdcAllowance (D-09)', () => {
    useUsdcAllowanceMock.mockReturnValue({ needsApproval: true })
    render(<DepositView hasWeights isLemonRuntime={false} />)
    expect(screen.getByText(/Vas a firmar dos veces/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Depositar USDC' })).toBeEnabled()
  })

  it('Lemon runtime: no separate approve copy, batching copy shown, deposit CTA enabled (D-11)', () => {
    useUsdcAllowanceMock.mockReturnValue({ needsApproval: true })
    render(<DepositView hasWeights isLemonRuntime />)
    expect(screen.queryByText(/Vas a firmar dos veces/)).not.toBeInTheDocument()
    expect(screen.getByText('Lemon procesa la aprobación y el depósito juntos.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Depositar USDC' })).toBeEnabled()
  })

  it('clicking Depositar USDC calls useVaultWrite().deposit with the current amount', async () => {
    useUsdcAllowanceMock.mockReturnValue({ needsApproval: true })
    depositMock.mockReturnValue(pendingForever())
    render(<DepositView hasWeights isLemonRuntime={false} />)

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Depositar USDC' }))
    })

    expect(depositMock).toHaveBeenCalledWith(100_000_000n)
    expect(screen.getByRole('button', { name: 'Depositar USDC' })).toBeDisabled()
  })

  it('a successful deposit renders success and refetches the position', async () => {
    useUsdcAllowanceMock.mockReturnValue({ needsApproval: false })
    depositMock.mockResolvedValue({ kind: 'success', amount: 100_000_000n })
    render(<DepositView hasWeights isLemonRuntime={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Depositar USDC' }))

    await waitFor(() => expect(screen.getByText('¡Listo!')).toBeInTheDocument())
    expect(refetchMock).toHaveBeenCalled()
  })

  it('a rejected signature renders the rejected copy, never the partial state', async () => {
    useUsdcAllowanceMock.mockReturnValue({ needsApproval: true })
    depositMock.mockResolvedValue({ kind: 'rejected' })
    render(<DepositView hasWeights isLemonRuntime={false} />)

    fireEvent.click(screen.getByRole('button', { name: 'Depositar USDC' }))

    await waitFor(() =>
      expect(screen.getByText('Cancelaste la firma. No pasó nada, no se movió plata.')).toBeInTheDocument(),
    )
  })
})
