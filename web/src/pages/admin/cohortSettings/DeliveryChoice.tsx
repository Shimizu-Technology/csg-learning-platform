import { useId } from 'react'
import { TERMS } from '../../../lib/glossary'

const options = [
  { value: 'program', label: TERMS.liveProgram },
  { value: 'guided', label: TERMS.smallClassDelivery },
  { value: 'self_paced', label: TERMS.selfPaced },
] as const

export type CohortDelivery = typeof options[number]['value']

export function DeliveryChoice({ value, onChange, selfPacedLabel = TERMS.selfPaced }: {
  value: CohortDelivery
  onChange: (value: CohortDelivery) => void
  selfPacedLabel?: string
}) {
  const name = useId()
  return (
    <fieldset className="min-w-0">
      <legend className="text-sm font-semibold text-ink-secondary">Delivery</legend>
      <div className="mt-1.5 grid gap-2 sm:grid-cols-3">
        {options.map(option => (
          <label
            key={option.value}
            className="flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 py-2
              text-sm font-semibold text-ink-secondary has-checked:border-line-strong has-checked:bg-surface-sunken has-checked:text-ink"
          >
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              onChange={() => onChange(option.value)}
              className="size-4 shrink-0 accent-action-primary"
            />
            <span>{option.value === 'self_paced' ? selfPacedLabel : option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}
