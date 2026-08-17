import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * Rounded (12px), sentence-case, weight 600 at 15px; the primary is a solid `--action` fill with
 * a translucent border and a soft glow, secondaries are dark surfaces rather than bare outlines.
 *
 * `--action` (electric blue) is the button color. `--brand` (cyan) stays out of fills and is only
 * ever the focus ring, so an actionable thing is always distinguishable from a branded thing.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden whitespace-nowrap rounded-[12px] text-[15px] font-semibold leading-none tracking-wide outline-none transition-all duration-[var(--dur-base)] ease-[var(--ease-snap)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:ring-2 focus-visible:ring-[var(--brand)]/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'border border-[var(--brand)]/30 [background:var(--surface-action)] text-white shadow-[0_0_14px_var(--surface-action-glow),inset_0_1px_0_rgba(255,255,255,0.10)] hover:border-[var(--brand)]/50 hover:shadow-[0_0_20px_var(--surface-action-glow),inset_0_1px_0_rgba(255,255,255,0.10)] ' +
          // One-shot sweep on hover: the system answering a pointer, not decoration on a loop.
          'before:pointer-events-none before:absolute before:inset-0 before:z-[1] before:opacity-0 before:content-[""] before:bg-[linear-gradient(90deg,transparent_0%,rgba(255,255,255,0.05)_42%,rgba(255,255,255,0.35)_50%,rgba(255,255,255,0.05)_58%,transparent_100%)] hover:before:animate-[ctaSweep_200ms_linear]',
        /** The committed state: same fill, pressed-in shadow, for a button that is already the chosen path. */
        solid:
          'border border-[var(--brand)]/30 [background:var(--surface-action)] text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.25),0_0_12px_var(--surface-action-glow)]',
        destructive:
          'border border-[var(--danger)]/50 bg-gradient-to-br from-[var(--danger)]/25 to-[var(--danger)]/10 text-[var(--danger)] backdrop-blur-sm shadow-[0_0_16px_rgba(255,77,94,0.3)]',
        outline:
          'border border-[var(--border-default)] [background:var(--surface-card)] text-[var(--text-primary)] shadow-[0_1px_2px_rgba(0,0,0,0.2)] hover:border-[var(--brand)]/25 hover:shadow-[0_0_10px_var(--brand-ghost)]',
        secondary:
          'border border-[var(--brand)]/40 [background:var(--surface-card)] text-[var(--text-primary)] shadow-[0_0_16px_var(--brand-ghost),0_1px_2px_rgba(0,0,0,0.2)]',
        ghost: 'bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]',
        link: 'tracking-normal text-[var(--brand)] underline-offset-4 hover:underline',
      },
      size: {
        // 44px minimum everywhere: this ships inside a phone WebView, so every variant is already a
        // touch target and call sites never need to re-declare one.
        default: 'h-11 min-h-[44px] px-4 has-[>svg]:px-3',
        sm: 'h-11 min-h-[44px] gap-1.5 rounded-[10px] px-3 text-[13px] has-[>svg]:px-2.5',
        lg: 'h-12 min-h-[48px] px-6 has-[>svg]:px-4',
        icon: 'size-11 min-h-11 min-w-11',
        'icon-sm': 'size-11 min-h-11 min-w-11',
        'icon-lg': 'size-12 min-h-12 min-w-12',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : 'button'

  return (
    <Comp data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
  )
}

export { Button, buttonVariants }
