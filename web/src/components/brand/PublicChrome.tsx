import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ArrowUpRight } from 'lucide-react'
import { LOGO_SRC, PRODUCT_NAME, SCHOOL_NAME, SCHOOL_SITE_URL } from '../../lib/brand'

/** CSG logo + product name, linking home. Same mark as codeschoolofguam.com. */
export function BrandLink({ compact = false }: { compact?: boolean }) {
  return (
    <Link
      to="/"
      aria-label={`${PRODUCT_NAME} home`}
      className="inline-flex min-h-11 min-w-0 items-center gap-3 rounded-md pr-1 transition-opacity duration-150 hover:opacity-80"
    >
      <img src={LOGO_SRC} alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-md object-contain" />
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-base font-bold tracking-tight text-ink">{PRODUCT_NAME}</span>
        {!compact && <span className="block truncate text-xs font-semibold text-ink-secondary">{SCHOOL_NAME}</span>}
      </span>
    </Link>
  )
}

/** Cream header shared by the landing, catalog, and legal pages. */
export function PublicHeader({ actions }: { actions?: ReactNode }) {
  return (
    <header className="border-b border-brand-line bg-brand-cream" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <div className="safe-px mx-auto flex h-[72px] max-w-[1200px] items-center justify-between gap-3">
        <BrandLink />
        {actions && <div className="flex shrink-0 items-center gap-1 sm:gap-2">{actions}</div>}
      </div>
    </header>
  )
}

export function PublicFooter() {
  const year = new Date().getFullYear()
  return (
    <footer className="border-t border-brand-line bg-brand-cream" style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
      <div className="safe-px mx-auto flex max-w-[1200px] flex-col gap-4 py-8 text-sm text-ink-secondary sm:flex-row sm:items-center sm:justify-between">
        <p>
          © {year} {SCHOOL_NAME}. {PRODUCT_NAME} is the school's learning workspace.
        </p>
        <nav aria-label="Footer" className="-mx-2 flex flex-wrap items-center">
          <a href={SCHOOL_SITE_URL} className="inline-flex min-h-11 items-center gap-1 rounded-md px-2 font-semibold text-ink hover:text-ruby-700">
            codeschoolofguam.com <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
          <Link to="/privacy" className="inline-flex min-h-11 items-center rounded-md px-2 hover:text-ink">Privacy</Link>
          <Link to="/terms" className="inline-flex min-h-11 items-center rounded-md px-2 hover:text-ink">Terms</Link>
        </nav>
      </div>
    </footer>
  )
}
