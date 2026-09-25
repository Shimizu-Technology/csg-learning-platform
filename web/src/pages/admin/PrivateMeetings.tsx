import { useCallback, useEffect, useMemo, useState } from 'react'
import { CalendarDays, CheckCircle2, Clock3, ExternalLink, Link2, Plus, RefreshCw, Trash2, Users, WifiOff } from 'lucide-react'
import { api } from '../../lib/api'
import { currentBookingForWeek, formatGuamMeetingTime, slotsForWeek } from '../../lib/privateMeetings'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { useAuthContext } from '../../contexts/AuthContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { useToast } from '../../contexts/ToastContext'
import { Button } from '../../components/ui/Button'
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

  const load = useCallback(async () => {
    setError(null)
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

  const selected = cohorts.find((cohort) => cohort.id === selectedId)
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

  return (
    <div className="app-page-wide space-y-8">
      <PageHeader eyebrow="Student coaching" title="Private meetings" description="Publish the hours you can teach, then manage each student's weekly one-to-one session. Times are entered and shown in Guam time." actions={<Button variant="secondary" onClick={() => { setLoading(true); void load() }}><RefreshCw className="h-4 w-4" />Refresh</Button>} />
      {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}

      {user?.is_admin && unconfigured.length > 0 && (
        <form onSubmit={(event) => void configure(event)} className="rounded-2xl border border-slate-200 bg-white p-5">
          <div className="flex items-start gap-3"><div className="rounded-xl bg-primary-50 p-2 text-primary-700"><Plus className="h-5 w-5" /></div><div><h2 className="text-base font-bold text-slate-950">Enable meetings for a cohort</h2><p className="mt-1 text-sm text-slate-600">Choose the instructor who will host all private meetings for this course.</p></div></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <label className="block text-sm font-semibold text-slate-700">Cohort<select required value={newCohortId} onChange={(event) => setNewCohortId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">Select cohort</option>{unconfigured.map((cohort) => <option key={cohort.id} value={cohort.id}>{cohort.name}</option>)}</select></label>
            <label className="block text-sm font-semibold text-slate-700">Instructor<select required value={newInstructorId} onChange={(event) => setNewInstructorId(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">Select instructor</option>{instructors.map((person) => <option key={person.id} value={person.id}>{person.full_name || person.email}</option>)}{user && !instructors.some((person) => person.id === user.id) && <option value={user.id}>{user.full_name || user.email} (you)</option>}</select></label>
            <Button type="submit" disabled={busy !== null || !newCohortId || !newInstructorId}>{busy === 'configure' ? 'Enabling...' : 'Enable'}</Button>
          </div>
        </form>
      )}

      {cohorts.length === 0 ? <EmptyState icon={CalendarDays} title="No cohorts have private meetings yet" description={user?.is_admin ? 'Enable meetings for a cohort above, then publish times that students can book.' : 'An admin can assign you to a course before you publish meeting times.'} /> : (
        <>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Choose cohort">
            {cohorts.map((cohort) => <button key={cohort.id} type="button" onClick={() => setSelectedId(cohort.id)} aria-pressed={cohort.id === selectedId} className={`min-h-11 rounded-full px-4 text-sm font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 ${cohort.id === selectedId ? 'bg-slate-950 text-white' : 'border border-slate-300 bg-white text-slate-700 hover:border-primary-400'}`}>{cohort.name}</button>)}
          </div>
          {selected && (
            <section className="space-y-6" aria-label={`${selected.name} private meetings`}>
              <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(19rem,0.8fr)]">
                <form onSubmit={(event) => void createSlot(event)} className="rounded-2xl border border-slate-200 bg-white p-5">
                  <div className="flex items-start gap-3"><div className="rounded-xl bg-primary-50 p-2 text-primary-700"><Clock3 className="h-5 w-5" /></div><div><h2 className="text-base font-bold text-slate-950">Publish an available hour</h2><p className="mt-1 text-sm text-slate-600">Publishing a time commits you to it. Cross-check your calendar first.</p></div></div>
                  <div className="mt-5 flex flex-wrap items-end gap-3">
                    <label className="min-w-[15rem] flex-1 text-sm font-semibold text-slate-700">Start in Guam time<input required type="datetime-local" value={slotStartsAt} onChange={(event) => setSlotStartsAt(event.target.value)} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm" /></label>
                    <label className="text-sm font-semibold text-slate-700">Repeat weekly<select value={repeatWeeks} onChange={(event) => setRepeatWeeks(Number(event.target.value))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value={1}>Once</option><option value={2}>2 weeks</option><option value={3}>3 weeks</option></select></label>
                    <Button type="submit" disabled={busy !== null}>{busy === 'slot' ? 'Publishing...' : 'Publish time'}</Button>
                  </div>
                </form>
                <div className="rounded-2xl border border-primary-200 bg-primary-50 p-5">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-800">Course coverage</p>
                  <h2 className="mt-2 text-lg font-bold text-slate-950">{selected.name}</h2>
                  <p className="mt-1 text-sm text-slate-700">Instructor: {selected.instructor_name}</p>
                  <div className="mt-5 flex items-center gap-2 text-sm font-semibold text-primary-900"><Users className="h-4 w-4" />{selected.bookings.filter((booking) => !['canceled', 'cancelled'].includes(booking.status)).length} bookings across {selected.weeks} weeks</div>
                  <p className="mt-3 text-xs leading-relaxed text-slate-600">Zoom links are private to each student's booking. Add each link before its meeting.</p>
                </div>
              </div>

              <div className="grid gap-5 lg:grid-cols-3">
                {Array.from({ length: selected.weeks }, (_, index) => index + 1).map((week) => {
                  const slots = slotsForWeek(selected.slots, selected.start_date, week, selected.weeks)
                  const bookings = selected.bookings.filter((booking) => currentBookingForWeek([booking], week))
                  return <div key={week} className="min-w-0 rounded-2xl border border-slate-200 bg-white p-5"><div className="flex items-center justify-between gap-2"><h3 className="text-base font-bold text-slate-950">Week {week}</h3><span className="text-xs font-semibold text-slate-500">{bookings.length} booked · {slots.filter((slot) => slot.available).length} open</span></div>
                    <div className="mt-4 space-y-2">{slots.length === 0 ? <p className="text-sm text-slate-600">No times published.</p> : slots.map((slot) => <div key={slot.id} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2"><div className="min-w-0"><p className="text-sm font-semibold text-slate-800">{formatGuamMeetingTime(slot.starts_at)}</p><p className="text-xs text-slate-500">{slot.available ? 'Available' : 'Booked'}</p></div><button type="button" title="Remove time" aria-label={`Remove ${formatGuamMeetingTime(slot.starts_at)}`} disabled={!slot.available || busy !== null} onClick={() => void deleteSlot(slot.id)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-slate-500 hover:bg-red-50 hover:text-red-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-30"><Trash2 className="h-4 w-4" /></button></div>)}</div>
                  </div>
                })}
              </div>

              <div className="space-y-4"><div><p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-700">Follow through</p><h2 className="mt-1 text-xl font-bold tracking-tight text-slate-950">Student bookings</h2></div>
                {selected.bookings.filter((booking) => !['canceled', 'cancelled'].includes(booking.status)).length === 0 ? <p className="rounded-2xl border border-dashed border-slate-300 bg-white p-5 text-sm text-slate-600">No students have booked yet.</p> : (
                  <div className="grid gap-4 xl:grid-cols-2">{selected.bookings.filter((booking) => !['canceled', 'cancelled'].includes(booking.status)).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).map((booking) => {
                    const moveOptions = slotsForWeek(selected.slots, selected.start_date, booking.week_number, selected.weeks).filter((slot) => slot.available && slot.instructor_id === selected.instructor_id)
                    return <article key={booking.id} className="rounded-2xl border border-slate-200 bg-white p-5"><div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="font-bold text-slate-950">{booking.student_name || 'Student'}</h3><p className="mt-1 text-sm text-slate-600">Week {booking.week_number} · {formatGuamMeetingTime(booking.starts_at)}</p></div><span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold ${booking.zoom_url ? 'bg-emerald-50 text-emerald-800' : 'bg-amber-50 text-amber-900'}`}>{booking.zoom_url ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Link2 className="h-3.5 w-3.5" />}{booking.zoom_url ? 'Link ready' : 'Link needed'}</span></div>
                      <div className="mt-4 flex flex-wrap items-end gap-2"><label className="min-w-[13rem] flex-1 text-sm font-semibold text-slate-700">Private Zoom URL<input type="url" inputMode="url" placeholder="https://zoom.us/j/..." value={zoomDrafts[booking.id] ?? booking.zoom_url ?? ''} onChange={(event) => setZoomDrafts((current) => ({ ...current, [booking.id]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 px-3 text-sm" /></label><Button disabled={busy !== null} onClick={() => void saveZoom(booking)}>{busy === `booking-${booking.id}` ? 'Saving...' : 'Save link'}</Button>{booking.zoom_url && <a href={sanitizeUrl(booking.zoom_url)} target="_blank" rel="noopener noreferrer" aria-label={`Open ${booking.student_name}'s Zoom link`} className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-300 text-slate-600 hover:bg-slate-50"><ExternalLink className="h-4 w-4" /></a>}</div>
                      {moveOptions.length > 0 && <div className="mt-3 flex flex-wrap items-end gap-2"><label className="min-w-[13rem] flex-1 text-sm font-semibold text-slate-700">Move to another time<select value={moveDrafts[booking.id] || ''} onChange={(event) => setMoveDrafts((current) => ({ ...current, [booking.id]: event.target.value }))} className="mt-1 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-sm"><option value="">Choose available time</option>{moveOptions.map((slot) => <option key={slot.id} value={slot.id}>{formatGuamMeetingTime(slot.starts_at)}</option>)}</select></label><Button variant="secondary" disabled={busy !== null || !moveDrafts[booking.id]} onClick={() => void moveBooking(booking)}>Move</Button></div>}
                      <div className="mt-3 border-t border-slate-100 pt-3"><Button variant="quiet" disabled={busy !== null} onClick={() => void cancelBooking(booking)}>Cancel meeting</Button></div>
                    </article>
                  })}</div>
                )}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
