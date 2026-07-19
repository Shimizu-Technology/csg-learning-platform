import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow?: string
  title: string
  description?: ReactNode
  actions?: ReactNode
  meta?: ReactNode
}

export function PageHeader({ eyebrow, title, description, actions, meta }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="app-eyebrow">{eyebrow}</p>}
        <h1 className={`${eyebrow ? 'mt-2' : ''} app-title`}>{title}</h1>
        {description && <div className="app-description mt-2">{description}</div>}
        {meta && <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">{meta}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  )
}
