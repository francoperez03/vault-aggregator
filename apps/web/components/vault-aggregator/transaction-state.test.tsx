import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { TransactionState, type TxPhase } from './transaction-state';

const noop = () => {};

afterEach(cleanup);

describe('TransactionState', () => {
  it('confirm: renders the summary and an enabled primary CTA', () => {
    render(
      <TransactionState
        phase={{ kind: 'confirm' }}
        onPrimary={noop}
        summary={<p>Depositás 100 USDC</p>}
      />,
    );
    expect(screen.getByText('Depositás 100 USDC')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeEnabled();
  });

  it('signing: shows the handoff copy and disables the CTA', () => {
    render(<TransactionState phase={{ kind: 'signing' }} onPrimary={noop} />);
    expect(screen.getByText('Confirmá en tu wallet…')).toBeInTheDocument();
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('pending: links to Arbiscan when a txHash is present and renders no CTA', () => {
    const txHash = `0x${'ab'.repeat(32)}` as const;
    render(<TransactionState phase={{ kind: 'pending', txHash }} onPrimary={noop} />);
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', expect.stringContaining(txHash));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('pending: renders no link when txHash is absent', () => {
    render(<TransactionState phase={{ kind: 'pending' }} onPrimary={noop} />);
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('success renders the amount as USDC, never as atomic units', () => {
    render(<TransactionState phase={{ kind: 'success', amount: 25_000_000n }} onPrimary={noop} />);
    expect(screen.getByText('$25.00')).toBeInTheDocument();
    expect(screen.queryByText('$25000000')).not.toBeInTheDocument();
  });

  it('success: uses the yield token class and never the error token class', () => {
    const { container } = render(<TransactionState phase={{ kind: 'success' }} onPrimary={noop} />);
    expect(container.innerHTML).toMatch(/--yield/);
    expect(container.innerHTML).not.toMatch(/--danger/);
  });

  it('rejected: exact copy, CTA "Volver a firmar", never the error token class', () => {
    const { container } = render(<TransactionState phase={{ kind: 'rejected' }} onPrimary={noop} />);
    expect(screen.getByText('Cancelaste la firma. No pasó nada, no se movieron fondos.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a firmar' })).toBeInTheDocument();
    expect(container.innerHTML).not.toMatch(/--danger/);
  });

  it('reverted: uses the error token class, shows the reason, CTA "Reintentar transacción"', () => {
    const { container } = render(
      <TransactionState phase={{ kind: 'reverted', reason: 'slippage' }} onPrimary={noop} />,
    );
    expect(container.innerHTML).toMatch(/--danger/);
    expect(screen.getByText(/slippage/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar transacción' })).toBeInTheDocument();
  });

  it('timeout: uses the warning token class, CTAs "Ver estado" and "Reintentar transacción"', () => {
    const { container } = render(
      <TransactionState phase={{ kind: 'timeout' }} onPrimary={noop} onSecondary={noop} />,
    );
    expect(container.innerHTML).toMatch(/--warning/);
    expect(screen.getByRole('button', { name: 'Ver estado' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reintentar transacción' })).toBeInTheDocument();
  });

  it('partial: uses the warning token class, shows the three amounts and a single "Entendido, continuar" CTA', () => {
    const { container } = render(
      <TransactionState
        phase={{ kind: 'partial', requested: 100_000000n, actual: 60_000000n, remaining: 40_000000n }}
        onPrimary={noop}
      />,
    );
    expect(container.innerHTML).toMatch(/--warning/);
    expect(screen.getByText(/Pediste \$100\.00, se movieron \$60\.00, quedan \$40\.00/)).toBeInTheDocument();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent('Entendido, continuar');
  });

  it('every CTA label carries an object, never a bare verb', () => {
    const phases: TxPhase[] = [
      { kind: 'rejected' },
      { kind: 'reverted' },
      { kind: 'timeout' },
      { kind: 'partial', requested: 1n, actual: 1n, remaining: 0n },
    ];
    for (const phase of phases) {
      const { unmount } = render(<TransactionState phase={phase} onPrimary={noop} onSecondary={noop} />);
      for (const button of screen.getAllByRole('button')) {
        expect(button.textContent?.trim().split(/\s+/).length ?? 0).toBeGreaterThan(1);
      }
      unmount();
    }
  });
});
