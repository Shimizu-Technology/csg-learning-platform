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
    <div className={`rounded-xl border border-slate-200 bg-slate-50 ${compact ? 'p-3' : 'p-4'}`}>
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={value.enabled}
          onChange={(event) => update({ enabled: event.target.checked })}
          className="mt-1 rounded border-slate-300 text-primary-600 focus:ring-primary-500"
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-sm font-semibold text-slate-800">
            <Play className="h-4 w-4 text-slate-500" />
            Enable browser code runner
          </span>
          <span className="mt-1 block text-xs leading-5 text-slate-500">
            Students can run Ruby or JavaScript in the browser for practice. This does not grade or submit their work.
          </span>
        </span>
      </label>

      {value.enabled && (
        <div className={compact ? 'mt-3' : 'mt-4 max-w-sm'}>
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-slate-600">Runner Language</span>
            <select
              value={value.language}
              onChange={(event) => update({ language: event.target.value as CodeRunnerLanguage })}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
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
