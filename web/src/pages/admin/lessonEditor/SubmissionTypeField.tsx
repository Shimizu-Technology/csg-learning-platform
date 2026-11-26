import { LIVE_URL_TOGGLE_LABEL, SUBMISSION_TYPE_OPTIONS, isProjectLink, submissionChoiceValue, submissionTypeForChoice } from './submissionTypes'

/** The four submission choices. `value` is the saved type; `onChange` gets the type to save. */
export function SubmissionTypeSelect({
  id,
  value,
  onChange,
  disabled = false,
  className,
  allowDefault = true,
}: {
  id: string
  value: string | null
  onChange: (type: string | null) => void
  disabled?: boolean
  className: string
  /** Offer "Lesson default" while the block has no type of its own. */
  allowDefault?: boolean
}) {
  return (
    <select
      id={id}
      value={submissionChoiceValue(value)}
      disabled={disabled}
      className={className}
      onChange={(event) => onChange(submissionTypeForChoice(event.target.value || null, value))}
    >
      {allowDefault && value === null && <option value="">Lesson default</option>}
      {SUBMISSION_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  )
}

/** Shown for Project link only: switches between the repository-only and repository-plus-live-URL types. */
export function LiveUrlToggle({ value, onChange, disabled = false }: { value: string | null; onChange: (type: string) => void; disabled?: boolean }) {
  if (!isProjectLink(value)) return null
  return (
    <label className="flex min-h-11 items-center gap-3 text-sm font-semibold text-ink-secondary">
      <input
        type="checkbox"
        className="size-5 shrink-0 accent-action-primary"
        checked={value === 'repo_and_live_url_submission'}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked ? 'repo_and_live_url_submission' : 'repo_url_submission')}
      />
      {LIVE_URL_TOGGLE_LABEL}
    </label>
  )
}
