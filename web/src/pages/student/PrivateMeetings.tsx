import { useMeetingDestination } from '../../lib/useMeetingDestination'
import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronDown, Clock3, ExternalLink, MessageCircle, RefreshCw, Video, WifiOff } from 'lucide-react'
import { api } from '../../lib/api'
import { cancelConsequence, currentBookingForWeek, formatGuamMeetingTime, isWeekBookingClosed, partitionMeetingWeeks, slotsForWeek } from '../../lib/privateMeetings'
import { sanitizeUrl } from '../../lib/sanitizeUrl'
import { useToast } from '../../contexts/ToastContext'
import { useConfirm } from '../../contexts/ConfirmContext'
import { AnchorButton, Button } from '../../components/ui/Button'
import { TextButton } from '../../components/ui/Choice'
import { Badge } from '../../components/ui/Badge'
import { PageHeader } from '../../components/ui/PageHeader'
import { EmptyState } from '../../components/shared/EmptyState'
import { LoadingSpinner } from '../../components/shared/LoadingSpinner'
import type { PrivateMeetingBooking, PrivateMeetingCohort, PrivateMeetingSlot } from '../../types/api'

export function PrivateMeetings() {
  const toast = useToast()
  const confirm = useConfirm()
  const [cohorts, setCohorts] = useState<PrivateMeetingCohort[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [changingBookingId, setChangingBookingId] = useState<number | null>(null)
  const [choosingInstructor, setChoosingInstructor] = useState(false)
  const [openingMessages, setOpeningMessages] = useState(false)
  const navigate = useNavigate()
  const destination = useMeetingDestination(loading, cohorts)

  const load = useCallback(async () => {
    setError(null)
    const response = await api.getPrivateMeetings()
    if (response.data) setCohorts(response.data.cohorts)
    else setError(response.error || 'Could not load your meetings.')
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // Opens (or creates) the private conversation with the course's meeting
  // instructor instead of dropping the learner on the general inbox.
  async function messageInstructor(target?: PrivateMeetingCohort) {
    if (openingMessages) return
    const candidates = cohorts.filter((entry) => entry.instructor_id && (!destination.cohortId || entry.id === destination.cohortId))
    if (!target && candidates.length > 1) { setChoosingInstructor(true); return }
    const cohort = target ?? candidates[0]
    setChoosingInstructor(false)
    if (!cohort?.instructor_id) {
      navigate('/messages')
      return
    }
    setOpeningMessages(true)
    const response = await api.createDirectConversation({ cohort_id: cohort.id, user_ids: [cohort.instructor_id] })
    setOpeningMessages(false)
    const conversationId = response.data?.direct_conversation?.id
    if (!conversationId) {
      toast.error(`We couldn't open your conversation with ${cohort.instructor_name}. Opening your messages instead.`)
      navigate('/messages')
      return
    }
    navigate(`/messages/dm/${conversationId}`)
  }

  async function selectSlot(slot: PrivateMeetingSlot, bookingId?: number) {
    const approved = await confirm({
      title: bookingId ? 'Move your private meeting?' : 'Book this private meeting?',
      description: `${formatGuamMeetingTime(slot.starts_at)} with ${slot.instructor_name}. ${bookingId ? 'This uses your schedule change for this week.' : 'This reserves the full hour for you.'}`,
      confirmLabel: bookingId ? 'Move meeting' : 'Book meeting',
      cancelLabel: 'Go back',
      icon: 'calendar',
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

  async function cancelBooking(booking: PrivateMeetingBooking, maxChanges: number) {
    const bookingId = booking.id
    const approved = await confirm({
      title: 'Cancel this private meeting?',
      description: `${formatGuamMeetingTime(booking.starts_at)} will be released for someone else.`,
      note: cancelConsequence(booking.week_number, booking.reschedule_count, maxChanges),
      confirmLabel: 'Cancel meeting',
      cancelLabel: 'Keep meeting',
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
        description="Choose one private 60-minute meeting for each course week. All times are Guam time (ChST)."
        actions={<Button variant="secondary" onClick={() => void messageInstructor()} disabled={openingMessages}><MessageCircle className="h-4 w-4" aria-hidden="true" />{openingMessages ? 'Opening…' : 'Message your instructor'}</Button>}
      />

      {choosingInstructor && !destination.cohortId && <div role="group" aria-label="Choose your course instructor" className="flex flex-wrap gap-3">{cohorts.filter((cohort) => cohort.instructor_id).map((cohort) => <Button key={cohort.id} variant="secondary" onClick={() => void messageInstructor(cohort)}>{cohort.name} · {cohort.instructor_name}</Button>)}</div>}
      {destination.cohortId && !cohorts.some((cohort) => cohort.id === destination.cohortId) && <p role="alert" className="text-ink-secondary">This cohort is unavailable for private meetings.</p>}
      {destination.bookingId && !cohorts.some((cohort) => cohort.id === destination.cohortId && cohort.bookings.some((booking) => booking.id === destination.bookingId)) && <p role="alert" className="text-ink-secondary">This booking is no longer available in this cohort.</p>}
      {error && <p role="alert" className="rounded-xl border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">{error}</p>}

      {cohorts.length === 0 ? (
        <EmptyState icon={CalendarDays} title="No private meetings yet" description="When your course is ready for scheduling, its weekly times will appear here." />
      ) : cohorts.filter((cohort) => !destination.cohortId || cohort.id === destination.cohortId).map((cohort) => (
        <section key={cohort.id} aria-labelledby={`meeting-cohort-${cohort.id}`} className="space-y-4">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line pb-4">
            <div className="min-w-0">
              <p className="text-xs font-semibold text-ink-muted">Private coaching</p>
              <h2 id={`meeting-cohort-${cohort.id}`} className="mt-1 text-xl font-bold tracking-tight text-ink [overflow-wrap:anywhere]">{cohort.name}</h2>
              <p className="mt-1 text-sm text-ink-secondary">With {cohort.instructor_name}</p>
            </div>
            <Badge className="tabular-nums">{cohort.weeks} weekly meetings</Badge>
          </div>
          {(() => {
            const { current, past } = partitionMeetingWeeks(cohort.start_date, cohort.weeks)
            const renderWeek = (week: number) => {
              const targetBooking = cohort.bookings.find((item) => item.id === destination.bookingId && item.week_number === week)
              const booking = currentBookingForWeek(cohort.bookings, week)
              const cutoff = cohort.reschedule_cutoff_hours * 60 * 60 * 1000
              const available = slotsForWeek(cohort.slots, cohort.start_date, week, cohort.weeks).filter((slot) => slot.available && Date.parse(slot.starts_at) > Date.now() + cutoff)
              const changing = booking?.id === changingBookingId
              const beforeCutoff = booking && Date.parse(booking.starts_at) > Date.now() + cutoff
              const canReschedule = beforeCutoff && booking.reschedule_count < cohort.max_student_changes
              const canBook = cohort.bookable_week_numbers.includes(week)
              const weekClosed = isWeekBookingClosed(cohort.start_date, week, cohort.reschedule_cutoff_hours)
              const canceled = Boolean(booking && ['canceled', 'cancelled'].includes(booking.status))
              const meetingOver = booking ? canceled || Date.parse(booking.ends_at) <= Date.now() : false
              return (
                <article key={week} id={`meeting-${cohort.id}-${week}`} tabIndex={-1} data-booked={booking ? 'true' : undefined} className={`min-w-0 rounded-2xl border p-5 ${destination.cohortId === cohort.id && destination.week === week ? 'ring-2 ring-ruby-500' : ''} ${booking ? 'border-line bg-surface-raised shadow-raised' : 'border-line bg-surface-raised'}`}>
                  {targetBooking && <p className="mb-3 text-sm font-semibold text-ink-secondary">Booking {targetBooking.id} · {targetBooking.status === 'canceled' ? 'Canceled' : 'From your update'} · {formatGuamMeetingTime(targetBooking.starts_at)}</p>}
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="min-w-0 text-base font-bold text-ink">Week {week}</h3>
                    <Badge tone={booking && !meetingOver ? 'success' : 'neutral'}>{booking ? (canceled ? 'Canceled' : meetingOver ? 'Completed' : 'Booked') : weekClosed ? 'Booking closed' : 'To schedule'}</Badge>
                  </div>

                  {booking && (
                    <div className="mt-5 space-y-3">
                      <div className="flex items-start gap-3">
                        <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-ink-muted" aria-hidden="true" />
                        <div className="min-w-0">
                          <p className="font-semibold leading-snug text-ink tabular-nums">{formatGuamMeetingTime(booking.starts_at)}</p>
                          <p className="mt-1 text-sm text-ink-secondary">60 minutes with {booking.instructor_name}</p>
                        </div>
                      </div>
                      {meetingOver ? null : booking.zoom_url ? (
                        <AnchorButton variant="primary" href={sanitizeUrl(booking.zoom_url)} target="_blank" rel="noopener noreferrer"><Video className="h-4 w-4" aria-hidden="true" />Join on Zoom<ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></AnchorButton>
                      ) : <p className="rounded-xl bg-warning-50 px-3 py-2 text-sm text-warning-800">Your Zoom link is being prepared. It will appear here before the meeting.</p>}
                      <div className="flex flex-wrap gap-2 pt-1">
                        {canReschedule && <Button variant="secondary" disabled={busyId !== null} onClick={() => setChangingBookingId(changing ? null : booking.id)}>{changing ? 'Keep current time' : 'Reschedule'}</Button>}
                        {beforeCutoff && <Button variant="danger" disabled={busyId !== null} onClick={() => void cancelBooking(booking, cohort.max_student_changes)}>Cancel meeting</Button>}
                      </div>
                    </div>
                  )}

                  {(!booking || changing) && (
                    <div className="mt-5">
                      <p className="mb-3 text-sm font-semibold text-ink-secondary tabular-nums">{changing ? 'Choose a new time' : weekClosed ? 'Scheduling help' : canBook ? (available.length > 0 ? `${available.length} ${available.length === 1 ? 'time' : 'times'} available` : 'Available times') : 'Scheduling help'}</p>
                      {weekClosed && !changing ? <p className="text-sm leading-relaxed text-ink-secondary">Booking for Week {week} has closed. <TextButton onClick={() => void messageInstructor(cohort)} disabled={openingMessages}>Message your instructor</TextButton> if you still need a meeting.</p> : !booking && !canBook ? <p className="text-sm leading-relaxed text-ink-secondary">You have used your schedule change for Week {week}. <TextButton onClick={() => void messageInstructor(cohort)} disabled={openingMessages}>Message your instructor</TextButton> to arrange another time.</p> : available.length === 0 ? <p className="text-sm leading-relaxed text-ink-secondary">No times are open for Week {week} yet. <TextButton onClick={() => void messageInstructor(cohort)} disabled={openingMessages}>Message your instructor</TextButton> if you need help.</p> : (
                        <div data-testid="meeting-slot-list" className="space-y-2 lg:max-h-80 lg:overflow-y-auto lg:pr-1">
                          {available.map((slot) => (
                            <button key={slot.id} type="button" disabled={busyId !== null} onClick={() => void selectSlot(slot, changing ? booking?.id : undefined)} className="pressable flex min-h-12 w-full items-center justify-between gap-2 rounded-xl border border-line bg-surface-sunken px-3 py-2 text-left text-sm font-medium text-ink hover:border-slate-400 hover:bg-surface-raised disabled:opacity-50">
                              <span className="min-w-0 tabular-nums">{formatGuamMeetingTime(slot.starts_at)}</span><span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-ink-secondary">Book<CalendarDays className="h-4 w-4 text-ink-muted" aria-hidden="true" /></span>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </article>
              )
            }
            return (
              <>
                {current.length > 0
                  ? <div className="grid gap-4 lg:grid-cols-3">{current.map(renderWeek)}</div>
                  : <p className="text-sm text-ink-secondary">All meeting weeks for this course are over.</p>}
                {past.length > 0 && (
                  <details className="group rounded-2xl border border-line bg-surface-raised" data-testid="past-meeting-weeks">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-2xl px-5 py-3 text-sm font-semibold text-ink-secondary hover:text-ink [&::-webkit-details-marker]:hidden">
                      <span>Past weeks <span className="tabular-nums text-ink-muted">({past.length})</span></span>
                      <ChevronDown className="h-4 w-4 shrink-0 transition-transform duration-[180ms] group-open:rotate-180" aria-hidden="true" />
                    </summary>
                    <div className="grid gap-4 border-t border-line p-4 lg:grid-cols-3">{past.map(renderWeek)}</div>
                  </details>
                )}
              </>
            )
          })()}
          <p className="text-sm leading-relaxed text-ink-secondary">Changes close {cohort.reschedule_cutoff_hours} hours before a meeting. You can reschedule or cancel and rebook up to {cohort.max_student_changes} {cohort.max_student_changes === 1 ? 'time' : 'times'}. You can still cancel after using a change, but ask your instructor to arrange another time.</p>
        </section>
      ))}
      <p className="text-sm leading-relaxed text-ink-secondary">Need a different time? <TextButton onClick={() => void messageInstructor()} disabled={openingMessages}>Message your instructor</TextButton>.</p>
    </div>
  )
}
