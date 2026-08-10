'use client'

import { useEffect, useState } from 'react'
import { ConnectButton } from '@rainbow-me/rainbowkit'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { hasWalletConnect } from '@/lib/wagmi/config'
import { isLemonWebView } from '@/lib/lemon/bridge'
import { useSiwe } from '@/hooks/useSiwe'

function truncate(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`
}

/** `--brand` connected-wallet indicator dot: one of the few permitted uses of the accent color
 * outside a primary CTA (14-UI-SPEC.md §Color). The pill is a menu (copy address / disconnect),
 * ported from CoinFlip's ConnectedMenu after the Lemon QA rounds. */
function ConnectedMenu({ address }: { address: `0x${string}` }) {
  const { disconnect } = useDisconnect()
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copyAddress = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      // Clipboard unavailable (http, permissions) — keep the label as-is.
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-full border border-[var(--border-subtle)] px-3 py-1.5 text-xs text-[var(--text-secondary)]">
        <span className="size-2 rounded-full bg-[var(--brand)]" aria-hidden="true" />
        <span className="font-mono tabular-nums">{copied ? 'Copiada' : truncate(address)}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void copyAddress()}>Copiar address</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => disconnect()}>Desconectar</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
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
        return <ConnectedMenu address={account.address as `0x${string}`} />
      }}
    </ConnectButton.Custom>
  )
}

function InjectedConnect() {
  const { address, isConnected } = useAccount()
  const { connect, connectors, isPending } = useConnect()

  if (isConnected && address) return <ConnectedMenu address={address} />

  const injected = connectors[0]
  // No connector available → nothing at all: a disabled connect pill is just noise (Lemon QA).
  if (!injected) return null

  return (
    <Button type="button" size="sm" disabled={isPending} onClick={() => connect({ connector: injected })}>
      {isPending ? 'Conectando…' : 'Conectar wallet'}
    </Button>
  )
}

/** Lemon WebView identity is automatic SIWE (D-03): the wallet needs no UI at all in the happy
 * path — a pill with the address is header noise inside Lemon (same verdict as CoinFlip's QA).
 * The only rendered state is a retry button when the automatic sign-in failed. */
function LemonIdentity() {
  const { wallet, isAuthenticating, error, authenticate } = useSiwe()
  if (wallet || isAuthenticating || !error) return null
  return (
    <Button type="button" size="sm" onClick={() => void authenticate()}>
      Conectar
    </Button>
  )
}

/** Standalone browser uses RainbowKit (or a plain injected connector when WalletConnect Cloud
 * isn't configured); inside Lemon see LemonIdentity. */
export function WalletBar() {
  // Mounted gate: isLemonWebView() reads window, branching before hydration would mismatch
  // the server-rendered markup.
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  const inLemon = mounted && isLemonWebView()

  return <div className="flex items-center justify-end px-4 py-2">{inLemon ? <LemonIdentity /> : hasWalletConnect ? <RainbowConnect /> : <InjectedConnect />}</div>
}
