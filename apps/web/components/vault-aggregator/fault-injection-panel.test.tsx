import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { FaultInjectionPanel } from './fault-injection-panel'
import { clearFaults, consumeNextFault } from '@/lib/lemon/faultInjection'

afterEach(() => {
  cleanup()
  vi.unstubAllEnvs()
  clearFaults()
})

describe('FaultInjectionPanel', () => {
  it('renders nothing without NEXT_PUBLIC_FAULT_INJECTION set', () => {
    vi.stubEnv('NEXT_PUBLIC_FAULT_INJECTION', '')
    const { container } = render(<FaultInjectionPanel />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders nothing when the env var is anything other than "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_FAULT_INJECTION', 'yes')
    const { container } = render(<FaultInjectionPanel />)
    expect(container).toBeEmptyDOMElement()
  })

  it('renders the trigger when NEXT_PUBLIC_FAULT_INJECTION is "true"', () => {
    vi.stubEnv('NEXT_PUBLIC_FAULT_INJECTION', 'true')
    render(<FaultInjectionPanel />)
    expect(screen.getByText('Fault injection (dev)')).toBeInTheDocument()
  })

  it('queues the chosen fault for its call via setNextFault', async () => {
    vi.stubEnv('NEXT_PUBLIC_FAULT_INJECTION', 'true')
    render(<FaultInjectionPanel />)

    fireEvent.click(screen.getByText('Fault injection (dev)'))
    const option = await waitFor(() => screen.getByText('Signature rejected'))
    fireEvent.click(option)

    expect(consumeNextFault('authenticate')).toBe('signature-rejected')
    expect(consumeNextFault('deposit')).toBeNull()
  })
})
