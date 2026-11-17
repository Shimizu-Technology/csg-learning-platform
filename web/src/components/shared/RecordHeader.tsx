import { useEffect, useState, type MouseEvent, type ReactNode, type Ref } from 'react'
import { useLocation } from 'react-router-dom'
import { Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Link2 } from 'lucide-react'
import { PreviewLink } from '../../contexts/PreviewNavigationContext'
import { copyText } from '../../lib/clipboard'
import { RESTORE_LIST_STATE } from '../../lib/navigationContext'
import { useQueueShortcuts } from '../../lib/recordQueue'
import { fromWebPath, toWebPath } from '../../lib/recordDestination'
import type { BackLink } from '../../lib/recordOrigin'
import { Button, IconButton } from '../ui/Button'
import { OverflowMenu, type OverflowMenuItem } from '../ui/OverflowMenu'

/** One step of a record's breadcrumb. The last one is the record itself: a link only when it has `to` (a workbench names the lesson). */
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
  /** J / K move through the queue (off while typing or in a dialog). Default true. */
  shortcuts?: boolean
}

export interface RecordHeaderProps {
  back: BackLink
  /** Runs before the router follows the Back link, e.g. to ask about unsaved feedback. */
  onBack?: (event: MouseEvent<HTMLAnchorElement>, to: string) => void
  /** Makes the title focusable (tabIndex -1) so a page can move focus to it, e.g. after a queue step. */
  headingRef?: Ref<HTMLHeadingElement>
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

const ID = /^[1-9]\d{0,15}$/
const SLUG = /^[a-z][a-z_-]{0,31}$/

/**
 * Record pages that don't map to a RecordDestination, with the query keys
 * that pick what the page shows. Anything else in the URL (return context,
 * sign-in tickets, tokens, redirect targets, tracking) is dropped.
 */
const PAGE_PARAMS: [RegExp, Record<string, RegExp>][] = [
  [/^\/admin\/cohorts\/[1-9]\d*$/, { tab: SLUG }],
  [/^\/admin\/cohorts\/[1-9]\d*\/students\/[1-9]\d*(?:\/[a-z-]+)?$/, { objective: ID, plan_id: ID }],
  [/^\/admin\/cohorts\/[1-9]\d*\/modules\/[1-9]\d*\/grading$/, { view: SLUG, filter: SLUG, student: ID, review: ID, week: /^(?:[1-9]\d{0,2}|all)$/ }],
]

/**
 * This page's shareable URL: the record and its scope (cohort, step anchor),
 * built from an allowlist, never from whatever else is in the address bar.
 * Lessons, submissions, help requests and interventions go through the
 * RecordDestination contract (#247); other record pages keep only their own
 * view keys; anything unknown copies the bare path.
 */
export function shareablePath(location: { pathname: string; search: string; hash?: string }) {
  const { pathname } = location
  const destination = fromWebPath(`${pathname}${location.search}${location.hash || ''}`)
  const allowed = PAGE_PARAMS.find(([pattern]) => pattern.test(pathname))?.[1]
  const canonical = !allowed && destination && toWebPath(destination)
  if (canonical) return canonical

  if (!allowed) return pathname
  const current = new URLSearchParams(location.search)
  const params = new URLSearchParams()
  for (const [key, pattern] of Object.entries(allowed)) {
    const values = current.getAll(key)
    if (values.length === 1 && pattern.test(values[0])) params.set(key, values[0])
  }
  const query = params.toString()
  return `${pathname}${query ? `?${query}` : ''}`
}

/**
 * The header for a page about one thing (L-0.3, spec §4.2): a Back link that
 * names where you came from, the breadcrumb, the record's type and identity,
 * title and status, a context line, and its actions with Copy link.
 * On phones the breadcrumb hides (the Back link carries it) and the actions
 * wrap to their own row.
 */
export function RecordHeader({ back, onBack, headingRef, breadcrumb = [], type, title, titleText, headingLevel = 1, status, context, leading, actions, menu, copyPath, queue, children, className = '' }: RecordHeaderProps) {
  const location = useLocation()
  const Heading = headingLevel === 1 ? 'h1' : 'h2'
  const path = copyPath === undefined ? shareablePath(location) : copyPath
  // Confirmed in place (spec §5: success shows where the action happened), then reset.
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  useEffect(() => {
    if (copyState === 'idle') return
    const timer = window.setTimeout(() => setCopyState('idle'), 2500)
    return () => window.clearTimeout(timer)
  }, [copyState])

  async function copyLink() {
    if (!path) return
    setCopyState((await copyText(`${window.location.origin}${path}`)) ? 'copied' : 'failed')
  }

  useQueueShortcuts(queue && queue.shortcuts !== false ? { onPrevious: queue.onPrevious, onNext: queue.onNext } : null)
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
                    {!crumb.to
                      ? <span aria-current={current ? 'page' : undefined} className={`max-w-[16rem] truncate ${current ? 'text-ink-secondary' : ''}`} title={crumb.label}>{crumb.label}</span>
                      : <PreviewLink to={crumb.to} className="max-w-[16rem] truncate font-semibold text-ink-secondary hover:text-ink hover:underline" title={crumb.label} onClick={onBack ? (event) => onBack(event, crumb.to!) : undefined}>{crumb.label}</PreviewLink>}
                  </li>
                )
              })}
            </ol>
          </nav>
        )}
        {queue && (
          <div className="ml-auto inline-flex items-center gap-1 font-semibold text-ink-secondary" role="group" aria-label="Queue" data-record-queue="">
            <span className="tabular-nums" aria-live="polite">{queue.position}</span>
            <IconButton label={queue.previousLabel || 'Previous'} size="sm" disabled={!queue.onPrevious} onClick={queue.onPrevious} aria-keyshortcuts={queue.shortcuts === false ? undefined : 'K'}><QueuePrevious className="h-4 w-4" aria-hidden="true" /></IconButton>
            <IconButton label={queue.nextLabel || 'Next'} size="sm" disabled={!queue.onNext} onClick={queue.onNext} aria-keyshortcuts={queue.shortcuts === false ? undefined : 'J'}><QueueNext className="h-4 w-4" aria-hidden="true" /></IconButton>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-start gap-x-4 gap-y-3">
        <div className="flex min-w-0 flex-1 basis-[220px] items-start gap-4">
          {leading}
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold uppercase tracking-[0.06em] text-ink-muted [overflow-wrap:anywhere]" data-record-type="">{type}</p>
            <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <Heading ref={headingRef} tabIndex={headingRef ? -1 : undefined} className={`app-title min-w-0 max-w-full [overflow-wrap:anywhere] ${headingRef ? 'focus:outline-none' : ''}`} title={titleText}>{title}</Heading>
              {status}
            </div>
            {context && <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1 text-sm text-ink-muted [overflow-wrap:anywhere]">{context}</div>}
          </div>
        </div>
        {(actions || menu?.length || path) && (<>
          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            {actions}
            {path && <Button variant="secondary" size="sm" onClick={() => void copyLink()} data-copy-link="">{copyState === 'copied' ? <Check className="h-4 w-4 text-success-ink" aria-hidden="true" /> : <Link2 className="h-4 w-4" aria-hidden="true" />}{copyState === 'copied' ? 'Link copied' : 'Copy link'}</Button>}
            <span role="status" className="sr-only">{copyState === 'copied' ? 'Link copied' : copyState === 'failed' ? "Couldn't copy the link. Copy it from the address bar instead." : ''}</span>
            {menu && menu.length > 0 && <OverflowMenu label="More actions" items={menu} size="sm" />}
          </div>
          {copyState === 'failed' && <p className="w-full text-sm text-danger-ink sm:text-right">Couldn't copy the link. Copy it from the address bar instead.</p>}
        </>)}
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
