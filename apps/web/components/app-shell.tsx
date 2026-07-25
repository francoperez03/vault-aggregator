'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { ArrowDownCircle, ArrowUpCircle, RefreshCw, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isMisconfigured } from '@/lib/contracts/mode'
import { ConfigErrorBanner } from '@/components/config-error-banner'
import { FaultInjectionPanel } from '@/components/vault-aggregator/fault-injection-panel'

const NAV_ITEMS = [
  { href: '/', label: 'Posición', icon: Wallet },
  { href: '/depositar', label: 'Depositar', icon: ArrowDownCircle },
  { href: '/rebalancear', label: 'Rebalancear', icon: RefreshCw },
  { href: '/retirar', label: 'Retirar', icon: ArrowUpCircle },
] as const

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const misconfigured = isMisconfigured()

  return (
    <div className="flex min-h-dvh flex-col">
      <ConfigErrorBanner />
      <main className="flex-1 pb-24">{children}</main>
      {!misconfigured && (
        <nav
          aria-label="Navegación principal"
          className="fixed bottom-0 left-1/2 z-50 flex w-full max-w-[430px] -translate-x-1/2 items-stretch border-t border-[var(--border-default)] bg-[var(--bg-surface)]"
          style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                className={cn(
                  'flex min-h-[44px] flex-1 flex-col items-center justify-center gap-1 py-2 text-xs',
                  active ? 'text-[var(--brand)]' : 'text-[var(--text-secondary)]',
                )}
              >
                <Icon className="size-5" aria-hidden="true" />
                {label}
              </Link>
            )
          })}
        </nav>
      )}
      <FaultInjectionPanel />
    </div>
  )
}
