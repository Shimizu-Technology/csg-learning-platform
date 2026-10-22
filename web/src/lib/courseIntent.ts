// Only an offering identifier crosses auth. The catalog and checkout API validate it
// against public offerings; arbitrary return URLs are never accepted.
export function offeringIdFrom(search: string): number | null {
  const value = new URLSearchParams(search).get('offering_id') || ''
  const id = Number(value)
  return /^[1-9]\d*$/.test(value) && Number.isSafeInteger(id) ? id : null
}

export function courseIntentDestination(search: string): string {
  const params = new URLSearchParams(search)
  const purchaseId = params.get('purchase_id') || ''
  if (params.get('checkout') === 'return' && /^[1-9]\d*$/.test(purchaseId)) return `/courses?checkout=return&purchase_id=${purchaseId}`
  const id = offeringIdFrom(search)
  return id ? `/courses?offering_id=${id}` : '/dashboard'
}

export function courseAuthPath(path: '/sign-in' | '/sign-up', search: string): string {
  const destination = courseIntentDestination(search)
  return destination === '/dashboard' ? path : `${path}?${destination.split('?')[1]}`
}
