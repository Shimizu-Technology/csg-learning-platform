import type { ApiResponse } from './api'

export function unavailableResponse(response: Pick<ApiResponse<unknown>, 'status' | 'errorKind'>) {
  return response.errorKind === 'forbidden' || response.errorKind === 'not_found' || response.status === 403 || response.status === 404
}

export function loadFailureMessage(subject: string, response: Pick<ApiResponse<unknown>, 'status' | 'errorKind'>) {
  if (unavailableResponse(response)) return `${subject} is unavailable or you no longer have access.`
  if (response.errorKind === 'auth' || response.status === 401) return `Your session could not be verified. Sign in again, then retry loading ${subject.toLowerCase()}.`
  if (response.errorKind === 'server' || (response.status != null && response.status >= 500)) return `${subject} could not be loaded because the service is temporarily unavailable. Try again in a moment.`
  return `Could not load ${subject.toLowerCase()}. Check your connection and try again.`
}
