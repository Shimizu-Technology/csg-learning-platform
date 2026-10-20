/**
 * Hafa Code lesson starter links (see hafa-code docs/LEARN_STARTER_LINKS.md).
 *
 * Course content links to a starter without knowing the Learn lesson id. When the
 * link renders inside a lesson, Learn appends `return` (this lesson's URL) and
 * `returnLabel` (the lesson title) to the link's hash so Hafa Code can show
 * "Back to your lesson". The hash keeps the lesson URL out of Hafa server logs.
 */

export const HAFA_CODE_ORIGIN = 'https://code.shimizu-technology.com'

export interface LessonReturn {
  /** Absolute lesson URL on this Learn origin. */
  url: string
  /** Lesson title shown next to "Back to your lesson". */
  label?: string | null
}

function parseHafaUrl(href: string): URL | null {
  let url: URL
  try {
    url = new URL(href)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.origin !== HAFA_CODE_ORIGIN || url.username || url.password) return null
  return url
}

function linkParams(url: URL) {
  return {
    hash: new URLSearchParams(url.hash.replace(/^#/, '')),
    query: new URLSearchParams(url.search),
  }
}

/** True for an https://code.shimizu-technology.com link that opens a project or lesson starter. */
export function isHafaStarterLink(href: string | null | undefined): href is string {
  if (!href) return false
  const url = parseHafaUrl(href)
  if (!url) return false
  const { hash, query } = linkParams(url)
  return hash.has('project') || hash.has('starter') || query.has('project') || query.has('starter')
}

/**
 * The URL Hafa Code should send the learner back to: origin and path, the
 * non-secret `cohort_id` that keeps their cohort selected, and an optional block
 * anchor. Other query parameters and the current hash are dropped.
 */
export function lessonReturnUrl(location: Pick<Location, 'origin' | 'pathname' | 'search'>, anchor?: string | null) {
  const cohortId = new URLSearchParams(location.search).get('cohort_id')
  const query = cohortId && /^[1-9]\d{0,9}$/.test(cohortId) ? `?cohort_id=${cohortId}` : ''
  const hash = anchor && /^[A-Za-z][\w-]{0,63}$/.test(anchor) ? `#${anchor}` : ''
  return `${location.origin}${location.pathname}${query}${hash}`
}

function cleanLabel(label: string | null | undefined) {
  // eslint-disable-next-line no-control-regex
  const value = (label ?? '').replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/g, ' ').trim()
  return value ? Array.from(value).slice(0, 80).join('') : null
}

/**
 * Adds `return` and `returnLabel` to a Hafa starter link's hash. Returns the link
 * unchanged when it is not a Hafa starter link, already names a return, or the
 * return URL is not an absolute http(s) URL.
 */
export function withLessonReturn(href: string, lessonReturn: LessonReturn | null | undefined): string {
  if (!lessonReturn || !isHafaStarterLink(href)) return href
  const source = href.trim()
  const url = parseHafaUrl(source)
  if (!url) return href
  const { hash, query } = linkParams(url)
  if (hash.has('return') || query.has('return')) return href

  let returnUrl: URL
  try {
    returnUrl = new URL(lessonReturn.url)
  } catch {
    return href
  }
  if (returnUrl.protocol !== 'https:' && returnUrl.protocol !== 'http:') return href

  const extra = new URLSearchParams({ return: returnUrl.href })
  const label = cleanLabel(lessonReturn.label)
  if (label) extra.set('returnLabel', label)

  // Append rather than re-serialize so the project payload stays byte-for-byte intact.
  const hashIndex = source.indexOf('#')
  const base = hashIndex === -1 ? source : source.slice(0, hashIndex)
  const existing = hashIndex === -1 ? '' : source.slice(hashIndex + 1).replace(/&+$/, '')
  return `${base}#${existing ? `${existing}&` : ''}${extra.toString()}`
}
