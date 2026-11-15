/** Submission types, in the words staff choose them by (sentence case, glossary). */
export const SUBMISSION_TYPE_OPTIONS = [
  { value: 'manual_complete', label: 'No submission (practice)', hint: 'Students mark this complete themselves. Nothing goes to Grading.' },
  { value: 'text_submission', label: 'Text or code', hint: 'Students write their answer in the app and it goes to Grading.' },
  { value: 'repo_url_submission', label: 'GitHub repo', hint: 'Students submit a repository link and optional notes.' },
  { value: 'repo_and_live_url_submission', label: 'GitHub repo and live link', hint: 'Students submit a repository link and a deployed live link.' },
  { value: 'prework_github_sync', label: 'GitHub file sync (prework)', hint: 'Only for prework that syncs a named file from GitHub.' },
] as const

export const REVIEWED_SUBMISSION_TYPES = new Set(['text_submission', 'prework_github_sync', 'repo_url_submission', 'repo_and_live_url_submission'])

export function submissionTypeHint(value: string | null | undefined) {
  return SUBMISSION_TYPE_OPTIONS.find((option) => option.value === value)?.hint || 'Uses the lesson\'s older submission setting.'
}
