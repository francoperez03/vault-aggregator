import type { AdapterId } from '@/lib/contracts/config'
import { cn } from '@/lib/utils'

const PROTOCOL_LOGO: Record<AdapterId, string> = {
  aave: '/vault-logos/aave.svg',
  morpho: '/vault-logos/morpho.png',
  fluid: '/vault-logos/fluid.png',
  euler: '/vault-logos/euler.png',
}

interface ProtocolLogoProps {
  id: AdapterId
  /** Rendered box in px; the mark fills it. 20 in rows and legends, 24 on the sliders. */
  size?: 20 | 24
  className?: string
}

/** The protocol's own brand mark in a circle, in place of the identity-color dot. Decorative:
 * the name always sits next to it, so the image carries no alt text of its own. Sits on the
 * elevated surface so PNG marks with a dark plate (Euler) blend instead of showing a square. */
export function ProtocolLogo({ id, size = 20, className }: ProtocolLogoProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        'inline-flex shrink-0 overflow-hidden rounded-full bg-[var(--bg-elevated)] ring-1 ring-[var(--border-subtle)]',
        size === 24 ? 'size-6' : 'size-5',
        className,
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element -- static asset, images.unoptimized */}
      <img src={PROTOCOL_LOGO[id]} alt="" width={size} height={size} className="size-full object-cover" />
    </span>
  )
}
