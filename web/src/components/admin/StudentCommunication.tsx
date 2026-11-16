import { useLocation } from 'react-router-dom'
import { useCallback } from 'react'
import { CalendarDays, Hash, MessageSquareText } from 'lucide-react'
import { api } from '../../lib/api'
import { requireSection, SectionBoundary, useSection } from '../../lib/useSection'
import { conversationPath } from '../../lib/routes'
import { formatShortDateTime } from '../../lib/format'
import { markdownExcerpt } from '../../lib/plainText'
import { PreviewLink as Link } from '../../contexts/PreviewNavigationContext'
import { Button } from '../ui/Button'

export function StudentCommunication({ cohortId, studentId, studentName, opening, onOpen }: { cohortId: number; studentId: number; studentName: string; opening: boolean; onOpen: () => void }) {
  const location = useLocation()
  const returnTo = `${location.pathname}${location.search}`
  const history = useSection(`${cohortId}:${studentId}`, useCallback(async () => requireSection(await api.getStudentCommunication(studentId, cohortId)).communication, [cohortId, studentId]))
  return <section className="space-y-4" aria-label="Student communication">
    <div className="app-surface flex flex-wrap items-center justify-between gap-3 p-5"><div><h2 className="text-lg font-bold text-ink">Communication with {studentName}</h2><p className="mt-1 text-sm text-ink-secondary">Recent conversations you belong to, this student’s class chat activity, and meetings you can manage.</p></div><Button onClick={onOpen} disabled={opening}><MessageSquareText className="h-4 w-4" aria-hidden="true" />{opening ? 'Opening conversation…' : 'Open direct message'}</Button></div>
    <SectionBoundary section={history} label="Communication history">
      {history.data && <div className="grid gap-4 xl:grid-cols-3">
        {[{ key: 'messages' as const, title: 'Recent messages', icon: MessageSquareText, empty: 'No messages in your conversations with this student yet.' }, { key: 'channel_activity' as const, title: 'Class chat activity', icon: Hash, empty: 'No recent class chat activity from this student.' }].map(({ key, title, icon: Icon, empty }) => <section key={key} className="app-surface overflow-hidden"><h3 className="flex items-center gap-2 border-b border-line p-5 font-bold"><Icon className="h-4 w-4" aria-hidden="true" />{title}</h3>{history.data![key].length ? <ul className="divide-y divide-line">{history.data![key].map(message => <li key={message.id}><Link className="block min-h-11 p-5 hover:bg-surface-hover" to={conversationPath({ type: message.channel_id ? 'channel' : 'dm', id: message.channel_id || message.direct_conversation_id! }, { cohortId, messageId: message.id, returnTo })}><p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">{message.channel_name ? `#${message.channel_name}` : message.author_name}</p><p className="mt-1 line-clamp-3 text-sm text-ink-secondary [overflow-wrap:anywhere]">{markdownExcerpt(message.body || 'Attachment', 200)}</p><p className="mt-2 text-xs tabular-nums text-ink-muted">{formatShortDateTime(message.created_at)}</p></Link></li>)}</ul> : <p className="p-5 text-sm text-ink-muted">{empty}</p>}</section>)}
        <section className="app-surface overflow-hidden"><h3 className="flex items-center gap-2 border-b border-line p-5 font-bold"><CalendarDays className="h-4 w-4" aria-hidden="true" />Meetings</h3>{history.data.meetings.length ? <ul className="divide-y divide-line">{history.data.meetings.map(meeting => <li key={meeting.id}><Link className="block min-h-11 p-5 hover:bg-surface-hover" to={`/admin/meetings?cohort_id=${cohortId}&booking_id=${meeting.id}&return_to=${encodeURIComponent(returnTo)}`}><p className="text-sm font-semibold text-ink [overflow-wrap:anywhere]">Meeting with {meeting.instructor_name}</p><p className="mt-1 text-sm tabular-nums text-ink-secondary">{formatShortDateTime(meeting.starts_at)}</p><p className="mt-1 text-xs capitalize text-ink-muted">{meeting.status}</p></Link></li>)}</ul> : <p className="p-5 text-sm text-ink-muted">No meetings you can manage for this student yet.</p>}</section>
      </div>}
    </SectionBoundary>
  </section>
}
