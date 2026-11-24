import { safeInternalReturnPath } from './routes'

// The catalog and checkout API validate offering identifiers against public offerings.
export function offeringIdFrom(search: string): number | null {
  const value = new URLSearchParams(search).get('offering_id') || ''
  const id = Number(value)
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(id) ? id : null
}

const OFFERING_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function validOfferingSlug(value: string | null | undefined): string | null {
  return value && OFFERING_SLUG_RE.test(value) ? value : null
}

export function offeringSlugFrom(search: string): string | null {
  return validOfferingSlug(new URLSearchParams(search).get('offering_slug'))
}

export function hasCourseIntent(search: string): boolean {
  return offeringIdFrom(search) !== null || offeringSlugFrom(search) !== null
}

export function courseIntentDestination(search: string, fallback = '/dashboard'): string {
  const params = new URLSearchParams(search)
  const purchaseId = params.get('purchase_id') || ''
  const slug = offeringSlugFrom(search)
  const id = offeringIdFrom(search)
  if (params.get('checkout') === 'return' && /^[1-9]\d*$/.test(purchaseId)) {
    const next = new URLSearchParams({ checkout: 'return', purchase_id: purchaseId })
    if (id) next.set('offering_id', String(id))
    return slug ? `/courses/${slug}?${next}` : `/courses?${next}`
  }
  if (slug) return id ? `/courses/${slug}?offering_id=${id}` : `/courses/${slug}`
  if (id) return `/courses?offering_id=${id}`
  return safeInternalReturnPath(params.get('redirect_url'), '') || safeInternalReturnPath(params.get('redirect'), fallback)
}

export function courseAuthPath(path: '/sign-in' | '/sign-up', search: string): string {
  const destination = courseIntentDestination(search)
  if (destination === '/dashboard') return path
  const params = new URLSearchParams(search)
  const id = offeringIdFrom(search)
  const slug = offeringSlugFrom(search)
  const purchaseId = params.get('purchase_id') || ''
  if (params.get('checkout') === 'return' && /^[1-9]\d*$/.test(purchaseId)) {
    const next = new URLSearchParams({ checkout: 'return', purchase_id: purchaseId })
    if (id) next.set('offering_id', String(id))
    if (slug) next.set('offering_slug', slug)
    return `${path}?${next}`
  }
  if (id || slug) {
    const next = new URLSearchParams()
    if (id) next.set('offering_id', String(id))
    if (slug) next.set('offering_slug', slug)
    return `${path}?${next}`
  }
  return `${path}?${new URLSearchParams({ redirect_url: destination })}`
}
