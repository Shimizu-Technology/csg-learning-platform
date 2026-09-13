import { useRef } from 'react'
import { Clock3, Plus, Trash2 } from 'lucide-react'
import { formatVideoTimestamp, type VideoSegment } from '../../lib/videoSegments'

function parseTimestamp(value: string) {
  const parts = value.trim().split(':')
  if (!parts.length || parts.length > 3 || parts.some((part) => !/^\d+$/.test(part))) return null
  const numbers = parts.map(Number)
  if (numbers.length > 1 && numbers.slice(1).some((part) => part > 59)) return null
  return numbers.reduce((total, part) => total * 60 + part, 0)
}

export function VideoSegmentEditor({ value, onChange }: { value: VideoSegment[]; onChange: (segments: VideoSegment[]) => void }) {
  const nextRowId = useRef(0)
  const rowIds = useRef<string[]>([])
  while (rowIds.current.length < value.length) rowIds.current.push(`video-segment-${nextRowId.current++}`)
  if (rowIds.current.length > value.length) rowIds.current.length = value.length
  const update = (index: number, patch: Partial<VideoSegment>) => onChange(value.map((segment, candidate) => candidate === index ? { ...segment, ...patch } : segment))
  const add = () => {
    rowIds.current.push(`video-segment-${nextRowId.current++}`)
    onChange([...value, { label: '', start_seconds: 0, end_seconds: 60, required: true }])
  }
  const remove = (index: number) => {
    rowIds.current.splice(index, 1)
    onChange(value.filter((_, candidate) => candidate !== index))
  }
  return <section className="rounded-2xl border border-slate-200 bg-slate-50/70 p-4">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="flex items-start gap-3"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-primary-600 shadow-sm"><Clock3 className="h-4 w-4" /></span><div><h3 className="text-sm font-extrabold text-slate-950">Recording sections</h3><p className="mt-1 text-xs leading-5 text-slate-500">Use exact start and end times. Students can jump directly to each section without leaving the lesson.</p></div></div>
      <button type="button" onClick={add} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white hover:bg-primary-700"><Plus className="h-4 w-4" />Add section</button>
    </div>
    <div className="mt-4 space-y-3">
      {value.map((segment, index) => <div key={rowIds.current[index]} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-3 lg:grid-cols-[minmax(0,1fr)_8rem_8rem_auto_auto] lg:items-end">
        <label className="text-xs font-bold text-slate-600">Section label<input aria-label={`Section ${index + 1} label`} value={segment.label} onChange={(event) => update(index, { label: event.target.value })} placeholder="What is taught here?" className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 text-sm font-medium text-slate-900" /></label>
        <label className="text-xs font-bold text-slate-600">Start<input aria-label={`Section ${index + 1} start`} defaultValue={formatVideoTimestamp(segment.start_seconds)} onBlur={(event) => { const parsed = parseTimestamp(event.target.value); if (parsed !== null) update(index, { start_seconds: parsed }) }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm text-slate-900" /></label>
        <label className="text-xs font-bold text-slate-600">End<input aria-label={`Section ${index + 1} end`} defaultValue={formatVideoTimestamp(segment.end_seconds)} onBlur={(event) => { const parsed = parseTimestamp(event.target.value); if (parsed !== null) update(index, { end_seconds: parsed }) }} className="mt-1 min-h-11 w-full rounded-xl border border-slate-200 px-3 font-mono text-sm text-slate-900" /></label>
        <label className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 px-3 text-xs font-bold text-slate-700"><input type="checkbox" checked={segment.required} onChange={(event) => update(index, { required: event.target.checked })} />Core</label>
        <button type="button" aria-label={`Remove section ${index + 1}`} onClick={() => remove(index)} className="flex h-11 w-11 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-600"><Trash2 className="h-4 w-4" /></button>
      </div>)}
      {!value.length && <p className="rounded-xl border border-dashed border-slate-300 px-4 py-5 text-center text-sm text-slate-500">No sections yet. The full recording will play from the beginning.</p>}
    </div>
  </section>
}
