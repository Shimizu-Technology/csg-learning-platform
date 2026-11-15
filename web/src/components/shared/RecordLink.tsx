import { useContext, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthContext } from '../../contexts/AuthContext'
import { PreviewLink, PreviewNavigationContext } from '../../contexts/PreviewNavigationContext'
import { listLinkState } from '../../lib/navigationContext'
import { recordPath, type RecordRef, type RecordViewer } from '../../lib/routes'

/**
 * `inline` underlines the name (body text, headers); `plain` underlines on
 * hover only (dense rows, context lines); `app` is the ruby action-link style;
 * `unstyled` leaves styling to `className`.
 */
export type RecordLinkVariant = 'inline' | 'plain' | 'app' | 'unstyled'

const VARIANTS: Record<RecordLinkVariant, string> = {
  inline: 'record-link',
  plain: 'record-link-plain',
  app: 'app-link',
  unstyled: '',
}

export interface RecordLinkProps {
  /** The record to open. (Named `record` because `ref` is reserved by React.) */
  record: RecordRef
  children: ReactNode
  variant?: RecordLinkVariant
  /** Applied to the link and to the plain-text fallback (layout, truncation). */
  className?: string
  /** Applied to the link only. */
  linkClassName?: string
  /** A 44px-tall target for links that stand on their own (not inside a sentence). */
  touchTarget?: boolean
  /** Label for the destination's "Back to …" link, sent as router state with this page's URL. */
  returnLabel?: string
  title?: string
  'aria-label'?: string
  /** Override the viewer (tests, or a page that renders another role's view). */
  viewer?: RecordViewer
}

/**
 * Every mention of a record (L-0.2): a real link, so ⌘/Ctrl-click and
 * "open in new tab" work, that tells the destination where it was opened
 * from. When the viewer has no page for the record it renders the same text
 * without a link, never a dead link.
 */
export function RecordLink({ record, children, variant = 'inline', className = '', linkClassName = '', touchTarget = false, returnLabel, title, viewer, 'aria-label': ariaLabel }: RecordLinkProps) {
  const { user } = useAuthContext()
  const location = useLocation()
  // Inside a staff preview of the learner view, links must open learner pages.
  const preview = useContext(PreviewNavigationContext)
  const currentPage = `${location.pathname}${location.search}`
  const path = recordPath(record, { viewer: viewer !== undefined ? viewer : preview ? 'student' : user, returnTo: currentPage })
  const layout = `${touchTarget ? 'inline-flex min-h-11 items-center' : ''} ${className}`.trim()

  if (!path) return <span className={layout || undefined} title={title} data-record-link="unavailable">{children}</span>

  const classes = `${VARIANTS[variant]} ${layout} ${linkClassName}`.replace(/\s+/g, ' ').trim()
  return (
    <PreviewLink to={path} className={classes || undefined} title={title} aria-label={ariaLabel} state={returnLabel ? listLinkState(location, returnLabel) : undefined} data-record-link={record.type}>
      {children}
    </PreviewLink>
  )
}
