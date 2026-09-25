import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { CalendarDays, Clock3, ExternalLink, MessageCircle, RefreshCw, Video, WifiOff } from 'lucide-react'
import { api } from '../../lib/api'
import { currentBookingForWeek, formatGuamMeetingTime, slotsForWeek } from '../../lib/privateMeetings'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { Button } from '../../components/ui/Button'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import type { PrivateMeetingCohort, PrivateMeetingSlot } from '../../types/api'

export function PrivateMeetings() {
  const toast = useToast()
  const confirm = useConfirm()
  const [cohorts, setCohorts] = useState<PrivateMeetingCohort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [changingBookingId, setChangingBookingId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setError(null)
    const response = await api.getPrivateMeetings()
    if (response.data) setCohorts(response.data.cohorts)
    else setError(response.error || 'Could not load your meetings.')
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  async function selectSlot(slot: PrivateMeetingSlot, bookingId?: number) {
    const approved = await confirm({
      title: bookingId ? 'Move your private meeting?' : 'Book this private meeting?',
      description: `${formatGuamMeetingTime(slot.starts_at)} with ${slot.instructor_name}. ${bookingId ? 'This uses your one learner reschedule.' : 'This reserves the full hour for you.'}`,
      confirmLabel: bookingId ? 'Move meeting' : 'Book meeting',
    })
    if (!approved) return
    setBusyId(slot.id)
    const response = bookingId
      ? await api.reschedulePrivateMeeting(bookingId, slot.id)
      : await api.bookPrivateMeeting(slot.id)
    setBusyId(null)
    if (response.error) {
      toast.error(response.error || 'That time is no longer available. Please choose another.')
      await load()
      return
    }
    setChangingBookingId(null)
    toast.success(bookingId ? 'Your meeting was moved.' : 'Your meeting is booked.')
    await load()
  }

  async function cancelBooking(bookingId: number) {
    const approved = await confirm({
      title: 'Cancel this private meeting?',
      description: 'Your reserved time will be released. Booking another time follows the course meeting policy.',
      confirmLabel: 'Cancel meeting',
      tone: 'danger',
    })
    if (!approved) return
    setBusyId(bookingId)
    const response = await api.cancelPrivateMeeting(bookingId)
    setBusyId(null)
    if (response.error) {
      toast.error(response.error || 'Could not cancel the meeting.')
      return
    }
    setChangingBookingId(null)
    toast.success('Your meeting was canceled.')
    await load()
  }

  if (loading) return <LoadingSpinner message="Loading your meetings..." />
  if (error && cohorts.length === 0) return <EmptyState icon={WifiOff} title="Could not load your meetings" description={error} action={<Button onClick={() => { setLoading(true); void load() }}><RefreshCw className="h-4 w-4" />Try again</Button>} />

  return (
    <div className="app-page-wide space-y-8">
      <PageHeader
        eyebrow="One hour, just for you"
        title="My meetings"
        description="Choose one private 60-minute meeting for each course week. All times below are shown in Guam time."
        actions={<Link to="/messages" className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"><MessageCircle className="h-4 w-4" />Message your instructor</Link>}
      />

      {error && <p role="alert" className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}

      {cohorts.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No private meetings yet" description="When your course is ready for scheduling, its weekly times will appear here." />
      ) : cohorts.map((cohort) => (
        <section key={cohort.id} aria-labelledby={`meeting-cohort-${cohort.id}`} className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-slate-200 pb-4">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-primary-700">Private coaching</p>
              <h2 id={`meeting-cohort-${cohort.id}`} className="mt-1 text-xl font-bold tracking-tight text-slate-950">{cohort.name}</h2>
              <p className="mt-1 text-sm text-slate-600">With {cohort.instructor_name}</p>
            </div>
            <p className="rounded-full bg-primary-50 px-3 py-1.5 text-xs font-bold text-primary-800">{cohort.weeks} weekly meetings</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            {Array.from({ length: cohort.weeks }, (_, index) => index + 1).map((week) => {
              const booking = currentBookingForWeek(cohort.bookings, week)
              const cutoff = cohort.reschedule_cutoff_hours * 60 * 60 * 1000
              const available = slotsForWeek(cohort.slots, cohort.start_date, week, cohort.weeks).filter((slot) => slot.available && Date.parse(slot.starts_at) > Date.now() + cutoff)
              const changing = booking?.id === changingBookingId
              const beforeCutoff = booking && Date.parse(booking.starts_at) > Date.now() + cutoff
              const canReschedule = beforeCutoff && booking.reschedule_count < cohort.max_student_changes
              return (
                <article key={week} className={`min-w-0 rounded-2xl border bg-white p-5 ${booking ? 'border-primary-200 shadow-sm shadow-primary-950/5' : 'border-slate-200'}`}>
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-base font-bold text-slate-950">Week {week}</h3>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-bold ${booking ? 'bg-emerald-50 text-emerald-800' : 'bg-slate-100 text-slate-600'}`}>{booking ? 'Booked' : 'To schedule'}</span>
                  </div>

                  {booking && (
                    <div className="mt-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary-600" />
                        <div>
                          <p className="font-semibold leading-snug text-slate-950">{formatGuamMeetingTime(booking.starts_at)}</p>
                          <p className="mt-1 text-sm text-slate-600">60 minutes with {booking.instructor_name}</p>
                        </div>
                      </div>
                      {booking.zoom_url ? (
                        <a href={sanitizeUrl(booking.zoom_url)} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700"><Video className="h-4 w-4" />Join on Zoom<ExternalLink className="h-3.5 w-3.5" /></a>
                      ) : <p className="rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Your Zoom link is being prepared. It will appear here before the meeting.</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {canReschedule && <Button variant="secondary" disabled={busyId !== null} onClick={() => setChangingBookingId(changing ? null : booking.id)}>{changing ? 'Keep current time' : 'Reschedule'}</Button>}
                        {beforeCutoff && <Button variant="quiet" disabled={busyId !== null} onClick={() => void cancelBooking(booking.id)}>Cancel</Button>}
                      </div>
                    </div>
                  )}

                  {(!booking || changing) && (
                    <div className="mt-5">
                      <p className="mb-3 text-sm font-semibold text-slate-700">{changing ? 'Choose a new time' : 'Available times'}</p>
                      {available.length === 0 ? <p className="text-sm leading-relaxed text-slate-600">No times are open for this week yet. Message your instructor if you need help.</p> : (
                        <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                          {available.map((slot) => (
                            <button key={slot.id} type="button" disabled={busyId !== null} onClick={() => void selectSlot(slot, changing ? booking?.id : undefined)} className="flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-left text-sm font-medium text-slate-800 transition hover:border-primary-400 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 disabled:opacity-50">
                              <span>{formatGuamMeetingTime(slot.starts_at)}</span><CalendarDays className="h-4 w-4 shrink-0 text-primary-600" />
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            })}
          </div>
          <p className="text-sm leading-relaxed text-slate-600">Changes close {cohort.reschedule_cutoff_hours} hours before a meeting. You can reschedule or cancel and rebook up to {cohort.max_student_changes} {cohort.max_student_changes === 1 ? 'time' : 'times'}. You can still cancel after using a change, but ask your instructor to arrange another time.</p>
        </section>
      ))}
      <p className="text-sm leading-relaxed text-slate-600">Need a different time? <Link to="/messages" className="font-semibold text-primary-700 underline underline-offset-2">Message your instructor</Link>.</p>
    </div>
  )
}
