import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { WithdrawView } from './withdraw-view'
import type { TxPhase } from '@/components/vault-aggregator/transaction-state'

afterEach(cleanup)

const TOTAL = 1_000_000_000n // 1,000 USDC atomic

function renderStep1(phase: TxPhase = { kind: 'confirm' }, onRedeem = vi.fn()) {
  return render(
    <WithdrawView
      totalUsdc={TOTAL}
      step={1}
      pendingAmount={null}
      phase={phase}
      onRedeem={onRedeem}
      onSettle={vi.fn()}
      onAcknowledge={vi.fn()}
    />,
  )
}

function renderStep2(phase: TxPhase, overrides: { onSettle?: () => void; onAcknowledge?: () => void } = {}) {
  return render(
    <WithdrawView
      totalUsdc={TOTAL}
      step={2}
      pendingAmount={600_000_000n}
      phase={phase}
      onRedeem={vi.fn()}
      onSettle={overrides.onSettle ?? vi.fn()}
      onAcknowledge={overrides.onAcknowledge ?? vi.fn()}
    />,
  )
}

describe('WithdrawView step 1: redeem real on-chain', () => {
  it('CTA reads "Retirar al saldo de la app" y queda deshabilitada hasta elegir un preset', () => {
    renderStep1()
    expect(screen.getByRole('button', { name: 'Retirar al saldo de la app' })).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'MAX' }))
    expect(screen.getByRole('button', { name: 'Retirar al saldo de la app' })).toBeEnabled()
  })

  it('presets 25/50/75/MAX traducen a exactamente 2500/5000/7500/10000 bps', () => {
    const onRedeem = vi.fn()
    renderStep1({ kind: 'confirm' }, onRedeem)
    fireEvent.click(screen.getByRole('button', { name: '25%' }))
    expect(screen.getByText('$250.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retirar al saldo de la app' }))
    expect(onRedeem).toHaveBeenCalledWith(2500n)

    fireEvent.click(screen.getByRole('button', { name: 'MAX' }))
    expect(screen.getByText('$1,000.00')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Retirar al saldo de la app' }))
    expect(onRedeem).toHaveBeenCalledWith(10000n)
  })

  it('el paso 1 nunca renderiza el copy de reconciliación parcial (Pitfall 4: redeem es atómico)', () => {
    renderStep1({ kind: 'signing' })
    expect(screen.queryByText(/quedan \$/)).not.toBeInTheDocument()
  })
})

describe('WithdrawView step 2: settle real contra el SDK de Lemon', () => {
  it('muestra el copy del monto medido en el paso 1 y dispara onSettle al enviar', () => {
    const onSettle = vi.fn()
    renderStep2({ kind: 'confirm' }, { onSettle })
    expect(screen.getByText(/Moviste \$600.00 USDC al saldo de la app/)).toBeInTheDocument()
    expect(screen.getByText(/Enviálo a Lemon para terminar/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Enviar a Lemon' }))
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  it('partial: muestra los tres montos y "Entendido, continuar" dispara onAcknowledge, no un reintento', () => {
    const onAcknowledge = vi.fn()
    renderStep2(
      { kind: 'partial', requested: 600_000_000n, actual: 300_000_000n, remaining: 300_000_000n },
      { onAcknowledge },
    )
    expect(screen.getByText(/quedan \$300.00 en el saldo de la app/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Entendido, continuar' }))
    expect(onAcknowledge).toHaveBeenCalledTimes(1)
  })

  it('rejected: cancelaste la firma, ningún copy de parcial ni de error de Lemon', () => {
    renderStep2({ kind: 'rejected' })
    expect(screen.getByText(/Cancelaste la firma/)).toBeInTheDocument()
    expect(screen.queryByText(/Lemon no pudo completar/)).not.toBeInTheDocument()
  })

  it('failed (reverted de Lemon): usa el copy dedicado, nunca el genérico de tx revertida, CTA "Reintentar envío"', () => {
    const onSettle = vi.fn()
    renderStep2({ kind: 'reverted' }, { onSettle })
    expect(
      screen.getByText('Lemon no pudo completar este paso. Tus fondos on-chain están seguros en el saldo de la app.'),
    ).toBeInTheDocument()
    expect(screen.queryByText(/No se movió plata/)).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Reintentar envío' }))
    expect(onSettle).toHaveBeenCalledTimes(1)
  })

  it('timeout: nunca se presenta como success, ofrece reintentar', () => {
    renderStep2({ kind: 'timeout' })
    expect(screen.getByText(/No obtuvimos respuesta a tiempo/)).toBeInTheDocument()
    expect(screen.queryByText('¡Listo!')).not.toBeInTheDocument()
  })
})
