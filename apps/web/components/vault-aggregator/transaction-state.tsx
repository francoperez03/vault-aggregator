'use client'

import { Button } from '@/components/ui/button'
import { formatUsdc } from '@/lib/format'

// ponytail: hardcoded until lib/wagmi/chain.ts (14b, on-chain plans) exposes the active chain's
// block explorer; both target chains for this phase share the same Arbiscan family of explorers.
const ARBISCAN_BASE_URL = 'https://sepolia.arbiscan.io'

export type TxPhase =
  | { kind: 'confirm' }
  | { kind: 'signing' }
  | { kind: 'pending'; txHash?: `0x${string}` }
  | { kind: 'success'; amount?: bigint }
  | { kind: 'rejected' }
  | { kind: 'reverted'; reason?: string; /** Full diagnostic (request, raw response, stack) for the copy button. */ detail?: string }
  | { kind: 'timeout'; txHash?: `0x${string}` }
  | { kind: 'partial'; requested: bigint; actual: bigint; remaining: bigint }

interface TransactionStateProps {
  phase: TxPhase
  onPrimary: () => void
  onSecondary?: () => void
  summary?: React.ReactNode
}

function arbiscanTxUrl(txHash: `0x${string}`): string {
  return `${ARBISCAN_BASE_URL}/tx/${txHash}`
}

/** Five-state transaction machine shared by every write flow (D-13/D-15/D-17/D-19). Stateless: the
 * caller owns TxPhase, this component only renders it (14-UI-SPEC §Transaction-Shaped State Machine). */
export function TransactionState({ phase, onPrimary, onSecondary, summary }: TransactionStateProps) {
  switch (phase.kind) {
    case 'confirm':
      return (
        <div className="flex flex-col gap-6 p-5">
          <div className="text-[15px] leading-relaxed text-[var(--text-secondary)]">{summary}</div>
          <Button onClick={onPrimary}>Confirmar</Button>
        </div>
      )

    case 'signing':
      return (
        <div className="flex flex-col items-center gap-4 p-5 text-center">
          <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">Confirmá en tu wallet…</p>
          <Button onClick={onPrimary} disabled>
            Confirmando
          </Button>
        </div>
      )

    case 'pending':
      return (
        <div className="flex flex-col items-center gap-4 p-5 text-center">
          <p className="text-[15px] leading-relaxed text-[var(--text-secondary)]">Tu transacción está en curso.</p>
          {phase.txHash && (
            <a
              href={arbiscanTxUrl(phase.txHash)}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-[var(--brand)] underline"
            >
              Ver en Arbiscan
            </a>
          )}
        </div>
      )

    case 'success':
      return (
        <div className="flex flex-col items-center gap-4 p-5 text-center">
          <p className="font-mono text-[28px] font-semibold leading-none tabular-nums text-[var(--yield)] [text-shadow:0_0_24px_var(--yield-glow)]">¡Listo!</p>
          {phase.amount !== undefined && (
            // Atomic units are the contract's currency, never the screen's: this printed
            // "$25000000" for a 25-USDC deposit.
            <p className="font-mono text-lg tabular-nums text-[var(--yield)]">${formatUsdc(phase.amount)}</p>
          )}
        </div>
      )

    case 'rejected':
      return (
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[15px] leading-relaxed text-[var(--text-primary)]">
            Cancelaste la firma. No pasó nada, no se movió plata.
          </p>
          <Button onClick={onPrimary}>Volver a firmar</Button>
        </div>
      )

    case 'reverted':
      return (
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[15px] leading-relaxed text-[var(--danger)]">
            La transacción no se completó{phase.reason ? ` (${phase.reason})` : ''}. No se movió plata.
          </p>
          <Button onClick={onPrimary}>Reintentar transacción</Button>
        </div>
      )

    case 'timeout':
      return (
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[15px] leading-relaxed text-[var(--warning)]">
            No obtuvimos respuesta a tiempo. Puede que la transacción siga en curso.
          </p>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onSecondary}>
              Ver estado
            </Button>
            <Button onClick={onPrimary}>Reintentar transacción</Button>
          </div>
        </div>
      )

    case 'partial':
      return (
        <div className="flex flex-col gap-4 p-5">
          <p className="text-[15px] leading-relaxed text-[var(--warning)]">
            Pediste ${formatUsdc(phase.requested)}, se movieron ${formatUsdc(phase.actual)}, quedan $
            {formatUsdc(phase.remaining)} en el saldo de la app.
          </p>
          <Button onClick={onPrimary}>Entendido, continuar</Button>
        </div>
      )
  }
}
