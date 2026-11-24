import { useId, useState } from 'react'
import { Check, Search, X } from 'lucide-react'
import { matchingPeople, personContext } from '../../../lib/person-context'
import type { DirectoryUserSummary as UserSummary } from '../../../types/api'

/**
 * Who a new direct message goes to: search by name, role or cohort, and pick
 * one person (a 1:1) or several (a group message). Selected people stay listed
 * as chips above the search, so a filter never hides who is already picked.
 */
export function DirectMessagePicker({ people, workspace, selectedIds, onChange }: {
  people: UserSummary[]
  workspace?: string
  selectedIds: number[]
  onChange: (ids: number[]) => void
}) {
  const [query, setQuery] = useState('')
  const searchId = useId()
  const listId = useId()
  const matches = query.trim() ? matchingPeople(people, query, workspace, people.length) : people
  const selected = selectedIds.map((id) => people.find((person) => person.id === id)).filter((person): person is UserSummary => Boolean(person))
  const toggle = (id: number) => onChange(selectedIds.includes(id) ? selectedIds.filter((item) => item !== id) : [...selectedIds, id])

  if (people.length === 0) return <p className="rounded-xl border border-line bg-surface-sunken px-4 py-3 text-sm text-ink-secondary">There is no one you can message in this space yet.</p>

  return <div className="space-y-3">
    {selected.length > 0 && <ul aria-label="Selected people" className="flex flex-wrap gap-2">
      {selected.map((person) => <li key={person.id}>
        <button type="button" onClick={() => toggle(person.id)} aria-label={`Remove ${person.full_name}`} className="pressable inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-line bg-surface-sunken px-3 text-sm font-medium text-ink hover:bg-surface-raised">
          <span className="max-w-[12rem] truncate">{person.full_name}</span><X className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
        </button>
      </li>)}
    </ul>}
    <label htmlFor={searchId} className="sr-only">Search people</label>
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-muted" aria-hidden="true" />
      <input id={searchId} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, role or cohort" autoComplete="off" aria-controls={listId} className="app-control min-h-11 w-full pl-9" />
    </div>
    <div id={listId} role="group" aria-label="People" className="max-h-72 overflow-y-auto rounded-xl border border-line">
      {matches.length === 0
        ? <p role="status" className="px-4 py-6 text-center text-sm text-ink-muted">No one matches “{query.trim()}”.</p>
        : <ul className="divide-y divide-line">
          {matches.map((person) => {
            const checked = selectedIds.includes(person.id)
            return <li key={person.id}>
              <label className={`flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-focus ${checked ? 'bg-surface-sunken' : 'hover:bg-surface-sunken'}`}>
                <input type="checkbox" className="sr-only" checked={checked} onChange={() => toggle(person.id)} />
                <span aria-hidden="true" className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${checked ? 'border-action-primary bg-action-primary text-on-action' : 'border-line-strong bg-surface-raised'}`}>{checked && <Check className="h-3.5 w-3.5" />}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-ink">{person.full_name}</span>
                  <span className="block truncate text-xs text-ink-muted">{personContext(person, people, workspace)}</span>
                </span>
              </label>
            </li>
          })}
        </ul>}
    </div>
  </div>
}
