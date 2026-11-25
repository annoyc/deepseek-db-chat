import { useId } from 'react'

interface BrandLogoProps {
  className?: string
  title?: string
}

/** Inline SVG brand mark driven by CSS accent variables so it adapts to the active theme color. */
export function BrandLogo({ className = 'block h-full w-full', title }: BrandLogoProps) {
  const uid = useId().replace(/:/g, '')
  const bgId = `brand-bg-${uid}`
  const glowId = `brand-glow-${uid}`
  const tierMidId = `brand-tier-mid-${uid}`
  const tierBotId = `brand-tier-bot-${uid}`

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 48 48"
      fill="none"
      className={className}
      aria-hidden={title ? undefined : true}
      role={title ? 'img' : undefined}
    >
      {title && <title>{title}</title>}
      <defs>
        <linearGradient id={bgId} x1="4" y1="2" x2="44" y2="46" gradientUnits="userSpaceOnUse">
          <stop offset="0%" style={{ stopColor: 'var(--logo-stop-1)' }} />
          <stop offset="55%" style={{ stopColor: 'var(--logo-stop-2)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--logo-stop-3)' }} />
        </linearGradient>
        <radialGradient id={glowId} cx="26%" cy="18%" r="65%">
          <stop offset="0%" style={{ stopColor: 'var(--logo-glow)' }} stopOpacity="0.24" />
          <stop offset="100%" style={{ stopColor: 'var(--logo-glow)' }} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={tierMidId} x1="12.8" y1="16.4" x2="35.2" y2="26.2" gradientUnits="userSpaceOnUse">
          <stop offset="0%" style={{ stopColor: 'var(--logo-tier-mid-1)' }} />
          <stop offset="100%" style={{ stopColor: 'var(--logo-tier-mid-2)' }} />
        </linearGradient>
        <linearGradient id={tierBotId} x1="12.8" y1="23.9" x2="35.2" y2="36.6" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="100%" style={{ stopColor: 'var(--logo-tier-bot-2)' }} />
        </linearGradient>
      </defs>

      <rect width="48" height="48" rx="12.5" fill={`url(#${bgId})`} />
      <rect width="48" height="48" rx="12.5" fill={`url(#${glowId})`} />
      <rect x="0.75" y="0.75" width="46.5" height="46.5" rx="11.75" stroke="#FFFFFF" strokeOpacity="0.18" strokeWidth="1" />

      <ellipse cx="24" cy="14.5" rx="11.2" ry="4.2" fill="#FFFFFF" />

      <path
        d="M12.8 16.5C12.8 18.82 17.81 20.7 24 20.7C30.19 20.7 35.2 18.82 35.2 16.5V22.0C35.2 24.32 30.19 26.2 24 26.2C17.81 26.2 12.8 24.32 12.8 22.0Z"
        fill={`url(#${tierMidId})`}
      />

      <path
        d="M12.8 24.0C12.8 26.32 17.81 28.2 24 28.2C30.19 28.2 35.2 26.32 35.2 24.0V29.4C35.2 30.48 34.36 31.32 33.1 31.86C33.24 33.12 33.62 34.48 34.08 35.56C34.34 36.18 33.74 36.78 33.1 36.54C31.18 35.82 29.12 34.74 27.2 33.42C26.18 33.54 25.1 33.6 24 33.6C17.81 33.6 12.8 31.72 12.8 29.4Z"
        fill={`url(#${tierBotId})`}
      />
    </svg>
  )
}
