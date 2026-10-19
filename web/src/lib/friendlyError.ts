import type { ApiErrorKind } from './api'

/**
 * Learner-facing copy for a failed save. Validation messages from the API are
 * already written for people; transport and server failures are not.
 */
export function friendlySaveError(response: { error: string | null; errorKind?: ApiErrorKind; status?: number }, thing = 'your work'): string {
  const raw = (response.error || '').trim()
  if (response.errorKind === 'network' || /failed to fetch|networkerror|load failed|network request failed/i.test(raw)) {
    return `We couldn't reach CSG Learn, so ${thing} wasn't sent. Check your connection and try again — your draft is saved on this device.`
  }
  if (response.errorKind === 'timeout') {
    return `CSG Learn took too long to answer, so ${thing} may not have been sent. Try again — your draft is saved on this device.`
  }
  if (response.errorKind === 'server' || (response.status && response.status >= 500) || /internal server error|bad gateway|service unavailable/i.test(raw)) {
    return `Something went wrong on our side and ${thing} wasn't saved. Try again in a moment — your draft is saved on this device. If it keeps happening, message your instructor.`
  }
  if (response.errorKind === 'auth') {
    return 'Your sign-in expired. Sign in again to send this — your draft is saved on this device.'
  }
  return raw || `We couldn't save ${thing}. Try again — your draft is saved on this device.`
}
