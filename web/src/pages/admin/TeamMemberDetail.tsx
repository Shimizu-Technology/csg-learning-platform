import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Activity, Archive, Layers, Mail, MessageSquareText, PencilLine, RefreshCw, UserRound } from 'lucide-react'
import { api } from '../../lib/api'
import { directMessagePath } from '../../lib/routes'
import { useBackLink } from '../../lib/recordOrigin'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { grantLine } from '../../lib/lessonEditing'
import { humanize } from '../../lib/glossary'
import type { RelatedRow } from '../../lib/recordRelated'
import { useToast } from '../../contexts/ToastContext'
import { ReturnOrigin } from '../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../components/shared/RelatedPanel'
import { RecordLink } from '../../components/shared/RecordLink'
import { ActivityTimeline } from '../../components/shared/ActivityTimeline'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { NoAccess } from '../../components/shared/NoAccess'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { TeamMember } from '../../types/api'

const ROLE_LABELS: Record<string, string> = { admin: 'Admin', instructor: 'Instructor' }
const COHORT_TONES: Record<string, BadgeTone> = { active: 'success', upcoming: 'info', completed: 'neutral', archived: 'neutral' }

/** One staff person's record page (L-3.6): role, the cohorts they teach, recent activity and a way to message them. */
export function TeamMemberDetail() {
  const { id } = useParams<{ id: string }>()
  return <TeamMemberRecord key={id} memberId={Number(id)} />
}

function TeamMemberRecord({ memberId }: { memberId: number }) {
  const navigate = useNavigate()
  const toast = useToast()
  const back = useBackLink({ returnTo: '/admin/team', returnLabel: 'Team' })
  const [member, setMember] = useState<TeamMember | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [missing, setMissing] = useState(false)
  const [messaging, setMessaging] = useState(false)

  const load = useCallback(async () => {
    if (!Number.isInteger(memberId) || memberId <= 0) { setMissing(true); setLoading(false); return }
    setLoading(true)
    const result = await api.getTeamMember(memberId)
    setLoading(false)
    if (result.data && !result.error) { setMember(result.data.team_member); setError(null); return }
    if (result.status === 404 || result.status === 403) setMissing(true)
    else setError(result.error || 'Could not load this team member.')
  }, [memberId])

  useEffect(() => { void load() }, [load])

  // The Team list's Activity button opens this page at #activity.
  const location = useLocation()
  const loaded = Boolean(member)
  useEffect(() => {
    if (loaded && location.hash === '#activity') scrollToSection('activity')
  }, [loaded, location.hash])

  async function openMessage() {
    if (!member?.message_cohort_id) return
    setMessaging(true)
    const result = await api.createDirectConversation({ cohort_id: member.message_cohort_id, user_ids: [member.id] })
    setMessaging(false)
    if (result.data) navigate(directMessagePath(result.data.direct_conversation.id))
    else toast.error(result.error || `Could not open a conversation with ${member.full_name}.`)
  }

  if (missing) return <NoAccess />
  if (loading && !member) return <LoadingSpinner message="Loading team member…" />
  if (!member) return <div className="app-page"><EmptyState icon={UserRound} title="Could not open this team member" description={error || 'Try again in a moment.'} action={<Button onClick={() => void load()}><RefreshCw className="h-4 w-4" aria-hidden="true" />Try again</Button>} /></div>

  const role = ROLE_LABELS[member.role] || humanize(member.role)
  const running = member.teaching.filter((row) => row.cohort.status === 'active' || row.cohort.status === 'upcoming')
  const editing = member.teaching.filter((row) => row.can_edit_lessons)
  const firstName = member.first_name || member.full_name
  const rows: RelatedRow[] = [
    { key: 'cohorts', icon: Layers, label: 'Cohorts they teach', count: member.teaching.length, onSelect: () => scrollToSection('cohorts') },
    { key: 'editing', icon: PencilLine, label: 'Lesson editing access', count: editing.length, onSelect: () => scrollToSection('cohorts') },
    { key: 'activity', icon: Activity, label: 'Recent activity', value: 'View', onSelect: () => scrollToSection('activity') },
    ...(member.message_cohort_id ? [{ key: 'message', icon: MessageSquareText, label: `Message ${firstName}`, value: null, onSelect: () => void openMessage() }] : []),
  ]

  return <ReturnOrigin label={`Team member · ${member.full_name}`}><div className="app-page-wide space-y-6">
    <RecordHeader
      back={back}
      breadcrumb={[{ label: 'Team', to: '/admin/team' }, { label: member.full_name }]}
      leading={<Avatar name={member.full_name} src={member.avatar_url} size="md" />}
      type={<span>Team member · {role}</span>}
      title={member.full_name}
      titleText={member.full_name}
      status={<>
        <Badge>{role}</Badge>
        {member.is_self && <Badge tone="info">You</Badge>}
        {member.archived_at && <Badge icon={<Archive className="h-3 w-3" aria-hidden="true" />}>Archived</Badge>}
        {!member.archived_at && member.invite_pending && <Badge tone="pending">Invite pending</Badge>}
      </>}
      context={<>
        <span className="inline-flex min-w-0 items-center gap-1 [overflow-wrap:anywhere]"><Mail className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{member.email}</span>
        <span aria-hidden="true">·</span>
        <span className="tabular-nums">{member.last_sign_in_at ? `Last signed in ${formatShortDateTime(member.last_sign_in_at)}` : 'Hasn’t signed in yet'}</span>
      </>}
      actions={member.message_cohort_id ? <Button variant="secondary" size="sm" onClick={() => void openMessage()} disabled={messaging}><MessageSquareText className="h-4 w-4" aria-hidden="true" />{messaging ? 'Opening…' : `Message ${firstName}`}</Button> : null}
    />

    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px] lg:items-start">
      <div className="min-w-0 space-y-6">
        <section id="cohorts" aria-labelledby="team-member-cohorts" className="app-surface overflow-hidden">
          <div className="border-b border-line px-5 py-4 sm:px-6">
            <h2 id="team-member-cohorts" className="text-lg font-bold text-ink">Cohorts they teach</h2>
            <p className="mt-1 text-sm text-ink-secondary">{member.teaching.length
              ? `${running.length} running or upcoming. Lesson editing access is changed on each cohort’s Teaching team tab.`
              : member.role === 'admin' ? 'Admins can open every cohort, so they aren’t assigned to any.' : 'Not assigned to a cohort yet. Assign them from a cohort’s Teaching team tab.'}</p>
          </div>
          {member.teaching.length > 0 && <ul className="divide-y divide-line">{member.teaching.map((row) => (
            <li key={row.cohort.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <RecordLink record={{ type: 'cohort', id: row.cohort.id }} returnLabel={member.full_name} touchTarget truncate className="min-w-0 text-sm">{row.cohort.name}</RecordLink>
                  <Badge tone={COHORT_TONES[row.cohort.status] || 'neutral'}>{humanize(row.cohort.status)}</Badge>
                </div>
                <p className="mt-0.5 text-xs tabular-nums text-ink-muted">{row.cohort.course_delivery === 'self_paced' ? 'Self-paced' : 'Live program'} · starts {formatShortDate(row.cohort.start_date, '')} · assigned {formatShortDate(row.assigned_at, '')}</p>
              </div>
              <div className="flex min-w-0 flex-col items-start gap-0.5 sm:items-end">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink"><PencilLine className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />{row.can_edit_lessons ? 'Can edit lessons' : 'Lessons read only'}</span>
                {row.can_edit_lessons && <span className="text-xs text-ink-muted">{grantLine({ granted_by: row.edit_granted_by, granted_at: row.edit_granted_at }, 'them')}</span>}
                <RecordLink record={{ type: 'cohort', id: row.cohort.id, tab: 'team' }} returnLabel={member.full_name} variant="app" touchTarget peek={false} className="text-xs" aria-label={`Change lesson editing for ${member.full_name} in ${row.cohort.name}`}>Change on Teaching team</RecordLink>
              </div>
            </li>
          ))}</ul>}
        </section>

        {!member.message_cohort_id && !member.is_self && <p className="px-1 text-sm text-ink-muted">{member.archived_at ? 'Archived accounts can’t be messaged.' : `Messages go through a live cohort, and ${firstName} isn’t in one you share yet.`}</p>}

        <div id="activity" className="scroll-mt-24">
          <ActivityTimeline userId={member.id} />
        </div>
        <p className="px-1 text-xs leading-5 text-ink-muted">Joined {formatShortDate(member.created_at, '')}. To change their name, role or GitHub username, use <Link className="app-link" to={`/admin/team#staff-${member.id}`}>Team</Link>.</p>
      </div>
      <RelatedPanel rows={rows} returnLabel={`Team member · ${member.full_name}`} className="lg:sticky lg:top-20" />
    </div>
  </div></ReturnOrigin>
}
