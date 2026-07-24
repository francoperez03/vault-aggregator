import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import { cva, type VariantProps } from 'class-variance-authority'

import { cn } from '@/lib/utils'

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-[12px] text-[15px] font-semibold tracking-wide transition-all duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-base)] aria-invalid:ring-destructive/20 aria-invalid:border-destructive active:scale-[0.98] relative overflow-hidden",
  {
    variants: {
      variant: {
        default:
          'bg-[var(--brand)] text-primary-foreground border border-[rgba(18,170,255,0.25)] shadow-[0_0_12px_rgba(18,170,255,0.12),inset_0_1px_0_rgba(255,255,255,0.06)] hover:border-[rgba(18,170,255,0.4)] hover:shadow-[0_0_16px_rgba(18,170,255,0.18)] active:scale-[0.99]',
        deposit:
          'bg-[linear-gradient(90deg,#00C0FF,#3CC780)] !text-[#000000] [&_svg]:!stroke-[#000000] [&_svg]:stroke-[2.5] [&_svg]:text-[#000000] active:scale-[0.99] before:absolute before:inset-0 before:z-0 before:overflow-hidden before:rounded-[12px] before:content-[""] before:pointer-events-none before:bg-[linear-gradient(105deg,transparent_0%,rgba(255,255,255,0.05)_10%,rgba(255,255,255,0.25)_30%,rgba(255,255,255,0.5)_50%,rgba(255,255,255,0.25)_70%,rgba(255,255,255,0.05)_90%,transparent_100%)] before:bg-[length:200%_100%] before:animate-[ctaShineFull_4s_ease-in-out_1s_infinite]',
        depositWrapper:
          'p-[2px] rounded-[14px] [background:conic-gradient(from_var(--border-angle),#00C0FF,#3CC780,#26D48A,#00C0FF)] animate-[borderGradientRotate_4s_linear_infinite]',
        destructive:
          'bg-gradient-to-br from-[rgba(255,77,106,0.25)] to-[rgba(255,77,106,0.1)] text-[var(--error)] border border-[rgba(255,77,106,0.5)] backdrop-blur-sm shadow-[0_0_16px_rgba(255,77,106,0.3)] active:scale-[0.99]',
        outline:
          'bg-[var(--bg-overlay)]/80 backdrop-blur-md text-primary border border-[var(--border-default)] hover:border-[rgba(18,170,255,0.25)] shadow-[0_1px_2px_rgba(0,0,0,0.2)] hover:shadow-[0_0_10px_rgba(18,170,255,0.06)] active:scale-[0.99]',
        secondary:
          'bg-gradient-to-b from-[var(--bg-overlay)] to-[var(--bg-elevated)] text-foreground border border-[rgba(18,170,255,0.4)] shadow-[0_0_16px_rgba(18,170,255,0.08),0_1px_2px_rgba(0,0,0,0.2)] active:scale-[0.99]',
        ghost:
          'bg-transparent hover:bg-[var(--bg-overlay)] hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-10 min-h-[44px] px-4 py-2 has-[>svg]:px-3',
        sm: 'h-9 min-h-[40px] rounded-[10px] gap-1.5 px-3 has-[>svg]:px-2.5',
        lg: 'h-12 min-h-[48px] rounded-[12px] px-6 has-[>svg]:px-4',
        icon: 'size-11 min-w-11 min-h-11',
        'icon-sm': 'size-10 min-w-10 min-h-10',
        'icon-lg': 'size-12 min-w-12 min-h-12',
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
  const isDeposit = variant === 'deposit'

  if (isDeposit) {
    const { children, ...restProps } = props
    return (
      <span
        className={cn(
          'inline-flex min-w-0 flex-1 basis-0 rounded-[14px] p-[2px] [background:conic-gradient(from_var(--border-angle),#00C0FF,#3CC780,#26D48A,#00C0FF)] animate-[borderGradientRotate_4s_linear_infinite]',
          className
        )}
      >
        <Comp
          data-slot="button"
          className={cn(
            buttonVariants({ variant: 'deposit', size }),
            'h-full w-full min-h-[48px]',
            className
          )}
          {...restProps}
        >
          <span className="relative z-10 inline-flex items-center justify-center gap-2">
            {children}
          </span>
        </Comp>
      </span>
    )
  }

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
