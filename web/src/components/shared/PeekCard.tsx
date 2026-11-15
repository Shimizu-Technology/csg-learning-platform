import { useCallback, useContext, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FocusEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type Ref, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { BookOpen, Layers } from 'lucide-react'
import { useAuthContext } from '../../contexts/AuthContext'
import { PreviewNavigationContext } from '../../contexts/PreviewNavigationContext'
import { api } from '../../lib/api'
import { peekController } from '../../lib/peekController'
import { cachedRecordSummary, lastActiveLabel, loadRecordSummary, peekTargetFor, peekTargetKey, type PeekTarget, type RecordSummary, type RecordSummaryFact, type SummaryLoad } from '../../lib/recordSummary'
import { cohortModuleGradingPath, cohortPath, directMessagePath, lessonEditorPath, recordPath, viewerRole, type RecordRef, type ViewerRole } from '../../lib/routes'
import { useRecordViewer } from '../../lib/useRecordPath'
import { Avatar } from '../ui/Avatar'
import { Button, LinkButton } from '../ui/Button'

const CARD_WIDTH = 300
const GUTTER = 16
const GAP = 8
const DESKTOP_POINTER = '(hover: hover) and (pointer: fine)'
const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const HINT_ID = 'record-peek-hint'

/* -------------------------------------------------------------------------- */
/* Desktop pointer detection                                                  */
/* -------------------------------------------------------------------------- */

function subscribeDesktop(listener: () => void) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => {}
  const query = window.matchMedia(DESKTOP_POINTER)
  query.addEventListener?.('change', listener)
  return () => query.removeEventListener?.('change', listener)
}

function desktopPointer() {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia(DESKTOP_POINTER).matches
}

/** True on a device whose main pointer can hover (mouse or trackpad). Phones and tablets get no peek cards. */
export function useDesktopPointer() {
  return useSyncExternalStore(subscribeDesktop, desktopPointer, () => false)
}

/** A tap that focuses a link on a hybrid device must not open a card. */
let lastTouchAt = 0

function focusVisible(element: Element) {
  try {
    return element.matches(':focus-visible')
  } catch {
    return true
  }
}

/** One shared, hidden instruction for screen reader and keyboard users. */
function ensureHint() {
  if (typeof document === 'undefined' || document.getElementById(HINT_ID)) return
  const hint = document.createElement('span')
  hint.id = HINT_ID
  hint.hidden = true
  hint.textContent = 'Summary card available. Press Down Arrow to move into it.'
  document.body.appendChild(hint)
}

/* -------------------------------------------------------------------------- */
/* Trigger hook                                                               */
/* -------------------------------------------------------------------------- */

type LoadState = SummaryLoad | { status: 'loading' } | null

export interface PeekTriggerProps {
  onPointerEnter: (event: PointerEvent<HTMLAnchorElement>) => void
  onPointerLeave: (event: PointerEvent<HTMLAnchorElement>) => void
  onPointerDown: (event: PointerEvent<HTMLAnchorElement>) => void
  onFocus: (event: FocusEvent<HTMLAnchorElement>) => void
  onBlur: (event: FocusEvent<HTMLAnchorElement>) => void
  onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => void
  'aria-haspopup': 'dialog'
  'aria-expanded': boolean
  'aria-controls'?: string
  'aria-describedby': string
  'data-peek': string
}

/**
 * Peek card behavior for one record link (L-0.5). Returns nothing on touch
 * devices, inside a staff preview of the learner view, or for records the
 * viewer can't peek at; the link then behaves exactly as before.
 *
 * Accessibility: the card is a non-modal dialog (`role="dialog"`,
 * `aria-modal="false"`). It holds links and buttons, which a tooltip
 * (`aria-describedby` content) must not, and it never moves focus on its own:
 * keyboard focus opens it after the same delay as hover, Down Arrow moves
 * into it, Escape or Tab past either end returns to the page. The link
 * announces it with `aria-haspopup="dialog"` and `aria-expanded`.
 */
export function usePeekTrigger(record: RecordRef, enabled: boolean): { props: PeekTriggerProps | null; card: ReactNode; close: () => void } {
  const viewer = useRecordViewer()
  const role = viewerRole(viewer)
  // Summaries are cached per signed-in account, never per preview viewer.
  const viewerId = useAuthContext().user?.id ?? null
  const inPreview = useContext(PreviewNavigationContext) !== null
  const desktop = useDesktopPointer()
  const recordKey = JSON.stringify(record)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recordKey stands in for the record's fields.
  const target = useMemo(() => (enabled && desktop && !inPreview && viewerId ? peekTargetFor(record, role) : null), [enabled, desktop, inPreview, viewerId, role, recordKey])
  const targetKey = target ? `${viewerId}|${peekTargetKey(target)}` : null
  const key = useId()
  const cardId = `${key}-peek`
  const snapshot = useSyncExternalStore(peekController.subscribe, peekController.getSnapshot, peekController.getSnapshot)
  const [load, setLoad] = useState<LoadState>(null)
  const abortRef = useRef<AbortController | null>(null)
  const anchorRef = useRef<HTMLAnchorElement | null>(null)
  const cardRef = useRef<HTMLDivElement | null>(null)
  const open = target !== null && snapshot.openKey === key && load?.status !== 'missing'

  const abortLoad = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    setLoad((current) => (current?.status === 'loading' ? null : current))
  }, [])

  const startLoad = useCallback((peek: PeekTarget) => {
    const cached = cachedRecordSummary(peek, viewerId)
    if (cached) return setLoad({ status: 'ready', summary: cached })
    if (cached === null) return setLoad({ status: 'missing' })
    if (abortRef.current) return
    const controller = new AbortController()
    abortRef.current = controller
    setLoad({ status: 'loading' })
    void loadRecordSummary(peek, viewerId, controller.signal).then((result) => {
      if (abortRef.current === controller) abortRef.current = null
      if (result.status === 'aborted') return
      setLoad(result)
      // Nothing to show: the viewer can't open it. Close quietly.
      if (result.status === 'missing' && peekController.getSnapshot().openKey === key) peekController.close()
    })
  }, [key, viewerId])

  // A new record, a different signed-in account, or none: forget the old summary.
  useEffect(() => {
    setLoad(null)
    return () => {
      abortRef.current?.abort()
      abortRef.current = null
    }
  }, [targetKey])

  // The card closed (or never opened) while its request was in flight: cancel it.
  useEffect(() => {
    if (!open && !peekController.isPending(key) && abortRef.current) abortLoad()
  }, [open, key, abortLoad])

  // Leaving the page closes this link's card.
  useEffect(() => () => {
    if (peekController.getSnapshot().openKey === key || peekController.isPending(key)) peekController.close()
  }, [key])

  useEffect(() => {
    if (target) ensureHint()
  }, [target])

  // The card is fixed to where the link was: scrolling or resizing closes it.
  useEffect(() => {
    if (!open) return
    const onScroll = (event: Event) => {
      if (event.target instanceof Node && cardRef.current?.contains(event.target)) return
      peekController.close()
    }
    const onResize = () => peekController.close()
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [open])

  const close = () => {
    if (target && (peekController.getSnapshot().openKey === key || peekController.isPending(key))) peekController.close()
  }
  if (!target) return { props: null, card: null, close }

  const begin = (source: 'pointer' | 'focus', anchor: HTMLAnchorElement) => {
    anchorRef.current = anchor
    if (load?.status === 'missing' || cachedRecordSummary(target, viewerId) === null) return
    startLoad(target)
    peekController.enter(key, source)
  }

  const end = (source: 'pointer' | 'focus') => {
    const wasOpen = peekController.getSnapshot().openKey === key
    peekController.leave(key, source)
    if (!wasOpen) abortLoad()
  }

  const props: PeekTriggerProps = {
    onPointerEnter: (event) => {
      if (event.pointerType === 'mouse') begin('pointer', event.currentTarget)
    },
    onPointerLeave: (event) => {
      if (event.pointerType === 'mouse') end('pointer')
    },
    onPointerDown: (event) => {
      if (event.pointerType !== 'mouse') lastTouchAt = Date.now()
      // Pressing the link navigates; no card should appear after it.
      peekController.cancel(key)
    },
    onFocus: (event) => {
      if (Date.now() - lastTouchAt < 1000 || !focusVisible(event.currentTarget)) return
      begin('focus', event.currentTarget)
    },
    onBlur: (event) => {
      const next = event.relatedTarget
      if (next instanceof Node && cardRef.current?.contains(next)) return
      end('focus')
    },
    onKeyDown: (event) => {
      if (event.key === 'Escape' && (open || peekController.isPending(key))) {
        event.preventDefault()
        event.stopPropagation()
        peekController.close({ suppressFocus: true })
      } else if (event.key === 'ArrowDown' && open && cardRef.current) {
        event.preventDefault()
        const first = cardRef.current.querySelector<HTMLElement>(TABBABLE)
        ;(first || cardRef.current).focus()
      }
    },
    'aria-haspopup': 'dialog',
    'aria-expanded': open,
    'aria-controls': open ? cardId : undefined,
    'aria-describedby': HINT_ID,
    'data-peek': target.type,
  }

  const returnToLink = (options: { forward?: boolean } = {}) => {
    const anchor = anchorRef.current
    peekController.close({ suppressFocus: true })
    if (!anchor) return
    if (options.forward) {
      const next = nextTabbableAfter(anchor, cardRef.current)
      if (next) return next.focus()
    }
    anchor.focus()
  }

  const card = open && anchorRef.current ? createPortal(
    <PeekCardSurface
      id={cardId}
      ref={cardRef}
      anchor={anchorRef.current}
      load={load}
      role={role}
      record={record}
      onReturn={returnToLink}
      onRetry={() => startLoad(target)}
    />,
    document.body,
  ) : null

  return { props, card, close }
}

function nextTabbableAfter(anchor: HTMLElement, card: HTMLElement | null): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(TABBABLE)).filter((element) => !card?.contains(element) && !element.closest('[inert],[hidden]'))
  const index = all.indexOf(anchor)
  return index >= 0 ? all[index + 1] || null : null
}

/* -------------------------------------------------------------------------- */
/* The card                                                                   */
/* -------------------------------------------------------------------------- */

interface SurfaceProps {
  id: string
  ref: Ref<HTMLDivElement>
  anchor: HTMLElement
  load: LoadState
  role: ViewerRole | null
  record: RecordRef
  onReturn: (options?: { forward?: boolean }) => void
  onRetry: () => void
}

function PeekCardSurface({ id, ref, anchor, load, role, record, onReturn, onRetry }: SurfaceProps) {
  const localRef = useRef<HTMLDivElement | null>(null)
  const [position, setPosition] = useState<{ top: number; left: number; placement: 'below' | 'above' } | null>(null)
  const titleId = `${id}-title`

  const setRefs = (node: HTMLDivElement | null) => {
    localRef.current = node
    if (typeof ref === 'function') ref(node)
    else if (ref) (ref as RefObject<HTMLDivElement | null>).current = node
  }

  useLayoutEffect(() => {
    const node = localRef.current
    if (!node) return
    const rect = anchor.getBoundingClientRect()
    const height = node.offsetHeight
    const viewportWidth = document.documentElement.clientWidth || window.innerWidth
    const viewportHeight = window.innerHeight
    const left = Math.max(GUTTER, Math.min(rect.left, viewportWidth - CARD_WIDTH - GUTTER))
    const below = rect.bottom + GAP
    const fitsBelow = below + height <= viewportHeight - GAP
    const above = rect.top - GAP - height
    const placement = fitsBelow || above < GAP ? 'below' : 'above'
    setPosition({ top: placement === 'below' ? below : above, left, placement })
  }, [anchor, load?.status])

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onReturn()
      return
    }
    if (event.key !== 'Tab' || !localRef.current) return
    const focusables = Array.from(localRef.current.querySelectorAll<HTMLElement>(TABBABLE))
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === localRef.current)) {
      event.preventDefault()
      onReturn()
    } else if (!event.shiftKey && (active === last || focusables.length === 0)) {
      event.preventDefault()
      onReturn({ forward: true })
    }
  }

  const onBlur = (event: FocusEvent<HTMLDivElement>) => {
    const next = event.relatedTarget
    if (next instanceof Node && (localRef.current?.contains(next) || anchor.contains(next))) return
    peekController.leaveCard()
  }

  const summary = load?.status === 'ready' ? load.summary : null

  return (
    <div
      id={id}
      ref={setRefs}
      role="dialog"
      aria-modal="false"
      aria-labelledby={summary ? titleId : undefined}
      aria-label={summary ? undefined : 'Summary'}
      aria-busy={load?.status === 'loading' || load === null ? true : undefined}
      tabIndex={-1}
      data-peek-card={summary?.type || 'loading'}
      data-placement={position?.placement}
      onPointerEnter={(event) => { if (event.pointerType === 'mouse') peekController.enterCard() }}
      onPointerLeave={(event) => { if (event.pointerType === 'mouse') peekController.leaveCard() }}
      onFocus={() => peekController.enterCard()}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className="peek-card fixed z-[60] w-[300px] rounded-2xl border border-line bg-surface-raised p-4 text-left text-sm text-ink shadow-overlay outline-none focus-visible:ring-2 focus-visible:ring-focus"
      style={{ top: position?.top ?? -9999, left: position?.left ?? -9999, visibility: position ? 'visible' : 'hidden' }}
    >
      {summary ? (
        <SummaryBody summary={summary} titleId={titleId} role={role} record={record} onNavigate={() => peekController.close()} />
      ) : load?.status === 'error' ? (
        <div className="space-y-3">
          <p className="text-sm text-ink-secondary">Couldn't load this summary.</p>
          <Button variant="secondary" size="sm" onClick={onRetry}>Try again</Button>
        </div>
      ) : (
        <SummarySkeleton />
      )}
    </div>
  )
}

function SummarySkeleton() {
  return (
    <div className="animate-pulse motion-reduce:animate-none" aria-hidden="true">
      <div className="flex items-center gap-3">
        <span className="h-10 w-10 rounded-full bg-surface-sunken" />
        <div className="flex-1 space-y-2">
          <span className="block h-3.5 w-2/3 rounded bg-surface-sunken" />
          <span className="block h-3 w-1/2 rounded bg-surface-sunken" />
        </div>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((item) => <span key={item} className="block h-9 rounded-lg bg-surface-sunken" />)}
      </div>
    </div>
  )
}

function SummaryBody({ summary, titleId, role, record, onNavigate }: { summary: RecordSummary; titleId: string; role: ViewerRole | null; record: RecordRef; onNavigate: () => void }) {
  const subtitle = summary.type === 'student' ? [summary.subtitle, lastActiveLabel(summary.last_active_at)].filter(Boolean).join(' · ') : summary.subtitle
  return (
    <>
      <div className="flex items-start gap-3">
        {summary.type === 'student' ? (
          <Avatar name={summary.title} src={summary.avatar_url} size="md" className="mt-0.5" />
        ) : (
          <span aria-hidden="true" className="mt-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-surface-sunken text-ink-secondary">
            {summary.type === 'cohort' ? <Layers className="h-4 w-4" /> : <BookOpen className="h-4 w-4" />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <p id={titleId} className="truncate font-[650] text-ink">{summary.title}</p>
          {summary.handle && <p className="truncate text-xs font-medium text-ink-secondary">@{summary.handle}</p>}
          {subtitle && <p className="line-clamp-2 text-xs text-ink-muted">{subtitle}</p>}
        </div>
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
        {summary.facts.slice(0, 4).map((fact) => (
          <div key={fact.key} className="flex min-w-0 flex-col-reverse">
            <dt className="truncate text-xs text-ink-muted">{fact.label}</dt>
            <dd className={`truncate font-semibold tabular-nums ${fact.attention ? 'text-primary-700' : 'text-ink'}`}>{factValue(fact)}</dd>
          </div>
        ))}
      </dl>
      <PeekActions summary={summary} role={role} record={record} onNavigate={onNavigate} />
    </>
  )
}

function factValue(fact: RecordSummaryFact) {
  if (fact.value === null || fact.value === '') return '—'
  if (fact.kind === 'time' && typeof fact.value === 'string') {
    const date = new Date(fact.value)
    if (Number.isNaN(date.getTime())) return '—'
    return date.toLocaleString('en-US', { weekday: 'short', hour: 'numeric', minute: '2-digit' })
  }
  return String(fact.value)
}

type PeekAction = { key: string; label: string; to: string } | { key: string; label: string; onClick: () => void; busy?: boolean }

function PeekActions({ summary, role, record, onNavigate }: { summary: RecordSummary; role: ViewerRole | null; record: RecordRef; onNavigate: () => void }) {
  const navigate = useNavigate()
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const viewer = role === 'admin' ? { is_staff: true, is_admin: true } : role === 'instructor' ? { is_staff: true } : 'student' as const

  const actions: PeekAction[] = []
  if (summary.type === 'student') {
    const profile = recordPath({ type: 'student', id: summary.id, cohortId: summary.cohort_id }, { viewer })
    if (profile) actions.push({ key: 'profile', label: 'Open profile', to: profile })
    if (summary.cohort_id) {
      actions.push({
        key: 'message',
        label: opening ? 'Opening…' : 'Message',
        busy: opening,
        onClick: async () => {
          setOpening(true)
          setError(null)
          const result = await api.createDirectConversation({ cohort_id: summary.cohort_id!, user_ids: [summary.id] })
          setOpening(false)
          if (result.data) {
            onNavigate()
            navigate(directMessagePath(result.data.direct_conversation.id))
          } else setError(result.error || 'Could not open a direct message.')
        },
      })
    }
  } else if (summary.type === 'lesson') {
    const cohortId = summary.cohort_id || (record.type === 'lesson' ? record.cohortId : null)
    if (role === 'admin') {
      actions.push({ key: 'edit', label: 'Edit', to: lessonEditorPath(summary.id) })
      actions.push({ key: 'preview', label: 'Preview', to: lessonEditorPath(summary.id, { preview: true }) })
    } else {
      const lesson = recordPath({ type: 'lesson', id: summary.id, cohortId, view: 'learn' }, { viewer })
      if (lesson) actions.push({ key: 'open', label: 'Open lesson', to: lesson })
      if (role === 'instructor') {
        actions.push(cohortId && summary.module_id
          ? { key: 'grade', label: 'Grade module', to: cohortModuleGradingPath(cohortId, summary.module_id) }
          : { key: 'grade', label: 'Grading', to: '/admin/grading' })
      }
    }
  } else if (summary.type === 'cohort') {
    actions.push({ key: 'open', label: 'Open cohort', to: cohortPath(summary.id) })
    actions.push({ key: 'students', label: 'Students', to: cohortPath(summary.id, 'students') })
  }

  if (!actions.length) return null
  return (
    <div className="mt-4">
      <div className="flex flex-wrap gap-2">
        {actions.slice(0, 2).map((action, index) => {
          const variant = index === 0 ? 'secondary' : 'quiet'
          return 'to' in action ? (
            <LinkButton key={action.key} to={action.to} variant={variant} size="sm" onClick={(event: MouseEvent<HTMLAnchorElement>) => { if (!event.metaKey && !event.ctrlKey) onNavigate() }}>{action.label}</LinkButton>
          ) : (
            <Button key={action.key} variant={variant} size="sm" disabled={action.busy} onClick={() => void action.onClick()}>{action.label}</Button>
          )
        })}
      </div>
      {error && <p role="alert" className="mt-2 text-xs text-danger-700">{error}</p>}
    </div>
  )
}
