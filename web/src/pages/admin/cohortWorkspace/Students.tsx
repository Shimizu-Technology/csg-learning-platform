import { AlertTriangle, MessageSquareText, RefreshCw, Users } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { EmptyState } from '../../../components/shared/EmptyState'
import { PresenceBadge } from '../../../components/shared/PresenceBadge'
import { RecordLink } from '../../../components/shared/RecordLink'
import { Avatar } from '../../../components/ui/Avatar'
import { Badge, type BadgeTone } from '../../../components/ui/Badge'
import { Button, LinkButton } from '../../../components/ui/Button'
import { useAuthContext } from '../../../contexts/AuthContext'
import { PreviewLink as Link } from '../../../contexts/PreviewNavigationContext'
import { api } from '../../../lib/api'
import { formatShortDateTime } from '../../../lib/format'
import { inviteStatusPresentation } from '../../../lib/inviteStatus'
import { presenceStatus, usePresenceNow } from '../../../lib/presence'
import { subscribeToStaffPresence } from '../../../lib/realtime'
import { useRememberRoster } from '../../../lib/recordQueue'
import { cohortPath, cohortStudentPath } from '../../../lib/routes'
import { urlParsers, useUrlSearch, useUrlState } from '../../../lib/useUrlState'
import type { CohortDetail, GithubAccessResponse, GithubAccessStatus } from '../../../types/api'

export const ROSTER_FILTERS = [
  'all',
  'cohort_joined',
  'cohort_not_opened',
  'app_pending',
  'github_member',
  'github_invited',
  'github_followup',
] as const

export type RosterFilter = (typeof ROSTER_FILTERS)[number]

export const ROSTER_URL = { access: urlParsers.oneOf(ROSTER_FILTERS, 'all') }

export function Students({ cohort }: { cohort: CohortDetail }) {
  const { user } = useAuthContext()
  const now = usePresenceNow()
  const [seen, setSeen] = useState<Record<number, string>>({})
  const [inviteBusy, setInviteBusy] = useState<number | null>(null)
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviteUpdates, setInviteUpdates] = useState<Record<number, Partial<CohortDetail['students'][number]>>>({})
  useEffect(() => {
    let active = true
    let unsubscribe: (() => void) | undefined
    void subscribeToStaffPresence((event) => {
      if (active) setSeen((current) => ({ ...current, [event.user_id]: event.last_seen_at }))
    })
      .then((stop) => {
        if (active) unsubscribe = stop
        else stop()
      })
      .catch(() => {})
    return () => {
      active = false
      unsubscribe?.()
    }
  }, [])
  async function resend(userId: number) {
    setInviteBusy(userId)
    setInviteMessage('')
    try {
      const result = await api.resendInvite(userId)
      if (result.error || !result.data) {
        const email = cohort.students.find((student) => student.user_id === userId)?.email
        setInviteUpdates((current) => ({
          ...current,
          [userId]: { ...current[userId], invite_delivery_status: 'failed', invite_last_error: result.error },
        }))
        setInviteMessage(
          `${email ? `Could not send the invitation to ${email}` : 'Could not send the invitation'}: ${result.error || 'try again.'}`,
        )
        return
      }
      const invitation = result.data.invitation
      setInviteUpdates((current) => ({
        ...current,
        [userId]: {
          invite_state: undefined,
          invite_delivery_status: invitation.status as 'sent' | 'failed' | 'queued',
          invite_sent_at: invitation.sent_at,
          invite_expires_at: undefined,
          invite_last_error: invitation.error,
        },
      }))
      setInviteMessage(result.data.message)
    } catch {
      setInviteMessage('Could not send invitation. Try again.')
    } finally {
      setInviteBusy(null)
    }
  }
  const [github, setGithub] = useState<GithubAccessResponse | null>(null)
  const [githubError, setGithubError] = useState<string | null>(null)
  const [githubLoading, setGithubLoading] = useState(false)
  const location = useLocation()
  // Search and access filter live in the URL (L-0.6), so Back from a student restores them.
  const [{ access: requestedFilter }, setUrlState] = useUrlState(ROSTER_URL)
  const [search, setSearch] = useUrlSearch('q')
  const loadGithub = useCallback(async () => {
    if (!cohort.github_organization_name) return
    setGithubLoading(true)
    const result = await api.getCohortGithubAccess(cohort.id)
    if (result.data && !result.error && !result.fromCache) {
      setGithub(result.data)
      setGithubError(null)
    } else {
      setGithub(null)
      setGithubError(result.error || 'Could not check GitHub access.')
    }
    setGithubLoading(false)
  }, [cohort.id, cohort.github_organization_name])
  useEffect(() => {
    void loadGithub()
  }, [loadGithub])

  const status = (id: number): GithubAccessStatus | 'unavailable' => github?.statuses[String(id)] || 'unavailable'
  // A GitHub filter without GitHub data (not configured, or the check failed) falls back to everyone.
  const filter = requestedFilter.startsWith('github_') && !github ? 'all' : requestedFilter
  const setFilter = (value: string) => setUrlState({ access: value as RosterFilter })
  const moduleId = Number(new URLSearchParams(location.search).get('module_id')) || null
  const selectedModule = cohort.modules.find((module) => module.id === moduleId)
  const visible = cohort.students.filter((student) => {
    const text = `${student.full_name} ${student.email} ${student.github_username || ''}`.toLowerCase()
    const matchesFilter =
      filter === 'all' ||
      (filter === 'cohort_joined' && Boolean(student.joined_at)) ||
      (filter === 'cohort_not_opened' && !student.joined_at) ||
      (filter === 'app_pending' && !student.last_sign_in_at) ||
      (filter === 'github_member' && status(student.user_id) === 'member') ||
      (filter === 'github_invited' && status(student.user_id) === 'invited') ||
      (filter === 'github_followup' && ['not_invited', 'username_missing'].includes(status(student.user_id)))
    return (
      matchesFilter &&
      text.includes(search.trim().toLowerCase()) &&
      (!selectedModule || selectedModule.assigned_enrollment_ids?.includes(student.enrollment_id))
    )
  })
  const githubLabels: Record<GithubAccessStatus | 'unavailable', string> = {
    member: 'Joined GitHub org',
    invited: 'GitHub invite pending',
    not_invited: 'No current GitHub invite',
    username_missing: 'GitHub username needed',
    unavailable: 'GitHub status unavailable',
  }
  const githubTones: Record<GithubAccessStatus | 'unavailable', BadgeTone> = {
    member: 'success',
    invited: 'pending',
    not_invited: 'warning',
    username_missing: 'warning',
    unavailable: 'neutral',
  }
  // The student page walks this filtered roster with Previous/Next (L-0.7).
  useRememberRoster(
    user?.id,
    `${location.pathname}${location.search}`,
    visible.map((student) => ({ cohortId: cohort.id, userId: student.user_id })),
    !githubLoading,
  )
  if (!cohort.students.length)
    return <EmptyState icon={Users} title="No students enrolled" description="An admin can add a student here." />
  return (
    <section className="app-surface overflow-hidden">
      <div className="border-b border-line px-5 py-5 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-ink">Access and invitations</h2>
            <p className="mt-1 text-sm text-ink-secondary">
              Cohort entry, app account invitation, and GitHub organization membership are tracked separately.
              {cohort.github_organization_name && ' GitHub organization membership is separate from personal repository access used for exercise sync.'}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {cohort.github_organization_name && (
              <Button variant="secondary" onClick={() => void loadGithub()} disabled={githubLoading}>
                <RefreshCw className="h-4 w-4" />
                {githubLoading ? 'Checking…' : 'Refresh GitHub'}
              </Button>
            )}
          </div>
        </div>
        {githubError && (
          <p
            role="status"
            className="mt-3 rounded-xl border border-warning-line bg-warning-soft p-3 text-sm text-warning-ink"
          >
            {githubError} App statuses are still available.
          </p>
        )}
        {!cohort.github_organization_name && (
          <p className="mt-3 text-sm text-ink-muted">No GitHub organization is configured for this cohort.</p>
        )}
        {github && (
          <p className="mt-2 text-xs tabular-nums text-ink-muted">
            GitHub checked {formatShortDateTime(github.checked_at, '—')} · {github.organization}
          </p>
        )}
        <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3">
            <p className="text-xl font-bold tabular-nums text-ink">
              {cohort.students.filter((student) => student.joined_at).length}
            </p>
            <p className="text-xs font-semibold text-ink-secondary">joined cohort</p>
          </div>
          <div className="rounded-xl border border-warning-line bg-warning-soft px-4 py-3">
            <p className="text-xl font-bold tabular-nums text-warning-ink">
              {cohort.students.filter((student) => !student.joined_at).length}
            </p>
            <p className="text-xs font-semibold text-warning-ink">added, not yet opened</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3">
            <p className="text-xl font-bold tabular-nums text-ink">
              {cohort.students.filter((student) => student.last_sign_in_at).length}
            </p>
            <p className="text-xs font-semibold text-ink-secondary">signed in to app</p>
          </div>
          <div className="rounded-xl border border-line bg-surface-sunken px-4 py-3">
            <p className="text-xl font-bold tabular-nums text-ink">
              {github ? cohort.students.filter((student) => status(student.user_id) === 'member').length : '—'}
            </p>
            <p className="text-xs font-semibold text-ink-secondary">joined GitHub org</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_220px]">
          <label className="relative">
            <span className="sr-only">Search enrolled students</span>
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search name, email, or GitHub username"
              className="app-control w-full"
            />
          </label>
          <label>
            <span className="sr-only">Filter access status</span>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} className="app-control w-full">
              <option value="all">All enrolled</option>
              <option value="cohort_joined">Joined cohort</option>
              <option value="cohort_not_opened">Added, not yet opened</option>
              <option value="app_pending">Not signed in to app</option>
              <option value="github_member" disabled={!github}>
                Joined GitHub org
              </option>
              <option value="github_invited" disabled={!github}>
                GitHub invite pending
              </option>
              <option value="github_followup" disabled={!github}>
                GitHub follow-up needed
              </option>
            </select>
          </label>
        </div>
        <p aria-live="polite" className="mt-3 text-xs font-semibold tabular-nums text-ink-muted">
          Showing {visible.length} of {cohort.students.length} enrolled
        </p>
      </div>
      <p className="px-5 text-sm text-ink-secondary">
        {selectedModule && (
          <>
            Assigned to {selectedModule.name} ·{' '}
            <Link className="app-link inline-flex min-h-11 items-center" to={cohortPath(cohort.id, 'students')}>
              All students
            </Link>
          </>
        )}
      </p>
      <p role="status" className="px-5 text-sm">
        {inviteMessage}
      </p>
      <div className="divide-y divide-line">
        {visible.map((original) => {
          const student = { ...original, ...inviteUpdates[original.user_id] }
          const invite = inviteStatusPresentation(student)
          const lastSeen = seen[student.user_id] || student.last_seen_at
          const githubStatus = status(student.user_id)
          const appLabel = student.last_sign_in_at
            ? 'Signed in to app'
            : student.invite_pending
              ? 'App invite ' +
                (student.invite_delivery_status === 'failed'
                  ? 'failed'
                  : student.invite_delivery_status === 'queued'
                    ? 'queued'
                    : student.invite_delivery_status === 'not_sent'
                      ? 'not sent'
                      : 'sent')
              : 'App account ready · no sign-in'
          return (
            <div
              key={student.enrollment_id}
              className="grid gap-3 px-5 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:px-6"
            >
              <div className="flex min-w-0 items-start gap-3">
                <Avatar name={student.full_name || student.email} size="sm" className="mt-0.5" />
                <div className="min-w-0">
                  <RecordLink
                    record={{ type: 'student', id: student.user_id, cohortId: cohort.id }}
                    returnLabel={`${cohort.name} · Students`}
                    variant="unstyled"
                    touchTarget
                    truncate
                    className="font-semibold text-ink hover:text-primary-soft-ink hover:underline"
                    title={student.full_name || student.email}
                  >
                    {student.full_name || student.email}
                  </RecordLink>
                  <p className="truncate text-sm text-ink-muted" title={student.email}>
                    {student.email}
                    {student.github_username ? ` · @${student.github_username}` : ''}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <Badge tone={student.joined_at ? 'success' : 'warning'}>
                      {student.joined_at ? 'Joined cohort' : 'Added, not yet opened'}
                    </Badge>
                    <Badge
                      tone={
                        student.last_sign_in_at
                          ? 'neutral'
                          : student.invite_delivery_status === 'failed'
                            ? 'danger'
                            : 'warning'
                      }
                    >
                      {appLabel}
                    </Badge>
                    <Badge tone={invite.tone}>{invite.label}</Badge>
                    <PresenceBadge status={presenceStatus(lastSeen, now)} />
                    {cohort.github_organization_name && (
                      <Badge tone={githubTones[githubStatus]}>{githubLabels[githubStatus]}</Badge>
                    )}
                  </div>
                  {invite.detail && <p className="mt-1 text-sm text-ink-secondary">{invite.detail}</p>}
                  <p className="mt-1 text-xs text-ink-muted">
                    Last sign-in: {formatShortDateTime(student.last_sign_in_at, 'Never')} · Last active:{' '}
                    {student.last_active_at !== undefined
                      ? formatShortDateTime(student.last_active_at, 'No learning activity yet')
                      : formatShortDateTime(lastSeen, 'Never')}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {user?.is_admin && invite.actionLabel && (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={inviteBusy !== null}
                    onClick={() => void resend(student.user_id)}
                  >
                    {inviteBusy === student.user_id ? 'Sending…' : invite.actionLabel}
                  </Button>
                )}
                <LinkButton
                  variant="secondary"
                  size="sm"
                  to={cohortStudentPath(cohort.id, student.user_id, 'communication')}
                >
                  <MessageSquareText className="h-4 w-4" />
                  Messages
                </LinkButton>
              </div>
            </div>
          )
        })}
        {!visible.length && (
          <p className="px-5 py-8 text-sm text-ink-muted">No students match this search and filter.</p>
        )}
      </div>
    </section>
  )
}

export function Signal({ label, tone }: { label: string; tone: 'red' | 'amber' | 'slate' }) {
  const tones: Record<typeof tone, BadgeTone> = { red: 'danger', amber: 'warning', slate: 'neutral' }
  return (
    <Badge
      tone={tones[tone]}
      className="tabular-nums"
      icon={tone === 'red' ? <AlertTriangle className="h-3.5 w-3.5" /> : undefined}
    >
      {label}
    </Badge>
  )
}
