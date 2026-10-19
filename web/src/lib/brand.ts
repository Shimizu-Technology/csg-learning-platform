/**
 * One product name and the CSG family brand values shared by the public and
 * sign-in surfaces. The working app stays neutral; only these surfaces (and
 * milestone moments) use the cream page and Newsreader display type that the
 * Code School of Guam site uses, so learners arriving from the site feel they
 * are still at the same school.
 */
export const PRODUCT_NAME = 'CSG Learn'
export const SCHOOL_NAME = 'Code School of Guam'
export const SCHOOL_SITE_URL = 'https://codeschoolofguam.com/'
export const SCHOOL_COURSES_URL = 'https://codeschoolofguam.com/courses'
export const LOGO_SRC = '/CSG-Logo.png'

/** Status-bar / browser-chrome colours per surface (meta theme-color). */
export const SURFACE_THEME_COLORS = {
  public: '#faf7f0',
  app: '#ffffff',
} as const

export type Surface = keyof typeof SURFACE_THEME_COLORS

const PUBLIC_PATHS = [/^\/$/, /^\/sign-in(\/|$)/, /^\/sign-up(\/|$)/, /^\/courses(\/|$)/, /^\/privacy(\/|$)/, /^\/terms(\/|$)/, /^\/account-deletion(\/|$)/]

export function surfaceForPath(pathname: string): Surface {
  return PUBLIC_PATHS.some((pattern) => pattern.test(pathname)) ? 'public' : 'app'
}

/**
 * Keep the html background, `data-surface` hook, and theme-color meta in step
 * with the current route. index.html runs the same logic before JavaScript
 * bundles load so the first paint already matches.
 */
export function applySurface(pathname: string, doc: Document = document) {
  const surface = surfaceForPath(pathname)
  doc.documentElement.dataset.surface = surface
  let meta = doc.querySelector<HTMLMetaElement>('meta[name="theme-color"]')
  if (!meta) {
    meta = doc.createElement('meta')
    meta.name = 'theme-color'
    doc.head.appendChild(meta)
  }
  meta.content = SURFACE_THEME_COLORS[surface]
  return surface
}

/**
 * Clerk invitation links land on the redirect URL (the site root) with
 * `__clerk_ticket` and `__clerk_status`. Send them to the page whose Clerk
 * component can consume the ticket, keeping the query string intact.
 */
export function invitationDestination(search: string): string | null {
  const params = new URLSearchParams(search)
  if (!params.get('__clerk_ticket')) return null
  const status = params.get('__clerk_status')
  const path = status === 'sign_in' || status === 'complete' ? '/sign-in' : '/sign-up'
  return `${path}?${params.toString()}`
}
