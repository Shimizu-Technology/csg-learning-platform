import { useId, type ReactNode } from 'react'
import { Code, ExternalLink } from 'lucide-react'
import { buttonClasses } from '../ui/Button'
import { useMediaQuery } from '../../lib/useMediaQuery'
import { withLessonReturn, type LessonReturn } from '../../lib/hafaStarterLinks'

/** Where a starter link renders: a block that takes a pasted submission, or practice only. */
export type StarterHint = 'submit' | 'practice'

export interface StarterLinkContext {
  lessonReturn: LessonReturn
  hint: StarterHint
}

export const DEFAULT_STARTER_LABEL = 'Open starter in Hafa Code'

export const STARTER_HINTS: Record<StarterHint, string> = {
  submit: 'Run it there, then use Copy code for Learn and paste it here.',
  practice: 'Run it there and try a change. Back to your lesson brings you here.',
}

/**
 * Phones and tablets open Hafa Code in the same tab: its "Back to your lesson"
 * control returns here, and the browser's back button still works. Desktops
 * (fine pointer) open a new tab so the lesson stays beside the code.
 */
export const SAME_TAB_QUERY = '(hover: none) and (pointer: coarse)'

export const STARTER_LINK_CLASS = buttonClasses({ variant: 'primary', className: 'hafa-starter-link max-w-full no-underline hover:no-underline' })
export const STARTER_HINT_CLASS = 'hafa-starter-hint block text-sm leading-6 text-ink-muted'

export function useStarterLinkSameTab() {
  return useMediaQuery(SAME_TAB_QUERY)
}

function labelFor(children: ReactNode, href: string) {
  const text = typeof children === 'string' ? children : Array.isArray(children) && children.every((child) => typeof child === 'string') ? children.join('') : null
  if (text !== null && (!text.trim() || text.trim() === href)) return DEFAULT_STARTER_LABEL
  return children ?? DEFAULT_STARTER_LABEL
}

export function HafaStarterLink({ href, children, context }: { href: string; children?: ReactNode; context: StarterLinkContext }) {
  const sameTab = useStarterLinkSameTab()
  const hintId = useId()
  return (
    <span className="my-3 flex flex-col items-start gap-1.5" data-hafa-starter="">
      <a
        href={withLessonReturn(href, context.lessonReturn)}
        target={sameTab ? undefined : '_blank'}
        rel={sameTab ? undefined : 'noopener noreferrer'}
        aria-describedby={hintId}
        className={STARTER_LINK_CLASS}
      >
        <Code className="h-4 w-4 shrink-0" aria-hidden="true" />
        <span className="min-w-0 [overflow-wrap:anywhere]">{labelFor(children, href)}</span>
        {!sameTab && (
          <>
            <ExternalLink className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="sr-only"> (opens in a new tab)</span>
          </>
        )}
      </a>
      <span id={hintId} className={STARTER_HINT_CLASS}>{STARTER_HINTS[context.hint]}</span>
    </span>
  )
}
