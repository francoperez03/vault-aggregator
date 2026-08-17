import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { MoveQueueStrip } from './move-queue-strip'

const useMoveQueueMock = vi.fn()
vi.mock('@/lib/vault/move-queue', () => ({ useMoveQueue: () => useMoveQueueMock() }))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const LONG = 'MiniAppsStackStrings.MiniAppWebViewScreenStrings.errors.undefined.title: callSmartContract failed with a very long message'

describe('MoveQueueStrip', () => {
  it('shows a revert reason in full and copies it to the clipboard', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.assign(navigator, { clipboard: { writeText } })
    useMoveQueueMock.mockReturnValue({
      jobs: [{ id: 1, label: 'Depositar $10.00', phase: { kind: 'reverted', reason: LONG } }],
      dismiss: vi.fn(),
    })
    render(<MoveQueueStrip />)
    expect(screen.getByText(`Depositar $10.00 · ${LONG}`)).not.toHaveClass('truncate')
    fireEvent.click(screen.getByRole('button', { name: 'Copiar el error de Depositar $10.00' }))
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`Depositar $10.00 · ${LONG}`))
  })

  it('offers no copy button for successes', () => {
    useMoveQueueMock.mockReturnValue({
      jobs: [{ id: 1, label: 'Depositar $10.00', phase: { kind: 'success' } }],
      dismiss: vi.fn(),
    })
    render(<MoveQueueStrip />)
    expect(screen.queryByRole('button', { name: /Copiar el error/ })).toBeNull()
  })
})
