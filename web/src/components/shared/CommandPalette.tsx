import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import { BookOpen, ClipboardCheck, GraduationCap, Layers3, LifeBuoy, MessageSquareText, Search, Users, X } from 'lucide-react'
import { api } from '../../lib/api'
import { cohortStudentPath } from '../../lib/routes'

interface CommandPaletteProps { open: boolean; isStaff: boolean; onClose: () => void }
interface PaletteItem { id: string; label: string; detail: string; path: string; icon: typeof Search; keywords?: string }

const staffCommands: PaletteItem[] = [
  { id: 'staff-home', label: 'Staff home', detail: 'Attention and teaching overview', path: '/admin', icon: GraduationCap },
  { id: 'grading', label: 'Grading inbox', detail: 'Review submissions and redo requests', path: '/admin/grading', icon: ClipboardCheck },
  { id: 'support', label: 'Student support', detail: 'Open requests and attention signals', path: '/admin/support', icon: LifeBuoy },
  { id: 'students', label: 'All students', detail: 'Find learners across cohorts', path: '/admin/students', icon: Users },
  { id: 'cohorts', label: 'All cohorts', detail: 'Open cohort workspaces', path: '/admin/cohorts', icon: Layers3 },
]
const studentCommands: PaletteItem[] = [
  { id: 'today', label: 'Today', detail: 'Your current learning plan', path: '/dashboard', icon: GraduationCap },
  { id: 'learn', label: 'Learn', detail: 'Modules and lessons', path: '/materials', icon: BookOpen },
  { id: 'messages', label: 'Messages', detail: 'Channels and direct conversations', path: '/messages', icon: MessageSquareText },
]

export function CommandPalette({ open, isStaff, onClose }: CommandPaletteProps) {
  const navigate = useNavigate()
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [records, setRecords] = useState<PaletteItem[]>([])
  const [messageResults, setMessageResults] = useState<PaletteItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState(0)

  useEffect(() => {
    if (!open) return
    let active = true
    setQuery('')
    setRecords([])
    setMessageResults([])
    setSelectedIndex(0)
    setLoading(false)
    requestAnimationFrame(() => inputRef.current?.focus())
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKey)
    if (isStaff) {
      setLoading(true)
      void Promise.all([api.getCohorts(), api.getUsers({ role: 'student', include_enrollments: 'true' })]).then(([cohortResult, userResult]) => {
        if (!active) return
        const cohorts: PaletteItem[] = (cohortResult.data?.cohorts || []).map((cohort) => ({ id: `cohort-${cohort.id}`, label: cohort.name, detail: `${cohort.curriculum_name} · cohort`, path: `/admin/cohorts/${cohort.id}`, icon: Layers3, keywords: cohort.status }))
        const students: PaletteItem[] = (userResult.data?.users || []).flatMap((student) => student.enrollments?.length
          ? student.enrollments.map((enrollment) => ({ id: `student-${student.id}-cohort-${enrollment.cohort_id}`, label: student.full_name, detail: `${student.email} · ${enrollment.cohort_name}`, path: cohortStudentPath(enrollment.cohort_id, student.id), icon: Users, keywords: `${student.email} ${enrollment.status}` }))
          : [ { id: `student-${student.id}`, label: student.full_name, detail: `${student.email} · no cohort enrollment`, path: `/admin/students/${student.id}`, icon: Users, keywords: student.email } ])
        setRecords([...cohorts, ...students])
        setLoading(false)
      }).catch(() => {
        if (active) setLoading(false)
      })
    }
    return () => { active = false; document.body.style.overflow = previousOverflow; window.removeEventListener('keydown', handleKey) }
  }, [isStaff, onClose, open])

  useEffect(() => {
    if (!open || query.trim().length < 2) { setMessageResults([]); return }
    let active = true
    const timeout = window.setTimeout(() => {
      void api.searchMessages(query.trim(), 8).then((result) => {
        if (!active) return
        setMessageResults((result.data?.results || []).map((message) => ({ id: `message-${message.id}`, label: message.context.label, detail: message.body.replace(/\s+/g, ' ').slice(0, 100) || 'Attachment', path: message.context.type === 'channel' ? `/messages/${message.context.id}?message_id=${message.id}` : `/messages/dm/${message.context.id}?message_id=${message.id}`, icon: MessageSquareText })))
      })
    }, 220)
    return () => { active = false; window.clearTimeout(timeout) }
  }, [open, query])

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase()
    const base = [...(isStaff ? staffCommands : studentCommands), ...records]
    const filtered = normalized ? base.filter((item) => `${item.label} ${item.detail} ${item.keywords || ''}`.toLowerCase().includes(normalized)) : base
    return [...filtered, ...messageResults].slice(0, 20)
  }, [isStaff, messageResults, query, records])
  useEffect(() => { setSelectedIndex(0) }, [query])
  useEffect(() => {
    if (results.length && selectedIndex >= results.length) setSelectedIndex(results.length - 1)
  }, [results.length, selectedIndex])
  if (!open) return null

  const openItem = (item: PaletteItem) => { onClose(); navigate(item.path) }
  return createPortal(<div className="fixed inset-0 z-[100] flex items-start justify-center bg-slate-950/55 px-3 pt-[8vh] backdrop-blur-sm" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section role="dialog" aria-modal="true" aria-label="Search and go" className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/20 bg-white shadow-2xl"><div className="flex min-h-16 items-center gap-3 border-b border-slate-200 px-4"><Search className="h-5 w-5 text-slate-400" /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} aria-controls="command-palette-results" aria-activedescendant={results[selectedIndex] ? `command-${results[selectedIndex].id}` : undefined} onKeyDown={(event) => { if (event.key === 'ArrowDown') { event.preventDefault(); setSelectedIndex((index) => results.length ? (index + 1) % results.length : 0) } else if (event.key === 'ArrowUp') { event.preventDefault(); setSelectedIndex((index) => results.length ? (index - 1 + results.length) % results.length : 0) } else if (event.key === 'Enter' && results[selectedIndex]) openItem(results[selectedIndex]) }} placeholder="Search students, cohorts, messages, or go anywhere…" className="min-h-14 min-w-0 flex-1 border-0 bg-transparent text-base font-semibold text-slate-950 outline-none placeholder:text-slate-400" /><kbd className="hidden rounded-lg border border-slate-200 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-400 sm:block">ESC</kbd><button type="button" onClick={onClose} aria-label="Close search" className="inline-flex h-11 w-11 items-center justify-center rounded-xl text-slate-500 hover:bg-slate-100"><X className="h-5 w-5" /></button></div><div id="command-palette-results" className="max-h-[66vh] overflow-y-auto p-2">{loading && !query ? <p className="px-3 py-6 text-center text-sm text-slate-500">Loading connected records…</p> : results.length ? <div className="space-y-1">{results.map((item, index) => <button id={`command-${item.id}`} key={item.id} type="button" onMouseMove={() => setSelectedIndex(index)} onClick={() => openItem(item)} className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 text-left focus:outline-none ${selectedIndex === index ? 'bg-primary-50' : 'hover:bg-slate-100'}`}><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600"><item.icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-extrabold text-slate-950">{item.label}</span><span className="block truncate text-xs text-slate-500">{item.detail}</span></span></button>)}</div> : <p className="px-3 py-8 text-center text-sm text-slate-500">No connected records match “{query}”.</p>}</div><footer className="border-t border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">Use ↑↓ to choose · Enter to open · messages appear after two characters</footer></section></div>, document.body)
}
