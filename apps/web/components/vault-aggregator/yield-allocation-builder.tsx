'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Slider } from '@/components/ui/slider'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { ChevronDown, ChevronUp, Wallet } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { Vault } from '@/types'
import type { Allocation } from '@/types'
import { VAULTS } from '@/lib/vaults'

const PROTOCOL_STYLES: Record<string, { bg: string; text: string }> = {
  aave: { bg: 'rgba(182,80,158,0.15)', text: 'var(--aave)' },
  morpho: { bg: 'rgba(91,142,250,0.15)', text: 'var(--morpho)' },
  fluid: { bg: 'rgba(0,212,255,0.15)', text: 'var(--fluid)' },
  euler: { bg: 'rgba(138,155,184,0.15)', text: 'var(--euler)' },
}

interface YieldAllocationBuilderProps {
  allocations: Allocation
  onApply: (allocations: Allocation) => void
  disabled?: boolean
  /** Controlled open state - when provided, collapsible is controlled externally */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

function ProtocolAvatar({ vault, className }: { vault: Vault; className?: string }) {
  const style = PROTOCOL_STYLES[vault.id]
  const initial = vault.protocol.charAt(0)
  const logoUrl = vault.logoUrl

  return (
    <div
      className={cn(
        'flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full',
        !logoUrl && !style && 'bg-muted text-muted-foreground',
        className
      )}
      style={!logoUrl && style ? { backgroundColor: style.bg, color: style.text } : undefined}
    >
      {logoUrl && (
        <img
          src={logoUrl}
          alt={vault.protocol}
          className="size-full object-cover"
          onError={(e) => {
            e.currentTarget.style.display = 'none'
            ;(e.currentTarget.nextElementSibling as HTMLElement)?.classList.remove('hidden')
          }}
        />
      )}
      <span
        className={cn(
          'flex size-full items-center justify-center text-xs font-bold',
          logoUrl && 'hidden'
        )}
      >
        {initial}
      </span>
    </div>
  )
}

export function YieldAllocationBuilder({
  allocations,
  onApply,
  disabled,
  open: controlledOpen,
  onOpenChange: controlledOnOpenChange,
}: YieldAllocationBuilderProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined
  const open = isControlled ? controlledOpen : internalOpen
  const setOpen = isControlled ? (controlledOnOpenChange ?? (() => {})) : setInternalOpen

  /** Draft allocations - only applied when user clicks Apply */
  const [draftAllocations, setDraftAllocations] = useState<Allocation>(() => ({ ...allocations }))
  const prevOpenRef = useRef(open)

  useEffect(() => {
    if (open && !prevOpenRef.current) {
      setDraftAllocations({ ...allocations })
    }
    prevOpenRef.current = open
  }, [open, allocations])

  const totalAllocation = useMemo(() => {
    return Object.values(draftAllocations).reduce((a, b) => a + b, 0)
  }, [draftAllocations])

  const updateAllocation = useCallback((vaultId: string, value: number) => {
    setDraftAllocations((prev) => ({ ...prev, [vaultId]: value }))
  }, [])

  const isValid = totalAllocation === 100
  const hasChanges = useMemo(() => {
    if (!open) return false
    return VAULTS.some((v) => (draftAllocations[v.id] ?? 0) !== (allocations[v.id] ?? 0))
  }, [draftAllocations, allocations, open])

  const canApply = hasChanges && isValid

  const handleApply = useCallback(() => {
    onApply(draftAllocations)
  }, [draftAllocations, onApply])

  return (
    <Collapsible className="w-full" open={open} onOpenChange={setOpen}>
      <Card className="overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="flex w-full min-h-[48px] items-center justify-between px-4 py-3 text-left hover:bg-[var(--bg-overlay)]/50 transition-colors rounded-t-[14px] touch-manipulation active:bg-[var(--bg-overlay)]/70">
            <div className="flex items-center gap-3">
              <Wallet className="size-5 text-muted-foreground" />
              <CardTitle className="text-sm font-semibold">Custom Yield Builder</CardTitle>
            </div>
            {open ? (
              <ChevronUp className="size-5 text-muted-foreground transition-transform" />
            ) : (
              <ChevronDown className="size-5 text-muted-foreground transition-transform" />
            )}
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <CardContent className="pt-0 pb-4 px-4 space-y-4">
            <div className="flex justify-between items-center mb-4">
              <p className="text-muted-foreground text-sm">
                Distribute your capital across vaults. Allocations must sum to 100%.
              </p>
              <span
                className={cn(
                  'font-mono text-xs font-medium',
                  isValid ? 'text-[var(--yield)]' : 'text-[var(--warning)]'
                )}
              >
                Total: {totalAllocation}% {isValid ? '✓' : '⚠'}
              </span>
            </div>

            <div className="space-y-2.5">
              {VAULTS.map((vault) => (
                <div
                  key={vault.id}
                  className="flex items-center gap-3.5 p-4 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] hover:border-[var(--border-default)] hover:bg-[var(--bg-elevated)] transition-colors"
                >
                  <ProtocolAvatar vault={vault} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-[var(--text-primary)] truncate">{vault.protocol} USDC</p>
                    <p className="font-mono text-xs font-medium text-[var(--yield)]">{vault.apy}% APY</p>
                  </div>
                  <div className="flex-1 min-w-0">
                    <Slider
                      value={[draftAllocations[vault.id] ?? 0]}
                      onValueChange={([v]) => updateAllocation(vault.id, v)}
                      max={100}
                      min={0}
                      step={5}
                      disabled={disabled}
                    />
                  </div>
                  <span className="font-mono text-xl font-semibold text-[var(--text-primary)] w-[52px] text-right shrink-0">
                    {draftAllocations[vault.id] ?? 0}%
                  </span>
                </div>
              ))}
            </div>

            <div className="flex flex-col-reverse gap-2 border-t border-[var(--border-subtle)] pt-4">
              <Button
                type="button"
                variant={canApply ? 'deposit' : 'outline'}
                onClick={handleApply}
                disabled={!canApply || disabled}
                size="lg"
                className="min-h-[48px] w-full touch-manipulation"
              >
                Apply Allocation
              </Button>
            </div>
          </CardContent>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  )
}
