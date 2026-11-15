import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'pending' | 'success' | 'warning' | 'danger' | 'brand' | 'info'

/** CSG family status pairs; every text/background pair meets WCAG AA (see tokens.test.ts). */
export const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-raised text-ink-secondary',
  pending: 'border-line bg-surface-sunken text-ink-secondary',
  success: 'border-success-line bg-success-soft text-success-ink',
  warning: 'border-warning-line bg-warning-soft text-warning-ink',
  danger: 'border-danger-line bg-danger-soft text-danger-ink',
  brand: 'border-primary-soft-line bg-primary-soft text-primary-ink',
  info: 'border-info-line bg-info-soft text-info-ink',
}

interface BadgeProps {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}

/** One badge: 12px / 600, sentence case, full-radius chip with an optional icon. */
export function Badge({ tone = 'neutral', icon, children, className = '' }: BadgeProps) {
  return (
    <span data-tone={tone} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-semibold leading-4 ${BADGE_TONES[tone]} ${className}`.trim()}>
      {icon}
      {children}
    </span>
  )
}
