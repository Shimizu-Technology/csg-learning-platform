/**
 * What students submit, as four choices staff pick by (sentence case, glossary). "Project link"
 * covers both repository types: a checkbox adds the live deployed URL
 * (repo_url_submission vs repo_and_live_url_submission), so saved blocks of either type load as
 * Project link and nothing changes on the API.
 */
export const SUBMISSION_TYPE_OPTIONS = [
  { value: 'manual_complete', label: 'No submission', hint: 'Students mark this complete themselves. Nothing goes to Grading.' },
  { value: 'text_submission', label: 'In-app answer or code', hint: 'Students write their answer or code in the app and it goes to Grading. Turn on the code runner for Ruby or JavaScript.' },
  { value: 'prework_github_sync', label: 'GitHub file sync', hint: 'For prework that syncs a named file from the student\'s GitHub repository. Set the filename and check rules.' },
  { value: 'repo_url_submission', label: 'Project link', hint: 'Students submit a repository link and optional notes.' },
] as const

export const LIVE_URL_TOGGLE_LABEL = 'Also require a live deployed URL'
const LIVE_URL_HINT = 'Students submit a repository link and a deployed live link.'

export const REVIEWED_SUBMISSION_TYPES = new Set(['text_submission', 'prework_github_sync', 'repo_url_submission', 'repo_and_live_url_submission'])

export function isProjectLink(value: string | null | undefined) {
  return value === 'repo_url_submission' || value === 'repo_and_live_url_submission'
}

/** The choice a saved type shows as: both repository types are "Project link". */
export function submissionChoiceValue(value: string | null | undefined) {
  return isProjectLink(value) ? 'repo_url_submission' : value || ''
}

/** The type a choice saves; choosing Project link again keeps the live URL setting. */
export function submissionTypeForChoice(choice: string | null, current: string | null | undefined) {
  if (choice === 'repo_url_submission' && current === 'repo_and_live_url_submission') return current
  return choice
}

export function submissionTypeHint(value: string | null | undefined) {
  if (value === 'repo_and_live_url_submission') return LIVE_URL_HINT
  return SUBMISSION_TYPE_OPTIONS.find((option) => option.value === value)?.hint || 'Uses the lesson\'s older submission setting.'
}
