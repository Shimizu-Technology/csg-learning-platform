import type { MouseEvent, ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Link2 } from 'lucide-react'
import { PreviewLink } from '../../contexts/PreviewNavigationContext'
import { useToast } from '../../contexts/ToastContext'
import { copyText } from '../../lib/clipboard'
import { RESTORE_LIST_STATE } from '../../lib/navigationContext'
import type { BackLink } from '../../lib/recordOrigin'
import { Button, IconButton } from '../ui/Button'
import { OverflowMenu, type OverflowMenuItem } from '../ui/OverflowMenu'

/** One step of a record's breadcrumb. The last one is the record itself and is not a link. */
export interface Crumb {
  label: string
  /** Where the step goes, or null when the viewer has no page for it (rendered as text). */
  to?: string | null
}

export interface RecordQueue {
  /** "3 of 9". */
  position: string
  onPrevious?: () => void
  onNext?: () => void
  previousLabel?: string
  nextLabel?: string
  /** `vertical` (↑↓, a queue of work) or `horizontal` (‹ ›, a roster of people). */
  direction?: 'vertical' | 'horizontal'
}

export interface RecordHeaderProps {
  back: BackLink
  /** Runs before the router follows the Back link, e.g. to ask about unsaved feedback. */
  onBack?: (event: MouseEvent<HTMLAnchorElement>, to: string) => void
  /** Staff: Cohort › Student › Record. Learners: Cohort › Learn › Module › Lesson. */
  breadcrumb?: Crumb[]
  /** The uppercase type line: record type plus identity ("Submission #812 · attempt 1"). */
  type: ReactNode
  title: ReactNode
  /** Full title for the tooltip when a long one is cut. */
  titleText?: string
  headingLevel?: 1 | 2
  /** Status badge(s), on the title line. */
  status?: ReactNode
  /** The line under the title: who, where, when. */
  context?: ReactNode
  /** An avatar or icon before the text block. */
  leading?: ReactNode
  /** At most three visible, role-aware actions. Copy link is added after them. */
  actions?: ReactNode
  /** The rest of the actions, under ⋯. */
  menu?: OverflowMenuItem[]
  /** The path "Copy link" copies; defaults to this page without its return context. False hides it. */
  copyPath?: string | false
  queue?: RecordQueue
  children?: ReactNode
  className?: string
}

/** Query keys that describe how the viewer got here, not the record itself. */
const ORIGIN_KEYS = ['return_to', 'from', 'queue', 'queue_cohort_id', 'source_return_to']

/** This page's shareable URL: the record, without where this viewer came from. */
export function shareablePath(location: { pathname: string; search: string }) {
  const params = new URLSearchParams(location.search)
  ORIGIN_KEYS.forEach((key) => params.delete(key))
  const query = params.toString()
  return `${location.pathname}${query ? `?${query}` : ''}`
}

/**
 * The header for a page about one thing (L-0.3, spec §4.2): a Back link that
 * names where you came from, the breadcrumb, the record's type and identity,
 * title and status, a context line, and its actions with Copy link.
 * On phones the breadcrumb hides (the Back link carries it) and the actions
 * wrap to their own row.
 */
export function RecordHeader({ back, onBack, breadcrumb = [], type, title, titleText, headingLevel = 1, status, context, leading, actions, menu, copyPath, queue, children, className = '' }: RecordHeaderProps) {
  const location = useLocation()
  const toast = useToast()
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const path = copyPath === undefined ? shareablePath(location) : copyPath

  async function copyLink() {
    if (!path) return
    const copied = await copyText(`${window.location.origin}${path}`)
    if (copied) toast.success('Link copied')
    else toast.error("Couldn't copy the link. Copy it from the address bar instead.")
  }

  const QueuePrevious = queue?.direction === 'horizontal' ? ChevronLeft : ChevronUp
  const QueueNext = queue?.direction === 'horizontal' ? ChevronRight : ChevronDown

  return (
    <header className={`min-w-0 ${className}`} data-record-header="">
      <div className="mb-2 flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <PreviewLink
          to={back.to}
          state={RESTORE_LIST_STATE}
          onClick={onBack ? (event) => onBack(event, back.to) : undefined}
          className="-ml-2 inline-flex min-h-11 max-w-full items-center gap-1 rounded-xl px-2 font-semibold text-ink-secondary transition-colors duration-150 hover:bg-surface-sunken hover:text-ink"
          data-back-link=""
        >
          <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="truncate">{back.label}</span>
        </PreviewLink>
        {breadcrumb.length > 0 && (
          <nav aria-label="Breadcrumb" className="hidden min-w-0 sm:block">
            <ol className="flex min-w-0 flex-wrap items-center gap-1 text-ink-muted">
              {breadcrumb.map((crumb, index) => {
                const current = index === breadcrumb.length - 1
                return (
                  <li key={`${index}:${crumb.label}`} className="inline-flex min-w-0 items-center gap-1">
                    {index > 0 && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-disabled" aria-hidden="true" />}
                    {current || !crumb.to
                      ? <span aria-current={current ? 'page' : undefined} className={`max-w-[16rem] truncate ${current ? 'text-ink-secondary' : ''}`} title={crumb.label}>{crumb.label}</span>
                      : <PreviewLink to={crumb.to} className="max-w-[16rem] truncate font-semibold text-ink-secondary hover:text-ink hover:underline" title={crumb.label} onClick={onBack ? (event) => onBack(event, crumb.to!) : undefined}>{crumb.label}</PreviewLink>}
                  </li>
                )
              })}
            </ol>
          </nav>
        )}
        {queue && (
          <div className="ml-auto inline-flex items-center gap-1 font-semibold text-ink-secondary">
            <span className="tabular-nums" aria-live="polite">{queue.position}</span>
            <IconButton label={queue.previousLabel || 'Previous'} size="sm" disabled={!queue.onPrevious} onClick={queue.onPrevious}><QueuePrevious className="h-4 w-4" aria-hidden="true" /></IconButton>
            <IconButton label={queue.nextLabel || 'Next'} size="sm" disabled={!queue.onNext} onClick={queue.onNext}><QueueNext className="h-4 w-4" aria-hidden="true" /></IconButton>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-[220px] items-start gap-4">
          {leading}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted [overflow-wrap:anywhere]" data-record-type="">{type}</p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Heading className="app-title min-w-0 max-w-full [overflow-wrap:anywhere]" title={titleText}>{title}</Heading>
              {status}
            </div>
            {context && <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-muted [overflow-wrap:anywhere]">{context}</div>}
          </div>
        </div>
        {(actions || menu?.length || path) && (
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            {actions}
            {path && <Button variant="secondary" size="sm" onClick={() => void copyLink()}><Link2 className="h-4 w-4" aria-hidden="true" />Copy link</Button>}
            {menu && menu.length > 0 && <OverflowMenu label="More actions" items={menu} size="sm" />}
          </div>
        )}
      </div>
      {children}
    </header>
  )
}

/** Staff breadcrumb: Cohort › Student › Record. Steps with no name yet are left out. */
export function staffBreadcrumb({ cohort, student, record }: { cohort?: Crumb | null; student?: Crumb | null; record: string }): Crumb[] {
  return [cohort, student].filter((crumb): crumb is Crumb => Boolean(crumb?.label)).concat({ label: record })
}

/** Learner breadcrumb: Cohort › Learn › Module › Lesson. */
export function learnerBreadcrumb({ cohort, learn, module, lesson }: { cohort?: Crumb | null; learn: string; module?: Crumb | null; lesson: string }): Crumb[] {
  return [cohort, { label: 'Learn', to: learn }, module].filter((crumb): crumb is Crumb => Boolean(crumb?.label)).concat({ label: lesson })
}
