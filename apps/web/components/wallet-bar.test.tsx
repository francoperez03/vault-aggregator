import { afterEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { WalletBar } from './wallet-bar'

const isLemonWebViewMock = vi.fn()
const useSiweMock = vi.fn()

vi.mock('@/lib/lemon/bridge', () => ({
  isLemonWebView: () => isLemonWebViewMock(),
}))

vi.mock('@/hooks/useSiwe', () => ({
  useSiwe: () => useSiweMock(),
}))

vi.mock('@/lib/wagmi/config', () => ({ hasWalletConnect: false, wagmiConfig: {} }))

vi.mock('wagmi', () => ({
  useAccount: () => ({ address: undefined, isConnected: false }),
  useConnect: () => ({ connect: vi.fn(), connectors: [], isPending: false }),
  useDisconnect: () => ({ disconnect: vi.fn() }),
}))

afterEach(() => vi.clearAllMocks())

describe('WalletBar inside the Lemon WebView', () => {
  it('renders nothing when the automatic SIWE already produced a wallet', async () => {
    isLemonWebViewMock.mockReturnValue(true)
    useSiweMock.mockReturnValue({ wallet: '0x1234', isAuthenticating: false, error: null, authenticate: vi.fn() })
    const { container } = render(<WalletBar />)
    await waitFor(() => expect(container.querySelectorAll('button, [role="button"]')).toHaveLength(0))
    expect(container.textContent).toBe('')
  })

  it('renders nothing while authenticating', async () => {
    isLemonWebViewMock.mockReturnValue(true)
    useSiweMock.mockReturnValue({ wallet: null, isAuthenticating: true, error: null, authenticate: vi.fn() })
    const { container } = render(<WalletBar />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })

  it('offers a retry button only when the automatic sign-in failed', async () => {
    isLemonWebViewMock.mockReturnValue(true)
    useSiweMock.mockReturnValue({ wallet: null, isAuthenticating: false, error: 'boom', authenticate: vi.fn() })
    render(<WalletBar />)
    expect(await screen.findByRole('button', { name: 'Conectar' })).toBeInTheDocument()
  })
})

describe('WalletBar in a standalone browser without a connector', () => {
  it('renders nothing instead of a disabled connect button', async () => {
    isLemonWebViewMock.mockReturnValue(false)
    useSiweMock.mockReturnValue({ wallet: null, isAuthenticating: false, error: null, authenticate: vi.fn() })
    const { container } = render(<WalletBar />)
    await waitFor(() => expect(container.textContent).toBe(''))
  })
})
