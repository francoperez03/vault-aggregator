'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { ChevronDown } from 'lucide-react'
import { FAULTS, isFaultInjectionEnabled, setNextFault, type FaultKind, type LemonCall } from '@/lib/lemon/faultInjection'

const SECTION_LABELS: Record<LemonCall, string> = {
  authenticate: 'Authenticate',
  deposit: 'Deposit',
  callSmartContract: 'Contract call',
  withdraw: 'Withdraw',
}

const FAULT_LABELS: Record<FaultKind, string> = {
  'signature-rejected': 'Signature rejected',
  'nonce-expired': 'Nonce expired',
  'different-wallet': 'Different wallet',
  'insufficient-balance': 'Insufficient balance',
  partial: 'Partial amount',
  rejected: 'Rejected',
  revert: 'Revert',
  timeout: 'Timeout',
  failed: 'Failed',
}

const CALLS = Object.keys(FAULTS) as LemonCall[]

/** Dev-only panel (D-18): picks which fault the next SDK call injects. Never seen by a real user. */
export function FaultInjectionPanel() {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState<Partial<Record<LemonCall, FaultKind | null>>>({})

  if (!isFaultInjectionEnabled()) return null

  function choose(call: LemonCall, fault: FaultKind | null) {
    setNextFault(call, fault)
    setSelected((prev) => ({ ...prev, [call]: fault }))
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="fixed bottom-20 right-4 z-[90] flex flex-col items-end gap-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 rounded-full border-dashed bg-background/90 backdrop-blur-sm shadow-lg"
          >
            <span className="text-xs font-medium">Fault injection (dev)</span>
            <ChevronDown className={cn('size-3.5 transition-transform', open && 'rotate-180')} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex max-h-[60vh] w-64 flex-col gap-3 overflow-y-auto rounded-xl border border-[var(--border-subtle)] bg-background/95 backdrop-blur-md p-3 shadow-xl">
            {CALLS.map((call) => (
              <div key={call} className="flex flex-col gap-1">
                <span className="text-xs font-semibold text-muted-foreground">{SECTION_LABELS[call]}</span>
                <div className="flex flex-col gap-1">
                  <Button
                    variant={!selected[call] ? 'secondary' : 'ghost'}
                    size="sm"
                    className="h-9 justify-start text-xs"
                    onClick={() => choose(call, null)}
                  >
                    None
                  </Button>
                  {FAULTS[call].map((fault) => (
                    <Button
                      key={fault}
                      variant={selected[call] === fault ? 'secondary' : 'ghost'}
                      size="sm"
                      className="h-9 justify-start text-xs"
                      onClick={() => choose(call, fault)}
                    >
                      {FAULT_LABELS[fault]}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
