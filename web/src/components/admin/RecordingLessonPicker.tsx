import { useId, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import type { components } from '../../types/api.generated'
import { Button } from '../ui/Button'

type LessonOption = components['schemas']['RecordingLessonOption']
type SavedLesson = components['schemas']['RecordingLesson']

interface RecordingLessonPickerProps {
  options: LessonOption[] | null
  error: string | null
  loadOptions: () => void
  recordedDate: string
  value: number[]
  onChange: (value: number[]) => void
  savedLessons?: SavedLesson[]
}

function suggestionMatches(lesson: LessonOption, recordedDate: string) {
  if (!lesson.week_starts_on || !recordedDate) return false
  const daysAfterStart = (Date.parse(recordedDate) - Date.parse(lesson.week_starts_on)) / 86_400_000
  return daysAfterStart >= 0 && daysAfterStart < 7
}

export function RecordingLessonPicker({ options, error, loadOptions, recordedDate, value, onChange, savedLessons = [] }: RecordingLessonPickerProps) {
  const searchId = useId()
  const [search, setSearch] = useState('')
  const [suggestedDate, setSuggestedDate] = useState<string | null>(null)
  const query = search.trim().toLowerCase()
  const suggested = new Set(options?.filter((lesson) => suggestionMatches(lesson, recordedDate)).map((lesson) => lesson.id))
  const showSuggested = suggestedDate === recordedDate && suggested.size > 0
  const selected = new Set(value)
  const groups = new Map<number, LessonOption[]>()

  for (const lesson of options ?? []) {
    if (showSuggested && !suggested.has(lesson.id)) continue
    if (query && !`${lesson.title} ${lesson.module_name}`.toLowerCase().includes(query)) continue
    const group = groups.get(lesson.module_id)
    if (group) group.push(lesson)
    else groups.set(lesson.module_id, [lesson])
  }

  const unavailable = options && savedLessons.filter((lesson) => selected.has(lesson.id) && !options.some((option) => option.id === lesson.id))
  const toggle = (id: number) => onChange(selected.has(id) ? value.filter((item) => item !== id) : [...value, id])

  return (
    <details className="group rounded-xl border border-line bg-surface-raised" onToggle={(event) => { if (event.currentTarget.open && !error) loadOptions() }}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-2 rounded-xl px-3 py-2 text-sm font-semibold text-ink hover:bg-surface-sunken [&::-webkit-details-marker]:hidden">
        <span>Attach to lessons</span>
        <span className="flex shrink-0 items-center gap-2 text-xs text-ink-muted">
          {value.length > 0 ? `${value.length} selected` : 'Optional'}
          <ChevronDown className="h-4 w-4 group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="space-y-2 border-t border-line p-3">
        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="alert" className="text-sm text-danger-ink">{error}</p>
            <Button size="sm" variant="secondary" onClick={loadOptions}>Try again</Button>
          </div>
        ) : !options ? (
          <p role="status" className="text-sm text-ink-muted">Loading lessons…</p>
        ) : (
          <>
            <label htmlFor={searchId} className="sr-only">Search lessons</label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-ink-muted" aria-hidden="true" />
              <input id={searchId} type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search by lesson or module" className="app-control min-h-11 w-full pl-9 text-base sm:text-sm" />
            </div>
            {suggested.size > 0 && (
              <Button size="sm" variant={showSuggested ? 'secondary' : 'quiet'} aria-pressed={showSuggested} onClick={() => setSuggestedDate(showSuggested ? null : recordedDate)}>
                Suggested for this week
              </Button>
            )}
            {groups.size === 0 ? (
              <p className="px-1 py-2 text-sm text-ink-muted">{options.length ? 'No matching lessons.' : 'There are no active lessons in this curriculum.'}</p>
            ) : (
              <div className="max-h-60 space-y-3 overflow-y-auto overscroll-contain rounded-lg border border-line p-2">
                {[...groups].map(([id, lessons]) => (
                  <fieldset key={id} className="min-w-0">
                    <legend className="px-2 text-xs font-semibold text-ink-muted [overflow-wrap:anywhere]">{lessons[0].module_name}</legend>
                    {lessons.map((lesson) => (
                      <label key={lesson.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm text-ink hover:bg-surface-sunken has-checked:bg-surface-sunken">
                        <input type="checkbox" checked={selected.has(lesson.id)} onChange={() => toggle(lesson.id)} className="size-5 shrink-0 accent-action-primary" />
                        <span className="min-w-0 flex-1 [overflow-wrap:anywhere]">{lesson.title}</span>
                        {lesson.week && <span className="shrink-0 text-xs text-ink-muted">Week {lesson.week}</span>}
                      </label>
                    ))}
                  </fieldset>
                ))}
              </div>
            )}
            {Boolean(unavailable?.length) && (
              <div>
                <p className="text-sm text-ink-muted">Remove unavailable lessons before saving changes to attachments.</p>
                {unavailable?.map((lesson) => (
                  <label key={lesson.id} className="flex min-h-11 cursor-pointer items-center gap-3 px-2 text-sm text-ink">
                    <input type="checkbox" checked onChange={() => toggle(lesson.id)} className="size-5 shrink-0 accent-action-primary" />
                    <span className="min-w-0 [overflow-wrap:anywhere]">{lesson.title} (unavailable)</span>
                  </label>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </details>
  )
}
