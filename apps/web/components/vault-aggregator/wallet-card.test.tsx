import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { UserRejectedRequestError } from 'viem'
import { WalletCard } from './wallet-card'

const U = 1_000_000n
const WALLET = '0xA818000000000000000000000000000000061d8' as const
const TO = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' as const
const USDC = '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as const

const writeContractAsyncMock = vi.fn()
const waitForTransactionReceiptMock = vi.fn()

vi.mock('wagmi', () => ({
  useWriteContract: () => ({ writeContractAsync: writeContractAsyncMock }),
}))
vi.mock('wagmi/actions', () => ({
  waitForTransactionReceipt: (...args: unknown[]) => waitForTransactionReceiptMock(...args),
}))
vi.mock('@/lib/wagmi/config', () => ({ wagmiConfig: {} }))
vi.mock('@/lib/contracts/config', () => ({ getUsdcAddress: () => USDC }))
vi.mock('@/lib/env', () => ({ getChainId: () => 42161, getChainLabel: () => 'Arbitrum One' }))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

function renderCard(onDone = vi.fn()) {
  render(<WalletCard walletUsdc={4n * U} address={WALLET} onDone={onDone} />)
  return onDone
}

function openSend() {
  fireEvent.mouseDown(screen.getByRole('tab', { name: 'Enviar' }))
}

function fillSend(to: string, amount: string) {
  fireEvent.change(screen.getByRole('textbox', { name: 'Dirección de destino' }), { target: { value: to } })
  fireEvent.change(screen.getByRole('textbox', { name: 'Monto a depositar en USDC' }), { target: { value: amount } })
}

describe('WalletCard', () => {
  it('shows the wallet balance and both directions as tabs, collapsed by default', () => {
    renderCard()
    expect(screen.getByText('$4.00')).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Recibir/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Enviar/ })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Dirección de destino' })).toBeNull()
  })

  it('Recibir hands out this wallet address to copy', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    renderCard()
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'Recibir' }))
    fireEvent.click(screen.getByRole('button', { name: `Copiar dirección ${WALLET}` }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(WALLET))
  })

  it('Enviar stays disabled with an invalid address or an amount above the balance', () => {
    renderCard()
    openSend()
    fillSend('0x1234', '1')
    expect(screen.getByText('Dirección inválida.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Enviar $1.00' })).toBeDisabled()
    fillSend(TO, '9')
    expect(screen.getByRole('button', { name: 'Enviar $9.00' })).toBeDisabled()
    fillSend(TO, '1.5')
    expect(screen.getByRole('button', { name: 'Enviar $1.50' })).toBeEnabled()
  })

  it('sends a plain USDC transfer to the address, waits for the receipt and refetches', async () => {
    writeContractAsyncMock.mockResolvedValue('0xhash')
    waitForTransactionReceiptMock.mockResolvedValue({})
    const onDone = renderCard()
    openSend()
    fillSend(TO, '1.5')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar $1.50' }))
    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(writeContractAsyncMock).toHaveBeenCalledWith(
      expect.objectContaining({ address: USDC, functionName: 'transfer', args: [TO, 1_500_000n] }),
    )
    expect(waitForTransactionReceiptMock).toHaveBeenCalledWith({}, { hash: '0xhash' })
  })

  it('a wallet rejection leaves the send unsent and never refetches', async () => {
    writeContractAsyncMock.mockRejectedValue(new UserRejectedRequestError(new Error('denied')))
    const onDone = renderCard()
    openSend()
    fillSend(TO, '1')
    fireEvent.click(screen.getByRole('button', { name: 'Enviar $1.00' }))
    await waitFor(() => expect(writeContractAsyncMock).toHaveBeenCalled())
    expect(onDone).not.toHaveBeenCalled()
    expect(waitForTransactionReceiptMock).not.toHaveBeenCalled()
  })
})
