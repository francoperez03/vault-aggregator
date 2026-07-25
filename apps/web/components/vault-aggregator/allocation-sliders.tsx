'use client'

import { Slider } from '@/components/ui/slider'
import { cn } from '@/lib/utils'
import type { AdapterId } from '@/lib/contracts/config'
import { getVaults } from '@/lib/vaults'
import { sumBps } from '@/lib/vault/weights'

const PROTOCOL_COLOR: Record<AdapterId, string> = {
  morpho: 'var(--morpho)',
  fluid: 'var(--fluid)',
  euler: 'var(--euler)',
  aave: 'var(--aave)',
}

interface AllocationSlidersProps {
  value: Partial<Record<AdapterId, number>>
  onChange: (next: Partial<Record<AdapterId, number>>) => void
}

/** The focal point of `/rebalancear` (14-UI-SPEC §Visual Hierarchy): the sum-to-100% indicator is
 * the anchor within the slider group. Values are plain percentages (0-100); `normalizeToBps`
 * converts them to contract bps once the user confirms (D-16). */
export function AllocationSliders({ value, onChange }: AllocationSlidersProps) {
  const vaults = getVaults()
  const total = sumBps(value)
  const isValid = total === 100

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-[0.1em] text-[var(--text-secondary)]">
          Tu estrategia
        </span>
        <span
          className={cn(
            'font-mono text-sm font-semibold tabular-nums',
            isValid ? 'text-[var(--yield)]' : 'text-[var(--warning)]',
          )}
        >
          Total: {total}%
        </span>
      </div>

      <div className="flex flex-col gap-3">
        {vaults.map((vault) => {
          const pct = value[vault.id] ?? 0
          return (
            <div
              key={vault.id}
              className="flex flex-col gap-2 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] p-4"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm font-semibold" style={{ color: PROTOCOL_COLOR[vault.id] }}>
                  {vault.protocol}
                </span>
                <span className="font-mono text-sm font-semibold tabular-nums text-[var(--text-primary)]">
                  {pct}%
                </span>
              </div>
              {/* ponytail: the ::after pseudo-element pads the 18px visual thumb to a 44px touch
                  target (UI-SPEC's mobile touch-target rule) without a custom Radix thumb. */}
              <Slider
                value={[pct]}
                onValueChange={([next]) => onChange({ ...value, [vault.id]: next })}
                min={0}
                max={100}
                step={5}
                aria-label={`Peso en ${vault.protocol}`}
                className="py-2 [&_[data-slot=slider-thumb]]:relative [&_[data-slot=slider-thumb]]:after:absolute [&_[data-slot=slider-thumb]]:after:-inset-[13px] [&_[data-slot=slider-thumb]]:after:content-['']"
              />
              {pct === 0 && (
                <p className="text-xs text-[var(--text-secondary)]">
                  Poner un protocolo en 0% lo saca de tu estrategia.
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
