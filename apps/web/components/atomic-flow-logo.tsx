'use client'

import { useId } from 'react'

export interface AtomicFlowLogoProps {
  /** Icon size in pixels (default: 40 for header) */
  size?: number
  /** Wordmark "Atomic Flow" text size in pixels (default: 22) */
  wordmarkSize?: number
  /** Show wordmark + subtitle. If false, icon only */
  showWordmark?: boolean
  /** Optional subtitle text (e.g. "Yield Aggregator"). Omit for icon + wordmark only */
  subtitle?: string
  /** Variant for light/dark background. Use 'muted' for watermark-style header. */
  variant?: 'dark' | 'light' | 'muted'
  className?: string
}

export function AtomicFlowLogo({
  size = 40,
  wordmarkSize = 22,
  showWordmark = true,
  subtitle,
  variant = 'dark',
  className = '',
}: AtomicFlowLogoProps) {
  const id = useId().replace(/:/g, '-')

  const g1 = `${id}-g1`
  const g2 = `${id}-g2`
  const g3 = `${id}-g3`
  const filterId = `${id}-glow`

  const isLight = variant === 'light'
  const isMuted = variant === 'muted'
  const mutedColor = '#4A5A72'
  const mainGradient = isMuted
    ? [mutedColor, mutedColor]
    : isLight
      ? ['#0A7FC4', '#17855A']
      : ['#12AAFF', '#26D48A']

  return (
    <div className={`flex items-center gap-1 ${className}`}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 52 52"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={`shrink-0 ${isMuted ? 'opacity-60' : ''}`}
      >
        <defs>
          <linearGradient
            id={g1}
            x1="0"
            y1="26"
            x2="52"
            y2="26"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor={mainGradient[0]} />
            <stop offset="100%" stopColor={mainGradient[1]} />
          </linearGradient>
          <linearGradient
            id={g2}
            x1="0"
            y1="26"
            x2="52"
            y2="26"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor={mainGradient[0]} stopOpacity={0.65} />
            <stop offset="100%" stopColor={mainGradient[1]} stopOpacity={0.65} />
          </linearGradient>
          <linearGradient
            id={g3}
            x1="0"
            y1="26"
            x2="52"
            y2="26"
            gradientUnits="userSpaceOnUse"
          >
            <stop offset="0%" stopColor={mainGradient[0]} stopOpacity={0.3} />
            <stop offset="100%" stopColor={mainGradient[1]} stopOpacity={0.3} />
          </linearGradient>
          {!isLight && !isMuted && (
            <filter
              id={filterId}
              x="-50%"
              y="-50%"
              width="200%"
              height="200%"
            >
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          )}
        </defs>
        {/* Nucleus */}
        <circle
          cx="26"
          cy="26"
          r="5"
          fill={`url(#${g1})`}
          filter={!isLight && !isMuted ? `url(#${filterId})` : undefined}
        />
        {/* Orbit 1 */}
        <ellipse
          cx="26"
          cy="26"
          rx="20"
          ry="8"
          stroke={`url(#${g2})`}
          strokeWidth="1.6"
          fill="none"
          transform="rotate(-35 26 26)"
        />
        {/* Orbit 2 */}
        <ellipse
          cx="26"
          cy="26"
          rx="20"
          ry="8"
          stroke={`url(#${g3})`}
          strokeWidth="1.1"
          fill="none"
          transform="rotate(55 26 26)"
        />
        {/* Particle circles */}
        <circle cx="39" cy="11" r="2.6" fill={`url(#${g1})`} opacity="0.95" />
        <circle cx="45" cy="28" r="2" fill={`url(#${g1})`} opacity="0.75" />
        <circle cx="33" cy="43" r="2.2" fill={`url(#${g1})`} opacity="0.85" />
        <circle cx="8" cy="24" r="1.8" fill={`url(#${g1})`} opacity="0.55" />
        <circle cx="14" cy="10" r="1.4" fill={`url(#${g1})`} opacity="0.4" />
        {/* Flow lines */}
        <line
          x1="29"
          y1="22"
          x2="37.5"
          y2="13"
          stroke={`url(#${g2})`}
          strokeWidth="0.9"
          strokeDasharray="2.5 2.5"
          opacity="0.6"
        />
        <line
          x1="30"
          y1="26"
          x2="43"
          y2="27.5"
          stroke={`url(#${g2})`}
          strokeWidth="0.9"
          strokeDasharray="2.5 2.5"
          opacity="0.5"
        />
        <line
          x1="28"
          y1="30"
          x2="33"
          y2="41.5"
          stroke={`url(#${g2})`}
          strokeWidth="0.9"
          strokeDasharray="2.5 2.5"
          opacity="0.55"
        />
        <line
          x1="22"
          y1="26"
          x2="9.5"
          y2="24.5"
          stroke={`url(#${g3})`}
          strokeWidth="0.9"
          strokeDasharray="2.5 2.5"
          opacity="0.4"
        />
      </svg>

      {showWordmark && (
        <div className="flex flex-col">
          <span
            className={`leading-none tracking-[-0.02em] inline-block ${isMuted ? 'font-medium' : 'font-bold'}`}
            style={
              isMuted
                ? { fontSize: wordmarkSize, color: mutedColor }
                : {
                    fontSize: wordmarkSize,
                    background: `linear-gradient(90deg, ${mainGradient[0]} 0%, ${mainGradient[1]} 100%)`,
                    backgroundSize: '100% 100%',
                    backgroundRepeat: 'no-repeat',
                    WebkitBackgroundClip: 'text',
                    WebkitTextFillColor: 'transparent',
                    backgroundClip: 'text',
                  }
            }
          >
            Atomic Flow
          </span>
          {subtitle != null && subtitle !== '' && (
            <span
              className="font-mono text-[9px] font-medium uppercase tracking-[0.22em] mt-1"
              style={{
                color: isLight ? '#8A9BB8' : '#4A5A72',
              }}
            >
              {subtitle}
            </span>
          )}
        </div>
      )}
    </div>
  )
}
