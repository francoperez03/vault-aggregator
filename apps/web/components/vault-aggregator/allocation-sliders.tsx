'use client'

import { Slider } from '@/components/ui/slider'
import { ProtocolLogo } from '@/components/vault-aggregator/protocol-logo'
import type { AdapterId } from '@/lib/contracts/config'
import { getVaults } from '@/lib/vaults'
import { redistribute } from '@/lib/vault/weights'

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
 * Four vertical faders side by side, like a mixer: inside the Lemon WebView a horizontal drag is
 * the OS back gesture and would throw the user out of the mini-app mid-adjustment, so the only
 * axis a finger travels here is up/down. Moving one fader pays for it from the others
 * proportionally (`redistribute`), so the group is always at 100 and the user never has to hunt
 * for the missing point. */
export function AllocationSliders({ value, onChange }: AllocationSlidersProps) {
  const vaults = getVaults()
  const zeroed = vaults.filter((vault) => (value[vault.id] ?? 0) === 0)

  return (
    <div className="flex flex-col gap-4">
      {/* The total guard lives in the StrategyRing above (100% asignado) — repeating it here was
          the same number twice on one screen. */}
      <span className="kicker">Tu estrategia</span>

      <div className="grid grid-cols-4 gap-2 rounded-[12px] border border-[var(--border-subtle)] bg-[var(--bg-surface)] px-2 pb-3 pt-4">
        {vaults.map((vault) => {
          const pct = value[vault.id] ?? 0
          const color = PROTOCOL_COLOR[vault.id]
          return (
            <div key={vault.id} className="flex flex-col items-center gap-3">
              <span
                className="font-mono text-base font-semibold tabular-nums"
                style={{ color: pct === 0 ? 'var(--text-secondary)' : 'var(--text-primary)' }}
              >
                {pct}%
              </span>
              {/* ponytail: the ::after pseudo-element pads the 18px visual thumb to a 44px touch
                  target (UI-SPEC's mobile touch-target rule) without a custom Radix thumb. */}
              <Slider
                orientation="vertical"
                value={[pct]}
                onValueChange={([next]) => onChange(redistribute(value, vault.id, next))}
                min={0}
                max={100}
                step={5}
                aria-label={`Peso en ${vault.protocol}`}
                rangeClassName="bg-none"
                style={{ ['--fader' as string]: color }}
                className="h-28 [&_[data-slot=slider-range]]:bg-[var(--fader)] [&_[data-slot=slider-range]]:shadow-[0_0_10px_var(--fader)] [&_[data-slot=slider-thumb]]:relative [&_[data-slot=slider-thumb]]:border-[var(--fader)] [&_[data-slot=slider-thumb]]:after:absolute [&_[data-slot=slider-thumb]]:after:-inset-[13px] [&_[data-slot=slider-thumb]]:after:content-['']"
              />
              <div className="flex flex-col items-center gap-1.5">
                <ProtocolLogo id={vault.id} size={24} />
                <span className="text-xs font-semibold" style={{ color }}>
                  {vault.protocol}
                </span>
              </div>
            </div>
          )
        })}
      </div>

      {zeroed.length > 0 && (
        <p className="px-1 text-xs text-[var(--text-secondary)]">
          Poner un protocolo en 0% lo saca de tu estrategia.
        </p>
      )}
    </div>
  )
}
