import * as React from 'react'

import { cn } from '@/lib/utils'

function Input({ className, type, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        'file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground bg-[var(--bg-elevated)] border-border h-11 min-h-[44px] w-full min-w-0 rounded-[10px] border px-4 py-3 text-[15px] transition-[border-color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 touch-manipulation',
        'focus-visible:border-primary focus-visible:shadow-[0_0_0_3px_var(--brand-ghost)]',
        'aria-invalid:border-destructive aria-invalid:shadow-[0_0_0_3px_rgba(255,77,106,0.12)]',
        className,
      )}
      {...props}
    />
  )
}

export { Input }
