import { useId } from 'react'
import { GRADING_SCALE_OPTIONS, type GradingScale } from '../../lib/gradingScale'

/** Radio cards for a curriculum's grading scale: Pass / Redo or A / B / C / Redo, each with a plain-English note. */
export function GradingScalePicker({
  value,
  onChange,
  disabled = false,
  hint,
}: {
  value: GradingScale
  onChange: (value: GradingScale) => void
  disabled?: boolean
  /** Extra guidance under the options, such as what happens to saved grades. */
  hint?: string
}) {
  const name = useId()
  const hintId = useId()
  return (
    <fieldset disabled={disabled} aria-describedby={hint ? hintId : undefined} className="min-w-0 space-y-2 border-0 p-0">
      <legend className="mb-1 block text-sm font-medium text-ink-secondary">Grading scale</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {GRADING_SCALE_OPTIONS.map((option) => {
          const selected = value === option.value
          return (
            <label
              key={option.value}
              className={`flex min-h-11 cursor-pointer items-start gap-2.5 rounded-xl border px-3 py-2.5 text-sm transition-colors ${
                selected ? 'border-ink bg-surface-sunken text-ink' : 'border-line bg-surface-raised text-ink-secondary hover:bg-surface-sunken'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="mt-0.5 h-4 w-4 shrink-0"
              />
              <span className="min-w-0">
                <span className="block font-semibold text-ink">{option.label}</span>
                <span className="mt-0.5 block text-xs text-ink-secondary">{option.description}</span>
              </span>
            </label>
          )
        })}
      </div>
      {hint && <p id={hintId} className="text-xs text-ink-muted">{hint}</p>}
    </fieldset>
  )
}
