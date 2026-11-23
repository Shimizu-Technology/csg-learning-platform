/// <reference lib="dom" />
/// <reference types="vite/client" />
import { applyThemeColor, THEME_COLORS } from './themeColors'
/** Public build configuration. Keep default copy byte-identical to the CSG deployment. */
export function createBrand(env: Record<string, string | undefined> = {}) {
  env = Object.fromEntries(Object.entries(env).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : undefined]))
  const url = (key: string, fallback: string, origin = false) => {
    const value = env[key] || fallback
    try {
      const parsed = new URL(value)
      if (!/^https:\/\//i.test(value) || parsed.protocol !== 'https:' || parsed.username || parsed.password || /\s/.test(value)
        || (origin && (parsed.search || parsed.hash || !['', '/'].includes(parsed.pathname)))) throw new Error()
      return value
    } catch {
      throw new Error(`${key} must be an absolute HTTPS ${origin ? 'origin without a path' : 'URL'}`)
    }
  }
  const siteUrl = url('VITE_SCHOOL_SITE_URL', 'https://codeschoolofguam.com/')
  const schoolName = env.VITE_SCHOOL_NAME || 'Code School of Guam'
  const isDefaultSchool = schoolName === 'Code School of Guam'
  const operatorName = env.VITE_OPERATOR_NAME || 'Shimizu Technology'
  const operatorUrl = env.VITE_OPERATOR_URL
    ? url('VITE_OPERATOR_URL', '')
    : operatorName === 'Shimizu Technology' ? 'https://shimizu-technology.com' : ''
  return {
    operatorName,
    operatorUrl,
    privacyEmail: env.VITE_PRIVACY_EMAIL || 'shimizutechnology@gmail.com',
    legacyAppUrl: url('VITE_LEGACY_APP_URL', 'https://csg-learn.netlify.app', true).replace(/\/$/, ''),
    schoolName,
    productName: env.VITE_PRODUCT_NAME || 'CSG Learn',
    schoolAbbreviation: env.VITE_SCHOOL_ABBREVIATION || 'CSG',
    schoolShortName: env.VITE_SCHOOL_SHORT_NAME || 'Code School',
    supportEmail: env.VITE_SUPPORT_EMAIL || 'codeschoolofguam@gmail.com',
    siteUrl,
    siteHost: new URL(siteUrl).host,
    coursesUrl: url('VITE_SCHOOL_COURSES_URL', new URL('courses', siteUrl).href),
    appUrl: (url('VITE_APP_URL', 'https://learn.codeschoolofguam.com', true)).replace(/\/$/, ''),
    logoSrc: env.VITE_LOGO_SRC || '/CSG-Logo.png',
    metaKeywords: env.VITE_META_KEYWORDS || (isDefaultSchool
      ? 'coding bootcamp, learn to code, guam, programming, web development, code school'
      : 'coding bootcamp, learn to code, programming, web development, code school'),
    areaServed: env.VITE_AREA_SERVED || (isDefaultSchool ? 'Guam' : ''),
  }
}
export const brand = createBrand(import.meta.env)
export const SUPPORT_EMAIL = brand.supportEmail
export const PRODUCT_NAME = brand.productName
export const SCHOOL_NAME = brand.schoolName
export const SCHOOL_SITE_URL = brand.siteUrl
export const SCHOOL_COURSES_URL = brand.coursesUrl
export const LOGO_SRC = brand.logoSrc

/** Status-bar / browser-chrome colours per surface and theme (meta theme-color). */
export const SURFACE_THEME_COLORS = THEME_COLORS

export type Surface = keyof typeof SURFACE_THEME_COLORS

const PUBLIC_PATHS = [/^\/$/, /^\/sign-in(\/|$)/, /^\/sign-up(\/|$)/, /^\/courses(\/|$)/, /^\/certificates(\/|$)/, /^\/privacy(\/|$)/, /^\/terms(\/|$)/, /^\/account-deletion(\/|$)/]

export function surfaceForPath(pathname: string): Surface {
  return PUBLIC_PATHS.some((pattern) => pattern.test(pathname)) ? 'public' : 'app'
}

/**
 * Keep the html background, `data-surface` hook, and theme-color meta (per theme) in step
 * with the current route. index.html runs the same logic before JavaScript
 * bundles load so the first paint already matches.
 */
export function applySurface(pathname: string, doc: Document = document) {
  const surface = surfaceForPath(pathname)
  doc.documentElement.dataset.surface = surface
  applyThemeColor(doc)
  return surface
}

/**
 * Clerk invitation links land on the redirect URL (the site root) with
 * `__clerk_ticket` and `__clerk_status`. Send them to the page whose Clerk
 * component can consume the ticket, keeping the query string intact.
 */
export function hasInvitationTicket(search: string): boolean {
  return Boolean(new URLSearchParams(search).get('__clerk_ticket'))
}

export function invitationDestination(search: string): string | null {
  if (!hasInvitationTicket(search)) return null
  const params = new URLSearchParams(search)
  const status = params.get('__clerk_status')
  const path = status === 'sign_in' || status === 'complete' ? '/sign-in' : '/sign-up'
  return `${path}?${params.toString()}`
}
