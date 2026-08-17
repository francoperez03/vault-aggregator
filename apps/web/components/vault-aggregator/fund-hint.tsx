'use client'

import { useEffect, useState } from 'react'
import { Copy, Check } from 'lucide-react'
import { getChainId, getChainLabel } from '@/lib/env'

/**
 * Web only (inside Lemon the account block is the way in): how money gets here — a transfer to
 * this wallet on this chain. On Sepolia the Circle faucet is the honest answer, so it is linked.
 */
export function FundHint({ address }: { address: `0x${string}` }) {
  const [copied, setCopied] = useState(false)
  const chainId = getChainId()
  const short = `${address.slice(0, 6)}…${address.slice(-4)}`

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(address)
      setCopied(true)
    } catch {
      // Clipboard unavailable (http, permissions): the address is still readable on screen.
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-[12px] border border-[var(--border-default)] [background:var(--surface-card)] px-4 py-3 text-sm">
      <p className="text-[var(--text-secondary)]">
        Mandá USDC en {getChainLabel(chainId)} a esta wallet:
      </p>
      <button
        type="button"
        onClick={() => void copy()}
        className="flex min-h-[44px] items-center justify-between gap-3 rounded-[8px] border border-[var(--border-default)] bg-[var(--bg-elevated)] px-3 font-mono text-sm text-[var(--text-primary)]"
        aria-label={`Copiar dirección ${address}`}
      >
        <span className="tabular-nums">{copied ? 'Copiada' : short}</span>
        {copied ? (
          <Check className="size-4 text-[var(--yield)]" aria-hidden="true" />
        ) : (
          <Copy className="size-4 text-[var(--text-secondary)]" aria-hidden="true" />
        )}
      </button>
      {chainId === 421614 && (
        <p className="text-xs text-[var(--text-secondary)]">
          Testnet: podés pedir USDC de prueba en{' '}
          <a
            href="https://faucet.circle.com"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--brand)] underline-offset-4 hover:underline"
          >
            faucet.circle.com
          </a>
          .
        </p>
      )}
    </div>
  )
}
