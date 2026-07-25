'use client'

import { useEffect, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useConnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import { hasWalletConnect } from '@/lib/wagmi/config'
import { isLemonWebView } from '@/lib/lemon/bridge'
import { useSiwe } from '@/hooks/useSiwe'

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** `--brand` connected-wallet indicator dot: one of the few permitted uses of the accent color
 * outside a primary CTA (14-UI-SPEC.md §Color). */
function ConnectedIndicator({ address }: { address: string }) {
  return (
    <div className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
      <span className="size-2 rounded-full bg-[var(--brand)]" aria-hidden="true" />
      <span className="font-mono tabular-nums">{truncate(address)}</span>
    </div>
  )
}

function RainbowConnect() {
  return (
    <ConnectButton.Custom>
      {({ account, chain, openConnectModal, mounted }) => {
        if (!mounted) return null
        if (!account || !chain) {
          return (
            <Button type="button" size="sm" onClick={openConnectModal}>
              Conectar wallet
            </Button>
          )
        }
        return <ConnectedIndicator address={account.address} />
      }}
    </ConnectButton.Custom>
  )
}

function InjectedConnect() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()

  if (isConnected && address) return <ConnectedIndicator address={address} />

  const injected = connectors[0]
  return (
    <Button type="button" size="sm" disabled={!injected || isPending} onClick={() => injected && connect({ connector: injected })}>
      {isPending ? 'Conectando…' : 'Conectar wallet'}
    </Button>
  )
}

/** Lemon WebView identity is automatic SIWE (D-03): no connect button, only the indicator once
 * authenticated. Standalone browser uses RainbowKit (or a plain injected connector when
 * WalletConnect Cloud isn't configured). */
export function WalletBar() {
  // Mounted gate: isLemonWebView() reads window, branching before hydration would mismatch
  // the server-rendered markup.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const inLemon = mounted && isLemonWebView()

  return <div className="flex items-center justify-end px-4 py-2">{inLemon ? <LemonIdentity /> : hasWalletConnect ? <RainbowConnect /> : <InjectedConnect />}</div>
}

function LemonIdentity() {
  const { wallet } = useSiwe()
  if (!wallet) return null
  return <ConnectedIndicator address={wallet} />
}
