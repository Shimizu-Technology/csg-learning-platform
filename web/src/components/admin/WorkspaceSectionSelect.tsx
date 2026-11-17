import { useNavigate } from 'react-router-dom'
import type { ReturnContext } from '../../lib/navigationContext'
import { useMediaQuery } from '../../lib/useMediaQuery'

/** Phone alternative to the workspace's URL-backed section links. */
export function WorkspaceSectionSelect({
  label,
  value,
  sections,
  state,
}: {
  label: string
  value: string
  sections: Array<{ to: string; label: string }>
  state?: ReturnContext
}) {
  const navigate = useNavigate()
  const isPhone = useMediaQuery('(max-width: 1023px)')
  // Read the viewport synchronously: no effect-driven control swap after load.
  // Desktop keeps its original links and does not gain a redundant form control.
  if (!isPhone) return null
  return (
    <label className="flex min-h-11 min-w-0 items-center gap-3 lg:hidden">
      <span className="text-sm font-semibold text-ink-secondary">Section</span>
      <select
        aria-label={label}
        className="app-control min-w-0 flex-1 text-base"
        value={value}
        onChange={(event) => navigate(event.target.value, { state })}
      >
        {sections.map((section) => (
          <option key={section.to} value={section.to}>
            {section.label}
          </option>
        ))}
      </select>
    </label>
  )
}
