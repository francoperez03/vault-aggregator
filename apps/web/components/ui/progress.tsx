'use client'

import * as React from 'react'
import * as ProgressPrimitive from '@radix-ui/react-progress'

import { cn } from '@/lib/utils'

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        'relative h-2 min-h-[6px] w-full overflow-hidden rounded-full bg-[var(--border-subtle)]',
        className,
      )}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full min-w-0 shrink-0 transition-all duration-300 bg-[linear-gradient(90deg,var(--brand),var(--yield))] shadow-[0_0_8px_rgba(18,170,255,0.2)] rounded-full"
        style={{ width: `${value ?? 0}%` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }
