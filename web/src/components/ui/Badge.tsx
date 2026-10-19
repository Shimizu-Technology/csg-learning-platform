import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'pending' | 'success' | 'warning' | 'danger' | 'brand' | 'info'

/** CSG family status pairs; every text/background pair meets WCAG AA (see tokens.test.ts). */
export const BADGE_TONES: Record<BadgeTone, string> = {
  neutral: 'border-line bg-surface-raised text-ink-secondary',
  pending: 'border-pending-200 bg-pending-50 text-pending-700',
  success: 'border-success-200 bg-success-50 text-success-700',
  warning: 'border-warning-200 bg-warning-50 text-warning-800',
  danger: 'border-danger-200 bg-danger-50 text-danger-700',
  brand: 'border-ruby-200 bg-ruby-50 text-ruby-700',
  info: 'border-info-200 bg-info-50 text-info-800',
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
