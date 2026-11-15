import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link } from 'react-router-dom'
import { Search, X } from 'lucide-react'
import { api } from '../../lib/api'
import { searchDestinationPath } from '../../lib/searchDestination'
import { shellNavigation } from '../../lib/shellNavigation'
import { useAuthContext } from '../../contexts/AuthContext'
import { useCohortContext } from '../../contexts/CohortContext'
import { IconButton } from '../ui/Button'

interface CommandPaletteProps { open: boolean; isStaff: boolean; onClose: () => void }
interface Item { id: string; label: string; detail: string; path: string; section: string; query?: string }
interface Recent { id: string; query: string }
const labels: Record<string, string> = { student: 'Students', staff: 'Team', cohort: 'Cohorts', curriculum: 'Curricula', module: 'Modules', lesson: 'Lessons', submission: 'Submissions', help_request: 'Help requests', follow_up: 'Follow-up plans', channel: 'Channels', dm: 'Direct messages', message: 'Messages', announcement: 'Updates', recording: 'Recordings', resource: 'Resources' }

export function Highlight({ text, query }: { text: string; query: string }) {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
  if (!terms.length) return <>{text}</>
  const pattern = new RegExp(`(${terms.map(term => term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`, 'gi')
  return <>{text.split(pattern).map((part, i) => terms.includes(part.toLowerCase()) ? <mark key={i} className="rounded bg-surface-sunken text-ink">{part}</mark> : part)}</>
}

export function CommandPalette({ open, isStaff, onClose }: CommandPaletteProps) {
  const { user, schoolFeatures, enrollments } = useAuthContext()
  const { selectedCohort, cohorts } = useCohortContext()
  const [query, setQuery] = useState('')
  const [records, setRecords] = useState<Item[]>([])
  const [recents, setRecents] = useState<Item[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState(0)
  const input = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLDivElement>(null)
  const storageKey = `csg-search-recent:${user?.id}`
  const nav = shellNavigation({ staff: isStaff, admin: Boolean(user?.is_admin), cohort: selectedCohort, cohorts, schoolFeatures, alumniOnly: enrollments.length > 0 && enrollments.every(e => e.cohort.cohort_type === 'alumni') })
  const pages: Item[] = Object.values(nav).flat().map(item => ({ id: item.to, label: item.label, path: item.to, detail: 'Go to page', section: 'Pages' }))
  const actions: Item[] = [
    ...(user?.is_admin ? [{ id: 'new-cohort', label: 'New cohort', path: '/admin/cohorts?create=true', detail: 'Create a cohort', section: 'Actions' }] : []),
    ...(isStaff ? [{ id: 'post-update', label: 'Post update', path: '/announcements?scope=manage', detail: 'Write an update', section: 'Actions' }] : []),
  ]

  useEffect(() => {
    if (!open) return
    let active = true
    const previousFocus = document.activeElement as HTMLElement | null
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    setQuery(''); setRecords([]); setRecents([]); setError(''); setSelected(0)
    const frame = requestAnimationFrame(() => input.current?.focus())
    let saved: Recent[] = []
    try { saved = JSON.parse(localStorage.getItem(storageKey) || '[]') as Recent[] } catch { /* Storage may be unavailable. */ }
    if (Array.isArray(saved)) void Promise.allSettled(saved.slice(0, 5).filter(r => typeof r.query === 'string' && typeof r.id === 'string').map(async r => {
      const response = await api.searchEverything(r.query)
      return (response.data?.groups || []).flatMap(group => group.results.map(record => ({ id: `${group.type}-${record.id}`, query: r.query, label: record.title, detail: record.snippet, path: searchDestinationPath(record.destination, { is_staff: isStaff, is_admin: Boolean(user?.is_admin) }) || '', section: 'Recent' }))).find(item => item.id === r.id && item.path)
    })).then(items => { if (active) setRecents(items.flatMap(item => item.status === 'fulfilled' && item.value ? [item.value] : [])) })
    return () => { active = false; cancelAnimationFrame(frame); document.body.style.overflow = overflow; previousFocus?.focus() }
  }, [open, storageKey])

  useEffect(() => {
    if (!open || query.trim().length < 2) { setRecords([]); setLoading(false); return }
    let active = true
    setRecords([]); setLoading(true); setError('')
    const timer = window.setTimeout(() => {
      void api.searchEverything(query.trim()).then(response => {
        if (!active) return
        setRecords((response.data?.groups || []).flatMap(group => group.results.map(record => ({ id: `${group.type}-${record.id}`, query: query.trim(), label: record.title, detail: record.snippet, path: searchDestinationPath(record.destination, { is_staff: isStaff, is_admin: Boolean(user?.is_admin) }) || '', section: `Records · ${labels[group.type] || group.type}` }))).filter(item => item.path))
        setError(response.error || ''); setLoading(false)
      }).catch(() => { if (active) { setError('Search is unavailable. Try again.'); setLoading(false) } })
    }, 250)
    return () => { active = false; window.clearTimeout(timer) }
  }, [open, query, user?.id])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    return [...(q ? records : recents), ...pages.filter(item => !q || item.label.toLowerCase().includes(q)), ...actions.filter(item => !q || item.label.toLowerCase().includes(q))]
  }, [query, records, recents, pages, actions])
  useEffect(() => { setSelected(0) }, [query])
  const selectedIndex = Math.min(selected, Math.max(0, results.length - 1))
  useEffect(() => { list.current?.querySelector(`[data-index="${selectedIndex}"]`)?.scrollIntoView?.({ block: 'nearest' }) }, [selectedIndex])
  const remember = (item: Item) => {
    if (item.query) try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || '[]') as Recent[]
      localStorage.setItem(storageKey, JSON.stringify([{ id: item.id, query: item.query }, ...(Array.isArray(saved) ? saved.filter(r => r.id !== item.id) : [])].slice(0, 5)))
    } catch { /* Navigation works without storage. */ }
    onClose()
  }
  if (!open) return null
  return createPortal(<div className="fixed inset-0 z-[100] flex items-start justify-center bg-scrim px-3 pt-[8vh]" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
    <section role="dialog" aria-modal="true" aria-label="Search and go" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-line bg-surface-raised shadow-overlay" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); onClose() }
      if (event.key === 'Tab') {
        const focusable = [...event.currentTarget.querySelectorAll<HTMLElement>('input, button')]
        const next = focusable[(focusable.indexOf(document.activeElement as HTMLElement) + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length]
        event.preventDefault(); next?.focus()
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setSelected(results.length ? (selectedIndex + (event.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length : 0) }
      if (event.key === 'Enter' && event.target === input.current && results[selectedIndex]) { event.preventDefault(); (list.current?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLAnchorElement)?.click() }
    }}>
      <div className="flex min-h-16 items-center gap-3 border-b border-line px-4"><Search className="h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" /><input ref={input} value={query} onChange={e => setQuery(e.target.value)} role="combobox" aria-expanded="true" aria-autocomplete="list" aria-controls="command-palette-results" aria-activedescendant={results[selectedIndex] ? `command-${selectedIndex}` : undefined} placeholder="Search your learning, conversations, and pages…" aria-label="Search and go" className="min-h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none" /><IconButton label="Close search" onClick={onClose}><X className="h-5 w-5" /></IconButton></div>
      <div aria-live="polite" className="text-sm text-ink-secondary">{!loading && !error && <p className="sr-only">{results.length} results available</p>}{loading && <p className="px-4 py-2">Searching…</p>}{error && <p role="alert" className="px-4 py-2">{error}</p>}</div>
      <div ref={list} id="command-palette-results" role="listbox" aria-label="Search results" className="max-h-[60vh] overflow-y-auto p-2">
        {!results.length && !loading && <p className="px-3 py-8 text-center text-sm text-ink-secondary">{query.trim().length < 2 ? 'Type at least two characters to search your learning and conversations.' : 'No results. Try a name, handle, or different words.'}</p>}
        {results.map((item, index) => <div key={`${item.section}-${item.id}`}>{results[index - 1]?.section !== item.section && <p className="px-3 py-2 text-xs font-semibold text-ink-muted">{item.section}</p>}<Link id={`command-${index}`} data-index={index} role="option" aria-selected={selectedIndex === index} tabIndex={-1} to={item.path} onMouseMove={() => setSelected(index)} onClick={() => remember(item)} className={`flex min-h-14 items-center rounded-xl px-3 py-2 ${selectedIndex === index ? 'nav-selected' : 'hover:bg-surface-sunken'}`}><span className="min-w-0"><span className="block truncate text-sm font-semibold text-ink"><Highlight text={item.label} query={query} /></span><span className="block truncate text-xs text-ink-secondary"><Highlight text={item.detail} query={query} /></span></span></Link></div>)}
      </div><footer className="border-t border-line px-4 py-2 text-xs text-ink-secondary">↑↓ to choose · Enter to open · Esc to close</footer>
    </section>
  </div>, document.body)
}
