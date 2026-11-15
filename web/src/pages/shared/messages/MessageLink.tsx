import { type ReactNode } from 'react';
import { Link, useInRouterContext } from 'react-router-dom';
import { safeInternalReturnPath } from '../../../lib/routes';

/**
 * The app path for a link that points at this app (same origin), or null for
 * anything else. Pasted lesson or message links then stay in the app.
 */
export function inAppPath(href: string, origin = typeof window === 'undefined' ? '' : window.location.origin): string | null {
  if (!origin) return null
  try {
    const url = new URL(href, origin)
    if (url.origin !== origin || !/^https?:$/.test(url.protocol)) return null
    return safeInternalReturnPath(`${url.pathname}${url.search}${url.hash}`, '') || null
  } catch {
    return null
  }
}

/**
 * A link inside a message. Links to this app open in the same tab through the
 * router (⌘-click and middle-click still open a new tab, because it's a real
 * link); links elsewhere open in a new tab without access to this page.
 */
export function MessageLink({ href, className, children }: { href: string; className: string; children: ReactNode }) {
  const inRouter = useInRouterContext()
  const path = inRouter ? inAppPath(href) : null
  if (path) return <Link to={path} className={className}>{children}</Link>
  return <a href={href} target="_blank" rel="noopener noreferrer" className={className}>{children}</a>
}
