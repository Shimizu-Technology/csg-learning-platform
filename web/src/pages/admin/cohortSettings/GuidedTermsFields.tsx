import { schoolTimeLocation } from '../../../lib/schoolTime'
import type { GuidedTermsDraft } from './settingsForm'

const termGroups = [
  {
    label: 'Relative per learner',
    fields: [
      {
        key: 'guided_access_months',
        label: 'Access length (months)',
        max: 120,
        placeholder: 'e.g. 12',
        help: 'How long each learner can read lessons after their start date.',
      },
      {
        key: 'guided_support_weeks',
        label: 'Support length (weeks)',
        max: 104,
        placeholder: 'e.g. 8',
        help: 'How long each learner can submit help requests and message instructors.',
      },
    ],
  },
  {
    label: 'Fixed cohort dates',
    fields: [
      {
        key: 'guided_access_ends_on',
        label: 'Lessons available through',
        help: 'Cuts off lesson access for the whole cohort after this date in school time.',
      },
      {
        key: 'guided_support_ends_on',
        label: 'Help period ends',
        help: 'Ends instructor help and direct messages after this date; reading continues if access is longer.',
      },
    ],
  },
] as const

export function GuidedTermsFields({ terms, onChange }: { terms: GuidedTermsDraft; onChange: (terms: GuidedTermsDraft) => void }) {
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-secondary">
        Set a length from each learner’s start or a date for the whole cohort. A fixed date takes precedence and includes
        the full day in {schoolTimeLocation()}. Leave both blank for no expiry. Changes apply to new enrollments only.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {termGroups.map(group => (
          <fieldset key={group.label} className="min-w-0 rounded-xl border border-line px-3 pb-3">
            <legend className="px-1 text-sm font-semibold text-ink">{group.label}</legend>
            <div className="mt-2 grid gap-3">
              {group.fields.map(field => (
                <label key={field.key} className="block min-w-0 text-sm font-semibold text-ink-secondary">
                  {field.label}
                  <input
                    {...('max' in field
                      ? { type: 'number', inputMode: 'numeric', min: 1, max: field.max, placeholder: field.placeholder }
                      : { type: 'date' })}
                    value={terms[field.key]}
                    onChange={event => onChange({ ...terms, [field.key]: event.target.value })}
                    className="app-control mt-1 min-h-11 w-full min-w-0"
                  />
                  <span className="mt-1 block text-xs font-normal leading-5 text-ink-muted">{field.help}</span>
                </label>
              ))}
            </div>
          </fieldset>
        ))}
      </div>
    </div>
  )
}
