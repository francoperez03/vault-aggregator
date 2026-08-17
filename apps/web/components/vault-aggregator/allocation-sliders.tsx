'use client'

import { Slider } from '@/components/ui/slider'
import type { AdapterId } from '@/lib/contracts/config'
import { getVaults } from '@/lib/vaults'
import { redistribute, sumBps } from '@/lib/vault/weights'

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

/** The focal point of the allocation step (14-UI-SPEC §Visual Hierarchy). Values are plain
 * percentages (0-100); `normalizeToBps` converts them to contract bps once the user confirms
 * (D-16).
 *
 * Moving one slider pays for it from the others proportionally (`redistribute`), so the group is
 * always at 100 and the user never has to hunt for the missing point. The total indicator stays as
 * a guard, not as a task: if it ever reads anything but 100, something upstream is wrong. */
export function AllocationSliders({ value, onChange }: AllocationSlidersProps) {
  const vaults = getVaults()

  return (
    <div className="flex flex-col gap-4">
      {/* The total guard lives in the StrategyRing above (100% asignado) — repeating it here was
          the same number twice on one screen. */}
      <span className="kicker">
        Tu estrategia
      </span>

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
                onValueChange={([next]) => onChange(redistribute(value, vault.id, next))}
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
