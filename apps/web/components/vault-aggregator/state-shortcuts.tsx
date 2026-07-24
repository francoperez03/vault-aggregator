'use client'

import { useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible'
import { cn } from '@/lib/utils'
import { ChevronDown, LayoutDashboard, Wallet, AlertTriangle, Loader2 } from 'lucide-react'

export type DemoState = 'default' | 'empty' | 'error' | 'loading'

interface StateShortcutsProps {
  currentState: DemoState
  onStateChange: (state: DemoState) => void
}

const STATE_LABELS: Record<DemoState, string> = {
  default: 'Default (mock)',
  empty: 'Empty balance',
  error: 'Error state',
  loading: 'Loading',
}

const STATE_ICONS: Record<DemoState, React.ReactNode> = {
  default: <LayoutDashboard className="size-3.5" />,
  empty: <Wallet className="size-3.5" />,
  error: <AlertTriangle className="size-3.5" />,
  loading: <Loader2 className="size-3.5" />,
}

export function StateShortcuts({ currentState, onStateChange }: StateShortcutsProps) {
  const [open, setOpen] = useState(false)

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="fixed bottom-20 right-4 z-[90] flex flex-col items-end gap-2">
        <CollapsibleTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-9 gap-2 rounded-full border-dashed bg-background/90 backdrop-blur-sm shadow-lg"
          >
            <span className="text-xs font-medium">State: {STATE_LABELS[currentState]}</span>
            <ChevronDown
              className={cn(
                'size-3.5 transition-transform',
                open && 'rotate-180'
              )}
            />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="flex flex-col gap-1 rounded-xl border border-[var(--border-subtle)] bg-background/95 backdrop-blur-md p-2 shadow-xl">
            {(Object.keys(STATE_LABELS) as DemoState[]).map((state) => (
              <Button
                key={state}
                variant={currentState === state ? 'secondary' : 'ghost'}
                size="sm"
                className="h-8 justify-start gap-2 text-xs"
                onClick={() => {
                  onStateChange(state)
                  setOpen(false)
                }}
              >
                {STATE_ICONS[state]}
                {STATE_LABELS[state]}
              </Button>
            ))}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
