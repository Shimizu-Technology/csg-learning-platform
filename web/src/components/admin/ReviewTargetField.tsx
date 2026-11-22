import { useId } from 'react'

export function ReviewTargetField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const help = useId()
  return (
    <div>
      <label className="block text-sm font-semibold">
        Review target (business days)
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={30}
          placeholder="e.g. 2"
          value={value}
          onChange={event => onChange(event.target.value)}
          aria-describedby={help}
          className="app-control mt-1 block min-h-11 w-full sm:max-w-40"
        />
      </label>
      <p id={help} className="mt-1 text-sm text-ink-secondary">
        Learners see a feedback date and staff see when a review is late. Counts weekdays in Guam, excluding school holidays. Leave blank to turn off.
      </p>
    </div>
  )
}
