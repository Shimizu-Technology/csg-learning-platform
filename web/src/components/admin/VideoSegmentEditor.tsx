import { useId, useRef } from 'react'
import { Clock3, Plus, Trash2 } from 'lucide-react'
import { formatVideoTimestamp } from '../../lib/videoSegments'
import { timestampText, videoSectionErrors, type VideoSectionDraft } from '../../lib/videoSectionDraft'
import { Button, IconButton } from '../ui/Button'

export function VideoSegmentEditor({ value, onChange, duration = null, hasVersions = false }: {
  value: VideoSectionDraft[]
  onChange: (segments: VideoSectionDraft[]) => void
  duration?: number | null
  hasVersions?: boolean
}) {
  const id = useId()
  const nextRowId = useRef(0)
  const rowIds = useRef<string[]>([])
  while (rowIds.current.length < value.length) rowIds.current.push(`video-segment-${nextRowId.current++}`)
  if (rowIds.current.length > value.length) rowIds.current.length = value.length
  const update = (index: number, patch: Partial<VideoSectionDraft>) => onChange(value.map((segment, candidate) => candidate === index ? { ...segment, ...patch } : segment))
  const add = () => {
    rowIds.current.push(`video-segment-${nextRowId.current++}`)
    onChange([...value, { label: '', start_seconds: 0, end_seconds: '', required: true }])
  }
  const remove = (index: number) => {
    rowIds.current.splice(index, 1)
    onChange(value.filter((_, candidate) => candidate !== index))
  }
  return <section className="app-surface-muted p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-line bg-surface-raised text-ink-secondary"><Clock3 className="h-4 w-4" /></span><div><h3 className="text-base font-semibold text-ink">Recording sections</h3><p className="mt-1 text-xs leading-5 text-ink-muted">Use exact start and end times. Students can jump directly to each section without leaving the lesson.</p></div></div>
      <Button variant="secondary" onClick={add} disabled={value.length >= 40} className="shrink-0"><Plus className="h-4 w-4" />Add section</Button>
    </div>
    <p className="mt-2 text-xs text-ink-muted">
      {duration === null ? 'Duration is unknown. Check that the end time fits the recording before saving.' : `Recording duration: ${formatVideoTimestamp(duration)}.`}
      {hasVersions && ' Use the same timeline across versions and check that each section fits the shortest version.'}
    </p>
    <div className="mt-4 space-y-3">
      {value.map((segment, index) => {
        const errors = videoSectionErrors(segment, duration)
        return <div key={rowIds.current[index]} className="grid gap-3 rounded-2xl border border-line bg-surface-raised p-3 lg:grid-cols-[minmax(0,1fr)_8rem_8rem_auto_auto] lg:items-start">
          {([
            ['label', 'Section label', 'label'],
            ['start_seconds', 'Start', 'start'],
            ['end_seconds', 'End', 'end'],
          ] as const).map(([field, title, name]) => {
            const error = errors[field]
            const errorId = `${id}-${rowIds.current[index]}-${field}`
            return <label key={field} className="text-xs font-semibold text-ink-secondary">{title}
              <input
                aria-label={`Section ${index + 1} ${name}`}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? errorId : undefined}
                value={field === 'label' ? segment.label : timestampText(segment[field])}
                onChange={(event) => {
                  const remainingIssues = segment.invalidStoredTimestamps?.filter((item) => item !== field)
                  update(index, { [field]: event.target.value, invalidStoredTimestamps: remainingIssues?.length ? remainingIssues : undefined })
                }}
                placeholder={field === 'label' ? 'What is taught here?' : 'M:SS'}
                className={`app-control mt-1 w-full ${field === 'label' ? '' : 'font-mono tabular-nums'}`}
              />
              {error && <span id={errorId} className="mt-1 block text-xs text-danger-ink">{error}</span>}
            </label>
          })}
          <label className="flex min-h-11 items-center gap-2 rounded-xl border border-line px-3 text-xs font-semibold text-ink-secondary"><input type="checkbox" checked={segment.required} onChange={(event) => update(index, { required: event.target.checked })} />Core</label>
          <IconButton label={`Remove section ${index + 1}`} variant="danger" onClick={() => remove(index)}><Trash2 className="h-4 w-4" /></IconButton>
        </div>
      })}
      {!value.length && <p className="rounded-xl border border-dashed border-line-strong px-4 py-5 text-center text-sm text-ink-muted">No sections yet. The full recording will play from the beginning.</p>}
    </div>
  </section>
}
