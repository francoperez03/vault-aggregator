'use client'

import * as React from 'react'
import * as SliderPrimitive from '@radix-ui/react-slider'

import { cn } from '@/lib/utils'

function Slider({
  className,
  rangeClassName,
  defaultValue,
  value,
  min = 0,
  max = 100,
  ...props
}: React.ComponentProps<typeof SliderPrimitive.Root> & { rangeClassName?: string }) {
  const _values = React.useMemo(
    () =>
      Array.isArray(value)
        ? value
        : Array.isArray(defaultValue)
          ? defaultValue
          : [min, max],
    [value, defaultValue, min, max],
  )

  return (
    <SliderPrimitive.Root
      data-slot="slider"
      defaultValue={defaultValue}
      value={value}
      min={min}
      max={max}
      className={cn(
        'relative flex w-full touch-none items-center select-none data-[disabled]:opacity-50 data-[orientation=vertical]:h-full data-[orientation=vertical]:min-h-44 data-[orientation=vertical]:w-auto data-[orientation=vertical]:flex-col',
        className,
      )}
      {...props}
    >
        <SliderPrimitive.Track
        data-slot="slider-track"
        className={
          'bg-border relative grow overflow-hidden rounded-full data-[orientation=horizontal]:h-1 data-[orientation=horizontal]:w-full data-[orientation=vertical]:h-full data-[orientation=vertical]:w-2 touch-none'
        }
      >
        <SliderPrimitive.Range
          data-slot="slider-range"
          // Defaults to the brand ramp; `rangeClassName` lets a caller tint the fill with the
          // colour it already has in hand (allocation-sliders knows each protocol's colour).
          className={cn(
            'absolute data-[orientation=horizontal]:h-full data-[orientation=vertical]:w-full bg-gradient-to-r from-[var(--brand-dim)] to-[var(--brand)]',
            rangeClassName,
          )}
        />
      </SliderPrimitive.Track>
      {Array.from({ length: _values.length }, (_, index) => (
        <SliderPrimitive.Thumb
          data-slot="slider-thumb"
          key={index}
          className="block size-[18px] min-w-[18px] min-h-[18px] shrink-0 rounded-full border-[1.5px] border-[var(--brand)] bg-[var(--text-primary)] shadow-[0_0_10px_var(--brand-glow)] transition-transform hover:scale-110 focus-visible:outline-hidden disabled:pointer-events-none disabled:opacity-50 touch-manipulation cursor-grab active:cursor-grabbing"
        />
      ))}
    </SliderPrimitive.Root>
  )
}

export { Slider }
