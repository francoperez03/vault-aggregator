import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

/**
 * CoinFlip's `.choice-button`, translated to variants: chamfered instead of rounded, 1.5px action
 * border over a 12%-alpha fill, display type in uppercase, and glow — never a diffuse drop shadow —
 * as the only depth cue.
 *
 * `--action` (electric blue) is the button color. `--brand` (cyan) stays out of fills and is only
 * ever the focus ring, so an actionable thing is always distinguishable from a branded thing.
 */
const buttonVariants = cva(
  "relative inline-flex shrink-0 items-center justify-center gap-2 overflow-hidden whitespace-nowrap font-[family-name:var(--font-display)] text-[15px] font-semibold uppercase tracking-[var(--tracking-label)] leading-none outline-none transition-all duration-[var(--dur-base)] ease-[var(--ease-snap)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          'chamfer border-[1.5px] border-[var(--action)] bg-[var(--action-ghost)] text-[var(--action-light)] hover:border-[var(--action-light)] hover:text-white hover:shadow-[0_0_16px_var(--action-glow)] ' +
          // One-shot cyan sweep on hover: the system answering a pointer, not decoration on a loop.
          'before:pointer-events-none before:absolute before:inset-0 before:z-[1] before:opacity-0 before:content-[""] before:bg-[linear-gradient(90deg,transparent_0%,var(--brand-ghost)_42%,var(--brand-light)_50%,var(--brand-ghost)_58%,transparent_100%)] hover:before:animate-[ctaSweep_200ms_linear]',
        /** The committed state: solid fill, for a button that is already the chosen path. */
        solid:
          'chamfer border-[1.5px] border-[var(--action)] bg-[var(--action)] text-white shadow-[inset_0_2px_4px_rgba(0,0,0,0.25),0_0_12px_var(--action-glow)]',
        destructive:
          'chamfer border-[1.5px] border-[var(--danger)] bg-[var(--danger-ghost)] text-[var(--danger)] hover:shadow-[0_0_16px_rgba(255,77,94,0.3)]',
        outline:
          'chamfer border-[1.5px] border-[var(--border-default)] bg-transparent text-[var(--text-secondary)] hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]',
        secondary:
          'chamfer border-[1.5px] border-[var(--border-strong)] bg-[var(--bg-elevated)] text-[var(--text-primary)] hover:border-[var(--brand-dim)]',
        ghost: 'chamfer bg-transparent text-[var(--text-secondary)] hover:bg-[var(--bg-overlay)] hover:text-[var(--text-primary)]',
        link: 'normal-case tracking-normal text-[var(--brand)] underline-offset-4 hover:underline',
      },
      size: {
        // 44px minimum everywhere: this ships inside a phone WebView, so every variant is already a
        // touch target and call sites never need to re-declare one.
        default: 'h-11 min-h-[44px] px-4 has-[>svg]:px-3',
        sm: 'h-11 min-h-[44px] gap-1.5 px-3 text-[13px] has-[>svg]:px-2.5',
        lg: 'h-13 min-h-[52px] px-6 text-base has-[>svg]:px-4',
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
