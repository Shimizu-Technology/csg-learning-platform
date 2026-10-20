import { Play } from 'lucide-react'
import type { CodeRunnerConfig, CodeRunnerLanguage } from '../../lib/codeRunner'

interface CodeRunnerSettingsProps {
  value: CodeRunnerConfig
  onChange: (value: CodeRunnerConfig) => void
  compact?: boolean
}

export function CodeRunnerSettings({ value, onChange, compact = false }: CodeRunnerSettingsProps) {
  const update = (patch: Partial<CodeRunnerConfig>) => {
    onChange({ ...value, ...patch })
  }

  return (
    <div className={`rounded-xl border border-line bg-surface-sunken ${compact ? 'p-3' : 'p-4'}`}>
      <label className="flex min-h-11 cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
          className="mt-1 rounded border-line-strong text-primary-600"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Play className="h-4 w-4 text-ink-muted" />
            Enable browser code runner
          </span>
          <span className="mt-1 block text-xs leading-5 text-ink-muted">
            Students can run Ruby or JavaScript in the browser for practice. This does not grade or submit their work.
          </span>
        </span>
      </label>

      {value.enabled && (
        <div className={compact ? 'mt-3' : 'mt-4 max-w-sm'}>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-secondary">Runner language</span>
            <select
              value={value.language}
              onChange={(event) => update({ language: event.target.value as CodeRunnerLanguage })}
              className="app-control w-full"
            >
              <option value="ruby">Ruby</option>
              <option value="javascript">JavaScript</option>
            </select>
          </label>
        </div>
      )}
    </div>
  )
}
