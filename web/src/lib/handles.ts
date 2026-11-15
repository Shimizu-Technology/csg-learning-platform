/** The same rules as the API's User::HANDLE_FORMAT and RESERVED_HANDLES (M-13). */
export const HANDLE_PATTERN = /^[a-z0-9][a-z0-9_]{2,29}$/
const RESERVED = new Set(['all', 'admin', 'admins', 'channel', 'everyone', 'here', 'instructor', 'instructors', 'me', 'staff', 'student', 'students', 'support', 'system'])

/** What gets saved: no leading @, no spaces around it, lowercase. Blank clears the handle. */
export function normalizeHandle(value: string) {
  return value.trim().replace(/^@/, '').toLowerCase()
}

/** Why a handle can't be saved, or null when it can (blank is fine: it clears the handle). */
export function handleProblem(value: string): string | null {
  const handle = normalizeHandle(value)
  if (!handle) return null
  if (handle.length < 3 || handle.length > 30) return 'Use 3 to 30 characters.'
  if (!HANDLE_PATTERN.test(handle)) return 'Use lowercase letters, numbers or underscores, starting with a letter or number.'
  if (RESERVED.has(handle)) return `@${handle} is reserved. Choose another handle.`
  return null
}
