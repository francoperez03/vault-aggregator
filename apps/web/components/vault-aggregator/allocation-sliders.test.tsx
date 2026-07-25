import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import { AllocationSliders } from './allocation-sliders'

afterEach(cleanup)

describe('AllocationSliders', () => {
  it('renders one slider per protocol in the catalog', () => {
    render(<AllocationSliders value={{ morpho: 25, fluid: 25, euler: 25, aave: 25 }} onChange={vi.fn()} />)
    expect(screen.getAllByRole('slider')).toHaveLength(4)
  })

  it('shows the sum-to-100% indicator as the group anchor', () => {
    render(<AllocationSliders value={{ morpho: 25, fluid: 25, euler: 25, aave: 25 }} onChange={vi.fn()} />)
    expect(screen.getByText(/Total: 100%/)).toBeInTheDocument()
  })

  it('shows the zero-out helper text only for a slider at 0%', () => {
    render(<AllocationSliders value={{ morpho: 100, fluid: 0, euler: 0, aave: 0 }} onChange={vi.fn()} />)
    const helpers = screen.getAllByText('Poner un protocolo en 0% lo saca de tu estrategia.')
    expect(helpers).toHaveLength(3)
  })

  it('does not show the helper when nothing is at 0%', () => {
    render(<AllocationSliders value={{ morpho: 25, fluid: 25, euler: 25, aave: 25 }} onChange={vi.fn()} />)
    expect(screen.queryByText('Poner un protocolo en 0% lo saca de tu estrategia.')).not.toBeInTheDocument()
  })
})
