import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { Activity, Archive, ClipboardCheck, Layers, LifeBuoy, Mail, MessageSquareText, PencilLine, ShieldAlert, UserPlus, UserRound, UserRoundCheck } from 'lucide-react'
import { api } from '../../lib/api'
import { directMessagePath, safetyPersonPath } from '../../lib/routes'
import { useBackLink } from '../../lib/recordOrigin'
import { formatShortDate, formatShortDateTime } from '../../lib/format'
import { grantLine } from '../../lib/lessonEditing'
import { humanize, TERMS } from '../../lib/glossary'
import { FOLLOW_UP_STATUS_LABELS } from '../../lib/followUpLabels'
import { gradingPath, plural, supportPath } from '../../lib/recordUsage'
import type { RelatedRow } from '../../lib/recordRelated'
import { useToast } from '../../contexts/ToastContext'
import { ReturnOrigin } from '../../contexts/PreviewNavigationContext'
import { RecordHeader } from '../../components/shared/RecordHeader'
import { RelatedPanel, scrollToSection } from '../../components/shared/RelatedPanel'
import { RecordLink } from '../../components/shared/RecordLink'
import { ActivityTimeline } from '../../components/shared/ActivityTimeline'
import { Avatar } from '../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import type { TeamMember } from '../../types/api'
import { DetailGate } from './records/RecordParts'

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
  const [availableCohorts, setAvailableCohorts] = useState<Array<{ id: number; name: string; status: string }>>([])
  const [assignCohortId, setAssignCohortId] = useState('')
  const [assigning, setAssigning] = useState(false)

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

  useEffect(() => {
    if (!member || member.role !== 'instructor' || member.archived_at) return
    if (typeof api.getCohorts !== 'function') return
    let active = true
    void api.getCohorts().then((result) => {
      if (!active || !result.data) return
      setAvailableCohorts(
        result.data.cohorts
          .filter((cohort) => cohort.status === 'active' || cohort.status === 'upcoming')
          .map(({ id, name, status }) => ({ id, name, status })),
      )
    }).catch(() => {})
    return () => { active = false }
  }, [member])

  async function assignToCohort() {
    if (!member || !assignCohortId || assigning) return
    setAssigning(true)
    const result = await api.createCohortInstructorAssignment(Number(assignCohortId), member.id)
    setAssigning(false)
    if (result.error) {
      toast.error(result.error || 'Could not assign to that cohort.')
      return
    }
    const cohortName = availableCohorts.find((c) => c.id === Number(assignCohortId))?.name
    setAssignCohortId('')
    toast.success(cohortName ? `Assigned ${member.full_name} to ${cohortName}.` : `Assigned ${member.full_name} to cohort.`)
    await load()
  }

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

  // Loading, No access and failed loads keep the Back link (the record contract, spec §5).
  if (!member || missing) return <DetailGate state={{ detail: null, loading: loading && !missing, error, missing, reload: load }} label="team member" icon={UserRound} fallback={{ returnTo: '/admin/team', returnLabel: 'Team' }}>{() => null}</DetailGate>

  const role = ROLE_LABELS[member.role] || humanize(member.role)
  const running = member.teaching.filter((row) => row.cohort.status === 'active' || row.cohort.status === 'upcoming')
  const editing = member.teaching.filter((row) => row.can_edit_lessons)
  const firstName = member.first_name || member.full_name
  const waiting = member.teaching.reduce((sum, row) => sum + row.waiting_review, 0)
  const workload = member.workload
  const rows: RelatedRow[] = [
    { key: 'cohorts', icon: Layers, label: 'Cohorts they teach', count: member.teaching.length, onSelect: () => scrollToSection('cohorts') },
    // Grading load (L-3.2): latest attempts waiting for review across the cohorts they teach.
    { key: 'grading', icon: ClipboardCheck, label: 'Grading load', count: waiting, attention: waiting > 0, ...(member.teaching.length === 1 ? { to: gradingPath({ cohortId: member.teaching[0].cohort.id }) } : { onSelect: () => scrollToSection('cohorts') }) },
    { key: 'follow_ups', icon: UserRoundCheck, label: `${TERMS.followUpPlans} they own`, count: workload.follow_ups_count, onSelect: () => scrollToSection('follow-ups') },
    { key: 'owned_help', icon: LifeBuoy, label: 'Help requests they own', count: workload.owned_help_count },
    { key: 'editing', icon: PencilLine, label: 'Lesson editing access', count: editing.length, onSelect: () => scrollToSection('cohorts') },
    { key: 'activity', icon: Activity, label: 'Recent activity', value: 'View', onSelect: () => scrollToSection('activity') },
    // Reports by and about them and blocks they made or received (L-3.2), listed on Safety.
    safetyRow(member),
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
              : member.role === 'admin' ? 'Admins can open every cohort, so they aren’t assigned to any.' : 'Not assigned to a cohort yet. Assign them below or from a cohort’s Teaching team tab.'}</p>
            {member.role === 'instructor' && !member.archived_at && (() => {
              const assignedIds = new Set(member.teaching.map((row) => row.cohort.id))
              const assignable = availableCohorts.filter((cohort) => !assignedIds.has(cohort.id))
              if (!assignable.length) return null
              return (
                <div className="mt-4 flex flex-col gap-2 sm:flex-row">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Assign {member.full_name} to a cohort</span>
                    <select
                      aria-label="Assign to a cohort"
                      value={assignCohortId}
                      onChange={(event) => setAssignCohortId(event.target.value)}
                      disabled={assigning}
                      className="app-control w-full"
                    >
                      <option value="">Choose a cohort to assign…</option>
                      {assignable.map((cohort) => (
                        <option key={cohort.id} value={cohort.id}>
                          {cohort.name} ({humanize(cohort.status)})
                        </option>
                      ))}
                    </select>
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    disabled={!assignCohortId || assigning}
                    onClick={() => void assignToCohort()}
                  >
                    <UserPlus className="h-4 w-4" aria-hidden="true" />
                    {assigning ? 'Assigning…' : 'Assign to a cohort'}
                  </Button>
                </div>
              )
            })()}
          </div>
          {member.teaching.length > 0 && <ul className="divide-y divide-line">{member.teaching.map((row) => (
            <li key={row.cohort.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <RecordLink record={{ type: 'cohort', id: row.cohort.id }} returnLabel={member.full_name} touchTarget truncate className="min-w-0 text-sm">{row.cohort.name}</RecordLink>
                  <Badge tone={COHORT_TONES[row.cohort.status] || 'neutral'}>{humanize(row.cohort.status)}</Badge>
                </div>
                <p className="mt-0.5 text-xs tabular-nums text-ink-muted">{row.cohort.course_delivery === 'self_paced' ? 'Self-paced' : 'Live program'} · starts {formatShortDate(row.cohort.start_date, '')} · assigned {formatShortDate(row.assigned_at, '')}</p>
                <p className="mt-0.5 flex flex-wrap gap-x-3 text-xs font-semibold tabular-nums">
                  <Link to={gradingPath({ cohortId: row.cohort.id })} className={`inline-flex min-h-11 items-center hover:underline sm:min-h-0 ${row.waiting_review ? 'text-warning-ink' : 'text-ink-muted'}`}>{row.waiting_review} waiting for review</Link>
                  <Link to={supportPath(row.cohort.id)} className={`inline-flex min-h-11 items-center hover:underline sm:min-h-0 ${row.open_help ? 'text-warning-ink' : 'text-ink-muted'}`}>{row.open_help} open help</Link>
                </p>
              </div>
              <div className="flex min-w-0 flex-col items-start gap-0.5 sm:items-end">
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink"><PencilLine className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />{row.can_edit_lessons ? 'Can edit lessons' : 'Lessons read only'}</span>
                {row.can_edit_lessons && <span className="text-xs text-ink-muted">{grantLine({ granted_by: row.edit_granted_by, granted_at: row.edit_granted_at }, 'them')}</span>}
                <RecordLink record={{ type: 'cohort', id: row.cohort.id, tab: 'team' }} returnLabel={member.full_name} variant="app" touchTarget peek={false} className="text-xs" aria-label={`Change lesson editing for ${member.full_name} in ${row.cohort.name}`}>Change on Teaching team</RecordLink>
              </div>
            </li>
          ))}</ul>}
        </section>

        <section id="follow-ups" aria-labelledby="team-member-follow-ups" className="app-surface overflow-hidden" tabIndex={-1}>
          <div className="border-b border-line px-5 py-4 sm:px-6">
            <h2 id="team-member-follow-ups" className="text-lg font-bold text-ink">{TERMS.followUpPlans} they own</h2>
            <p className="mt-1 text-sm text-ink-secondary">{workload.follow_ups_count
              ? `${plural(workload.follow_ups_count, 'active plan')}, soonest follow-up first.${workload.follow_ups_count > workload.follow_ups.length ? ` Showing ${workload.follow_ups.length}.` : ''}`
              : `${firstName} doesn’t own an active ${TERMS.followUpPlan.toLowerCase()}.`}{workload.owned_help_count ? ` They also own ${plural(workload.owned_help_count, 'open help request')}.` : ''}</p>
          </div>
          {workload.follow_ups.length > 0 && <ul className="divide-y divide-line">{workload.follow_ups.map((plan) => (
            <li key={plan.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 sm:px-6">
              <UserRoundCheck className="h-4 w-4 shrink-0 text-ink-muted" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <RecordLink record={{ type: 'intervention', id: plan.id }} variant="plain" touchTarget className="font-semibold">{`${plan.student.name}'s ${TERMS.followUpPlan.toLowerCase()}`}</RecordLink>
                <p className="text-xs text-ink-muted">
                  <RecordLink record={{ type: 'student', id: plan.student.id, cohortId: plan.cohort.id }} variant="plain" className="font-normal text-ink-muted">{plan.student.name}</RecordLink>
                  {' · '}<RecordLink record={{ type: 'cohort', id: plan.cohort.id }} variant="plain" className="font-normal text-ink-muted">{plan.cohort.name}</RecordLink>
                </p>
              </div>
              <Badge tone={plan.severity === 'urgent' ? 'danger' : 'neutral'}>{FOLLOW_UP_STATUS_LABELS[plan.status as keyof typeof FOLLOW_UP_STATUS_LABELS] ?? humanize(plan.status)}</Badge>
              <span className="text-xs tabular-nums text-ink-muted">{plan.next_follow_up_at ? `Follow up ${formatShortDate(plan.next_follow_up_at, '', { withYear: false })}` : 'No follow-up date'}</span>
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

function safetyRow(member: TeamMember): RelatedRow {
  const { safety } = member
  const total = safety.reports_about + safety.reports_by + safety.blocks_made + safety.blocked_by
  const count = safety.open_reports_about
  return { key: 'safety', icon: ShieldAlert, label: 'Open reports about them', ...(count || !total ? { count } : { value: 'View' }), attention: count > 0, to: total ? safetyPersonPath(member.id) : null }
}
