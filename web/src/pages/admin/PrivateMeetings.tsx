import { Link, useNavigate } from 'react-router-dom'
import { cohortStudentPath } from '../../lib/routes'
import { useMeetingDestination } from '../../lib/useMeetingDestination'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, ChevronDown, Clock3, ExternalLink, Link2, Plus, RefreshCw, Trash2, Users, WifiOff } from 'lucide-react'
import { api } from '../../lib/api'
import { formatGuamMeetingTime, isPastLearnerCutoff, partitionMeetingWeeks, slotsForWeek } from '../../lib/privateMeetings'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { useAuthContext } from '../../contexts/AuthContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { AnchorButton, Button, IconButton } from '../../components/ui/Button'
import { Badge } from '../../components/ui/Badge'
import { Avatar } from '../../components/ui/Avatar'
import { FilterChip } from '../../components/ui/Choice'
import { PageHeader } from '../../components/ui/PageHeader'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import { EmptyState } from '../../components/shared/EmptyState'
import type { CohortSummary, PrivateMeetingBooking, StaffPrivateMeetingCohort, UserListItem } from '../../types/api'

function asGuamIso(localDateTime: string): string | null {
  // Guam uses UTC+10 year round. The input label explicitly names this timezone.
  const date = new Date(`${localDateTime}+10:00`)
  return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

export function StaffPrivateMeetings() {
  const { user } = useAuthContext()
  const navigate = useNavigate()
  const toast = useToast()
  const confirm = useConfirm()
  const [cohorts, setCohorts] = useState<StaffPrivateMeetingCohort[]>([])
  const [allCohorts, setAllCohorts] = useState<CohortSummary[]>([])
  const [instructors, setInstructors] = useState<UserListItem[]>([])
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [newCohortId, setNewCohortId] = useState('')
  const [newInstructorId, setNewInstructorId] = useState('')
  const [slotStartsAt, setSlotStartsAt] = useState('')
  const [repeatWeeks, setRepeatWeeks] = useState(1)
  const [zoomDrafts, setZoomDrafts] = useState<Record<number, string>>({})
  const [moveDrafts, setMoveDrafts] = useState<Record<number, string>>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const destination = useMeetingDestination(loading, cohorts)
  // Past/upcoming split: refreshed on every load and once a minute.
  const [now, setNow] = useState(() => Date.now())

  const load = useCallback(async () => {
    setError(null)
    setNow(Date.now())
    const [meetingsResult, cohortResult, adminResult, instructorResult] = await Promise.all([
      api.getStaffPrivateMeetings(),
      api.getCohorts(),
      api.getUsers({ role: 'admin' }),
      api.getUsers({ role: 'instructor' }),
    ])
    if (meetingsResult.data) {
      setCohorts(meetingsResult.data.cohorts)
      setSelectedId((current) => current && meetingsResult.data!.cohorts.some((cohort) => cohort.id === current) ? current : meetingsResult.data!.cohorts[0]?.id ?? null)
    } else setError(meetingsResult.error || 'Could not load private meetings.')
    if (cohortResult.data) setAllCohorts(cohortResult.data.cohorts)
    const staff = [...(adminResult.data?.users || []), ...(instructorResult.data?.users || [])]
    setInstructors(Array.from(new Map(staff.map((person) => [person.id, person])).values()).filter((person) => !person.archived_at))
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])
  // Move meetings that end while the page is open into the read-only past list.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(timer)
  }, [])

  const selected = cohorts.find((cohort) => cohort.id === (destination.cohortId ?? selectedId))
  const unconfigured = useMemo(() => allCohorts.filter((cohort) => !cohorts.some((configured) => configured.id === cohort.id)), [allCohorts, cohorts])

  async function configure(event: React.FormEvent) {
    event.preventDefault()
    const cohortId = Number(newCohortId)
    const instructorId = Number(newInstructorId || user?.id)
    if (!cohortId || !instructorId) return
    setBusy('configure')
    const response = await api.configurePrivateMeetings(cohortId, instructorId)
    setBusy(null)
    if (response.error) return toast.error(response.error)
    toast.success('Private meetings are enabled for this cohort.')
    setNewCohortId('')
    setSelectedId(cohortId)
    await load()
  }

  async function createSlot(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || !slotStartsAt) return
    const iso = asGuamIso(slotStartsAt)
    if (!iso) return toast.error('Enter a valid Guam date and time.')
    setBusy('slot')
    const response = await api.createPrivateMeetingSlot(selected.id, iso, repeatWeeks)
    setBusy(null)
    if (response.error) return toast.error(response.error)
    toast.success(repeatWeeks > 1 ? 'Weekly times published.' : 'Time published.')
    setSlotStartsAt('')
    await load()
  }

  async function deleteSlot(slotId: number) {
    const approved = await confirm({ title: 'Remove this available time?', description: 'Students will no longer see this time. Existing bookings are protected by the server.', confirmLabel: 'Remove time', tone: 'danger' })
    if (!approved) return
    setBusy(`slot-${slotId}`)
    const response = await api.deletePrivateMeetingSlot(slotId)
    setBusy(null)
    if (response.error) return toast.error(response.error)
    toast.success('Time removed.')
    await load()
  }

  async function saveZoom(booking: PrivateMeetingBooking) {
    const zoomUrl = (zoomDrafts[booking.id] ?? booking.zoom_url ?? '').trim()
    if (!/^https:\/\//i.test(zoomUrl)) return toast.error('Enter the private HTTPS Zoom link for this student.')
    setBusy(`booking-${booking.id}`)
    const response = await api.updateStaffPrivateMeeting(booking.id, { zoom_url: zoomUrl })
    setBusy(null)
    if (response.error) return toast.error(response.error)
    toast.success('Private Zoom link saved.')
    await load()
  }

  async function moveBooking(booking: PrivateMeetingBooking) {
    const slotId = Number(moveDrafts[booking.id])
    if (!slotId) return
    const approved = await confirm({ title: `Move ${booking.student_name}'s meeting?`, description: 'The student will receive the updated time in their private meetings page.', confirmLabel: 'Move meeting' })
    if (!approved) return
    setBusy(`booking-${booking.id}`)
    const response = await api.updateStaffPrivateMeeting(booking.id, { slot_id: slotId })
    setBusy(null)
    if (response.error) return toast.error(response.error)
    toast.success('Meeting moved.')
    setMoveDrafts((current) => ({ ...current, [booking.id]: '' }))
    await load()
  }

  async function cancelBooking(booking: PrivateMeetingBooking) {
    const approved = await confirm({ title: `Cancel ${booking.student_name || 'this student'}'s meeting?`, description: 'The student will see that this appointment was canceled and can contact you to arrange another time.', confirmLabel: 'Cancel meeting', tone: 'danger' })
    if (!approved) return
    setBusy(`booking-${booking.id}`)
    const response = await api.updateStaffPrivateMeeting(booking.id, { status: 'canceled' })
    setBusy(null)
    if (response.error) return toast.error(response.error)
    toast.success('Meeting canceled.')
    await load()
  }

  if (loading) return <LoadingSpinner message="Loading private meetings..." />
  if (error && cohorts.length === 0) return <EmptyState icon={WifiOff} title="Could not load private meetings" description={error} action={<Button onClick={() => { setLoading(true); void load() }}><RefreshCw className="h-4 w-4" />Try again</Button>} />

  const activeBookings = selected ? selected.bookings.filter((booking) => (!['canceled', 'cancelled'].includes(booking.status) || booking.id === destination.bookingId)).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)) : []
  const upcomingBookings = activeBookings.filter((booking) => Date.parse(booking.ends_at) > now)
  const pastBookings = activeBookings.filter((booking) => Date.parse(booking.ends_at) <= now).reverse()
  const weekGroups = selected ? partitionMeetingWeeks(selected.start_date, selected.weeks, now) : { current: [], past: [] }

  const renderWeek = (week: number) => {
    if (!selected) return null
    const slots = slotsForWeek(selected.slots, selected.start_date, week, selected.weeks)
    const bookings = activeBookings.filter((booking) => booking.week_number === week)
    const learnerBookable = slots.filter((slot) => slot.available && !isPastLearnerCutoff(slot.starts_at, selected.reschedule_cutoff_hours)).length
    const pastCutoff = slots.filter((slot) => slot.available && !isPastLearnerCutoff(slot.starts_at, 0) && isPastLearnerCutoff(slot.starts_at, selected.reschedule_cutoff_hours)).length
    return (
      <div key={week} className="min-w-0 rounded-2xl border border-line bg-surface-raised p-4 sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-base font-semibold text-ink">Week {week}</h3>
          <span className="text-xs font-medium tabular-nums text-ink-muted">{bookings.length} booked · {learnerBookable} open to learners{pastCutoff > 0 ? ` · ${pastCutoff} past cutoff` : ''}</span>
        </div>
        <div className="mt-3 space-y-1.5">{slots.length === 0 ? <p className="text-sm text-ink-secondary">No times published.</p> : slots.map((slot) => {
          const past = isPastLearnerCutoff(slot.starts_at, 0)
          const closedToLearners = slot.available && !past && isPastLearnerCutoff(slot.starts_at, selected.reschedule_cutoff_hours)
          return (
            <div key={slot.id} className="flex min-h-12 items-center justify-between gap-2 rounded-xl bg-surface-sunken py-1.5 pl-3 pr-1">
              <div className="min-w-0">
                <p className={`text-sm font-medium tabular-nums ${past || closedToLearners ? 'text-ink-muted' : 'text-ink'}`}>{formatGuamMeetingTime(slot.starts_at)}</p>
                <p className="text-xs text-ink-muted">{!slot.available ? 'Booked' : past ? 'Past — not booked' : closedToLearners ? `Past the ${selected.reschedule_cutoff_hours}-hour learner cutoff — learners can't book it; you can still move a booking here` : 'Open to learners'}</p>
              </div>
              <IconButton label={`Remove ${formatGuamMeetingTime(slot.starts_at)}`} size="sm" disabled={!slot.available || busy !== null} onClick={() => void deleteSlot(slot.id)}><Trash2 className="h-4 w-4" /></IconButton>
            </div>
          )
        })}</div>
      </div>
    )
  }

  const renderBooking = (booking: PrivateMeetingBooking, isPast: boolean) => {
    if (!selected) return null
    const canceled = ['canceled', 'cancelled'].includes(booking.status)
    isPast = isPast || canceled
    const moveOptions = slotsForWeek(selected.slots, selected.start_date, booking.week_number, selected.weeks).filter((slot) => slot.available && slot.instructor_id === selected.instructor_id)
    return (
      <article key={booking.id} id={`booking-${booking.id}`} tabIndex={-1} className={`min-w-0 rounded-2xl border border-line bg-surface-raised p-4 sm:p-5 ${destination.bookingId === booking.id ? 'ring-2 ring-ruby-500' : ''}`}>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={booking.student_name || 'Student'} size="sm" />
            <div className="min-w-0">
              <h3 className="truncate font-semibold text-ink" title={booking.student_name || 'Student'}>{booking.student_id ? <Link className="inline-flex min-h-11 items-center underline underline-offset-4" state={{ returnTo: `/admin/meetings?cohort_id=${booking.cohort_id}&booking_id=${booking.id}&week=${booking.week_number}`, returnLabel: 'Private meetings' }} to={`${cohortStudentPath(booking.cohort_id, booking.student_id)}?return_to=${encodeURIComponent(`/admin/meetings?cohort_id=${booking.cohort_id}&booking_id=${booking.id}&week=${booking.week_number}`)}`}>{booking.student_name || 'Student'}</Link> : booking.student_name || 'Student'}</h3>
              <p className="mt-0.5 text-sm tabular-nums text-ink-secondary">Week {booking.week_number} · {formatGuamMeetingTime(booking.starts_at)}</p>
            </div>
          </div>
          {isPast
            ? <Badge>{canceled ? 'Canceled' : 'Completed'}</Badge>
            : <Badge tone={booking.zoom_url ? 'success' : 'warning'} icon={booking.zoom_url ? <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" /> : <Link2 className="h-3.5 w-3.5" aria-hidden="true" />}>{booking.zoom_url ? 'Link ready' : 'Link needed'}</Badge>}
        </div>
        {!isPast && <>
          <div className="mt-4 flex flex-wrap items-end gap-2">
            <label className="min-w-[13rem] flex-1 text-sm font-semibold text-ink-secondary">Private Zoom URL<input type="url" inputMode="url" placeholder="https://zoom.us/j/..." value={zoomDrafts[booking.id] ?? booking.zoom_url ?? ''} onChange={(event) => setZoomDrafts((current) => ({ ...current, [booking.id]: event.target.value }))} className="app-control mt-1 w-full" /></label>
            <Button variant={booking.zoom_url ? 'secondary' : 'primary'} disabled={busy !== null} onClick={() => void saveZoom(booking)}>{busy === `booking-${booking.id}` ? 'Saving...' : 'Save link'}</Button>
            {booking.zoom_url && <AnchorButton href={sanitizeUrl(booking.zoom_url)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${booking.student_name}'s Zoom link`} className="w-11 px-0"><ExternalLink className="h-4 w-4" /></AnchorButton>}
          </div>
          {moveOptions.length > 0 && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-[13rem] flex-1 text-sm font-semibold text-ink-secondary">Move to another time<select value={moveDrafts[booking.id] || ''} onChange={(event) => setMoveDrafts((current) => ({ ...current, [booking.id]: event.target.value }))} className="app-control mt-1 w-full"><option value="">Choose available time</option>{moveOptions.map((slot) => <option key={slot.id} value={slot.id}>{formatGuamMeetingTime(slot.starts_at)}</option>)}</select></label><Button variant="secondary" disabled={busy !== null || !moveDrafts[booking.id]} onClick={() => void moveBooking(booking)}>Move</Button></div>}
          <div className="mt-3 border-t border-line pt-3"><Button variant="danger" size="sm" disabled={busy !== null} onClick={() => void cancelBooking(booking)}>Cancel meeting</Button></div>
        </>}
      </article>
    )
  }

  return (
    <div className="app-page-wide space-y-8">
      <PageHeader eyebrow="Student coaching" title="Private meetings" description="Publish the hours you can teach, then manage each student's weekly one-to-one session. Times are entered and shown in Guam time (ChST)." actions={<Button variant="secondary" onClick={() => { setLoading(true); void load() }}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
      {destination.cohortId && !selected && <p role="alert" className="text-ink-secondary">This cohort is unavailable for private meetings.</p>}
      {destination.bookingId && selected && !selected.bookings.some((booking) => booking.id === destination.bookingId) && <p role="alert" className="text-ink-secondary">This booking is no longer available in this cohort.</p>}
      {error && <p role="alert" className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">{error}</p>}

      {user?.is_admin && unconfigured.length > 0 && (
        <form onSubmit={(event) => void configure(event)} className="app-surface p-5">
          <div className="flex items-start gap-3"><div className="rounded-xl bg-surface-sunken p-2 text-ink-secondary"><Plus className="h-5 w-5" /></div><div><h2 className="text-base font-semibold text-ink">Enable meetings for a cohort</h2><p className="mt-1 text-sm text-ink-secondary">Choose the instructor who will host all private meetings for this course.</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block min-w-0 text-sm font-semibold text-ink-secondary">Cohort<select required value={newCohortId} onChange={(event) => setNewCohortId(event.target.value)} className="app-control mt-1 w-full"><option value="">Select cohort</option>{unconfigured.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select></label>
            <label className="block min-w-0 text-sm font-semibold text-ink-secondary">Instructor<select required value={newInstructorId} onChange={(event) => setNewInstructorId(event.target.value)} className="app-control mt-1 w-full"><option value="">Select instructor</option>{instructors.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}{user && !instructors.some((person) => person.id === user.id) && <option value={user.id}>{user.full_name || user.email} (you)</option>}</select></label>
            <Button type="submit" variant="secondary" disabled={busy !== null || !newCohortId || !newInstructorId}>{busy === 'configure' ? 'Enabling...' : 'Enable'}</Button>
          </div>
        </form>
      )}

      {cohorts.length === 0 ? <EmptyState icon={CalendarDays} title="No cohorts have private meetings yet" description={user?.is_admin ? 'Enable meetings for a cohort above, then publish times that students can book.' : 'An admin can assign you to a course before you publish meeting times.'} /> : (
        <>
          <div className="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="Choose cohort">
            {cohorts.map((cohort) => <FilterChip key={cohort.id} selected={cohort.id === selected?.id} onClick={() => { setSelectedId(cohort.id); navigate(`/admin/meetings?cohort_id=${cohort.id}`, { replace: true }) }} title={cohort.name} className="max-w-[18rem]"><span className="truncate">{cohort.name}</span></FilterChip>)}
          </div>
          {selected && (
            <section className="space-y-6" aria-label={`${selected.name} private meetings`}>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)]">
                <form onSubmit={(event) => void createSlot(event)} className="app-surface p-5">
                  <div className="flex items-start gap-3"><div className="rounded-xl bg-surface-sunken p-2 text-ink-secondary"><Clock3 className="h-5 w-5" /></div><div><h2 className="text-base font-semibold text-ink">Publish an available hour</h2><p className="mt-1 text-sm text-ink-secondary">Publishing a time commits you to it. Cross-check your calendar first.</p></div></div>
                  <div className="mt-5 flex flex-wrap items-end gap-3">
                    <label className="min-w-[15rem] flex-1 text-sm font-semibold text-ink-secondary">Start in Guam time (ChST)<input required type="datetime-local" value={slotStartsAt} onChange={(event) => setSlotStartsAt(event.target.value)} className="app-control mt-1 w-full" /></label>
                    <label className="text-sm font-semibold text-ink-secondary">Repeat weekly<select value={repeatWeeks} onChange={(event) => setRepeatWeeks(Number(event.target.value))} className="app-control mt-1 w-full"><option value={1}>Once</option><option value={2}>2 weeks</option><option value={3}>3 weeks</option></select></label>
                    <Button type="submit" disabled={busy !== null}>{busy === 'slot' ? 'Publishing...' : 'Publish time'}</Button>
                  </div>
                </form>
                <div className="app-surface-muted p-5">
                  <p className="text-xs font-semibold text-ink-muted">Course coverage</p>
                  <h2 className="mt-1 text-lg font-bold text-ink [overflow-wrap:anywhere]">{selected.name}</h2>
                  <p className="mt-1 text-sm text-ink-secondary">Instructor: {selected.instructor_name}</p>
                  <div className="mt-4 flex items-center gap-2 text-sm font-semibold tabular-nums text-ink"><Users className="h-4 w-4 text-ink-muted" aria-hidden="true" />{activeBookings.length} bookings across {selected.weeks} weeks</div>
                  <p className="mt-3 text-xs leading-relaxed text-ink-secondary">Zoom links are private to each student's booking. Add each link before its meeting.</p>
                </div>
              </div>

              <div className="space-y-3">
                <h2 className="text-lg font-bold text-ink">Available times</h2>
                {weekGroups.current.length > 0
                  ? <div className="grid gap-4 lg:grid-cols-3">{weekGroups.current.map(renderWeek)}</div>
                  : <p className="text-sm text-ink-secondary">All meeting weeks for this course are over.</p>}
                {weekGroups.past.length > 0 && (
                  <details className="group rounded-2xl border border-line bg-surface-raised" data-testid="staff-past-meeting-weeks">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-3 text-sm font-semibold text-ink-secondary hover:text-ink [&::-webkit-details-marker]:hidden">
                      <span>Past weeks <span className="tabular-nums text-ink-muted">({weekGroups.past.length})</span></span>
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-[180ms] group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="grid gap-4 border-t border-line p-4 lg:grid-cols-3">{weekGroups.past.map(renderWeek)}</div>
                  </details>
                )}
              </div>

              <div className="space-y-4">
                <h2 className="text-lg font-bold text-ink">Student bookings</h2>
                {upcomingBookings.length === 0 ? <p className="rounded-2xl border border-dashed border-line-strong bg-surface-raised p-5 text-sm text-ink-secondary">{activeBookings.length === 0 ? 'No students have booked yet.' : 'No upcoming bookings.'}</p> : (
                  <div className="grid gap-4 xl:grid-cols-2">{upcomingBookings.map((booking) => renderBooking(booking, false))}</div>
                )}
                {pastBookings.length > 0 && (
                  <details className="group rounded-2xl border border-line bg-surface-raised" data-testid="staff-past-bookings">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-3 text-sm font-semibold text-ink-secondary hover:text-ink [&::-webkit-details-marker]:hidden">
                      <span>Past meetings <span className="tabular-nums text-ink-muted">({pastBookings.length})</span></span>
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-[180ms] group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="grid gap-4 border-t border-line p-4 xl:grid-cols-2">{pastBookings.map((booking) => renderBooking(booking, true))}</div>
                  </details>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
