'use client'

import { isMisconfigured } from '@/lib/contracts/mode'

/** No CTA: without contract addresses there is nothing the user can do from here (D-07/D-23). */
export function ConfigErrorBanner() {
  if (!isMisconfigured()) return null

  return (
    <div
      role="alert"
      className="bg-[var(--error)]/10 border-b border-[var(--error)] px-4 py-3 text-sm text-[var(--text-primary)]"
    >
      Falta configurar las direcciones de los contratos. La app no puede mostrar tu posición real.
    </div>
  )
}
