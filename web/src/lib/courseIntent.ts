import { safeInternalReturnPath } from './routes'

// The catalog and checkout API validate offering identifiers against public offerings.
export function offeringIdFrom(search: string): number | null {
  const value = new URLSearchParams(search).get('offering_id') || ''
  const id = Number(value)
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(id) ? id : null
}

export function courseIntentDestination(search: string, fallback = '/dashboard'): string {
  const params = new URLSearchParams(search)
  const purchaseId = params.get('purchase_id') || ''
  if (params.get('checkout') === 'return' && /^[1-9]\d*$/.test(purchaseId)) return `/courses?checkout=return&purchase_id=${purchaseId}`
  const id = offeringIdFrom(search)
  if (id) return `/courses?offering_id=${id}`
  return safeInternalReturnPath(params.get('redirect_url'), '') || safeInternalReturnPath(params.get('redirect'), fallback)
}

export function courseAuthPath(path: '/sign-in' | '/sign-up', search: string): string {
  const destination = courseIntentDestination(search)
  if (destination === '/dashboard') return path
  const params = new URLSearchParams(search)
  if (offeringIdFrom(search) || (params.get('checkout') === 'return' && /^[1-9]\d*$/.test(params.get('purchase_id') || ''))) return `${path}?${destination.split('?')[1]}`
  return `${path}?${new URLSearchParams({ redirect_url: destination })}`
}
