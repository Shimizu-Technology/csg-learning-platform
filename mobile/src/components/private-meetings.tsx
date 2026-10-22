import { Button } from '@/components/ui/button';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useRef, useState, type PropsWithChildren } from 'react';
import { ActivityIndicator, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CalendarCheck } from 'lucide-react-native';
import { fonts } from '@/constants/csg-theme';
import { formatCourseTimeRange } from '@/lib/course-time';
import { availableSlotsForWeek, beforeChangeCutoff, cancelConsequence, canReschedule, currentBookingForWeek, isWeekBookingClosed, meetingJoinUrl, meetingRebookWarning, partitionMeetingWeeks, type PrivateMeetingBooking, type PrivateMeetingCohort, type PrivateMeetingSlot } from '@/lib/private-meetings';

export type MeetingAction = { kind: 'book' | 'reschedule' | 'cancel'; cohort: PrivateMeetingCohort; week: number; slot?: PrivateMeetingSlot; booking?: PrivateMeetingBooking };

export function MeetingButton({ children, onPress, disabled = false, danger = false, primary = false, label, testID, expanded }: PropsWithChildren<{ onPress: () => void; disabled?: boolean; danger?: boolean; primary?: boolean; label?: string; testID?: string; expanded?: boolean }>) {
  return <Button onPress={onPress} disabled={disabled} variant={danger ? 'danger' : primary ? 'primary' : 'secondary'} accessibilityLabel={label} testID={testID} accessibilityState={{ ...(expanded === undefined ? {} : { expanded }) }}>{children}</Button>;
}

export function MeetingCohort({ cohort, targetBookingId, targetWeek, onTargetLayout, now, disabled, joinDisabled = false, onSelect, onMessage, onJoin }: { cohort: PrivateMeetingCohort; targetBookingId?: number | null; targetWeek?: number | null; onTargetLayout?: (node: { measureLayout: View['measureLayout'] }) => void; now: number; disabled: boolean; joinDisabled?: boolean; onSelect: (action: MeetingAction) => void; onMessage: () => void; onJoin: (url: string) => void }) {
  const { colors: c } = useTheme();
  const styles = useStyles();
  const targetRef = useRef<View>(null);
  const targetBooking = cohort.bookings.find((item) => item.id === targetBookingId);
  const focusWeek = targetBookingId ? targetBooking?.week_number : targetWeek;
  const [showPast, setShowPast] = useState(Boolean(focusWeek));
  const [changing, setChanging] = useState<number | null>(null);
  const weeks = partitionMeetingWeeks(cohort.start_date, cohort.weeks, now);
  return <View style={styles.stack}>
    {targetBookingId && !targetBooking && <Text accessibilityRole="alert" style={styles.warning}>This booking is no longer available in this cohort. Any meetings shown below are your current bookings.</Text>}
    <Text accessibilityRole="header" style={styles.cohortTitle}>{cohort.name}</Text>
    <Text style={styles.copy}>One private 60-minute Zoom hour per course week with {cohort.instructor_name}. All times are Guam time (ChST).</Text>
    <Text style={styles.copy}>Changes close {cohort.reschedule_cutoff_hours} hours before your meeting. You can change your time {cohort.max_student_changes === 1 ? 'once per week' : `up to ${cohort.max_student_changes} times per week`}.</Text>
    {weeks.current.length === 0 && <Text style={styles.copy}>All meeting weeks for this course are over.</Text>}
    {weeks.current.map(renderWeek)}
    {weeks.past.length > 0 && <><MeetingButton onPress={() => setShowPast(!showPast)} expanded={showPast} testID={`past-weeks-${cohort.id}`}>{showPast ? 'Hide past weeks' : 'Past weeks'} ({weeks.past.length})</MeetingButton>{showPast && weeks.past.map(renderWeek)}</>}
    <MeetingButton onPress={onMessage} disabled={disabled} label={`Message your instructor for ${cohort.name}`}>Message your instructor</MeetingButton>
  </View>;

  function renderWeek(week: number) {
    const targetBooking = cohort.bookings.find((item) => item.id === targetBookingId && item.week_number === week);
    const booking = currentBookingForWeek(cohort.bookings, week);
    const canceled = Boolean(booking && ['canceled', 'cancelled'].includes(booking.status));
    const completed = canceled || Boolean(booking && Date.parse(booking.ends_at) <= now);
    const closed = isWeekBookingClosed(cohort, week, now);
    const slots = availableSlotsForWeek(cohort, week, now);
    const canBook = cohort.bookable_week_numbers.includes(week);
    const isChanging = Boolean(booking && changing === booking.id && canReschedule(cohort, booking, now));
    const status = booking ? canceled ? 'Canceled' : completed ? 'Completed' : 'Booked' : closed ? 'Booking closed' : 'To schedule';
    const join = booking && !completed ? meetingJoinUrl(booking, now) : null;
    return <View key={week} ref={focusWeek === week ? targetRef : undefined} onLayout={() => { if (focusWeek === week && targetRef.current) onTargetLayout?.(targetRef.current); }} style={[styles.card, focusWeek === week && { borderWidth: 2, borderColor: c.action.primary }]} testID={`meeting-week-${cohort.id}-${week}`}>
      <Text accessibilityRole="header" style={styles.weekTitle}>Week {week}</Text>{focusWeek === week && <Text style={styles.info}>Meeting from your update{targetBooking ? ` · Booking ${targetBooking.id}` : ''}</Text>}{targetBooking?.status === 'canceled' && <Text style={styles.info}>Canceled · {formatCourseTimeRange(targetBooking.starts_at, targetBooking.ends_at)}</Text>}
      <View style={[styles.badge, booking && !completed ? styles.success : styles.pending]}><Text style={[styles.badgeText, booking && !completed ? styles.successText : styles.pendingText]}>{status}</Text></View>
      {booking && <View style={styles.stack}>
        <View style={styles.timeRow}><CalendarCheck size={20} color={c.text.body} /><Text style={styles.time}>{formatCourseTimeRange(booking.starts_at, booking.ends_at)}</Text></View>
        <Text style={styles.copy}>60 minutes with {booking.instructor_name}</Text>
        {join ? <MeetingButton primary disabled={joinDisabled} onPress={() => onJoin(join)} label={`Join Week ${week} meeting on Zoom`}>Join on Zoom</MeetingButton> : !completed && <Text style={styles.info}>{booking.zoom_url ? 'Join opens 15 minutes before your meeting.' : 'Your Zoom link is being prepared. It will appear here before your meeting.'}</Text>}
        {!completed && <>
          {canReschedule(cohort, booking, now) ? <MeetingButton disabled={disabled} onPress={() => setChanging(isChanging ? null : booking.id)} label={`${isChanging ? 'Keep current time' : 'Reschedule'} Week ${week} meeting`} testID={`reschedule-week-${week}`}>{isChanging ? 'Keep current time' : 'Reschedule'}</MeetingButton> : <Text style={styles.copy}>{beforeChangeCutoff(cohort, booking, now) ? 'You have used your schedule change this week.' : 'Changes for this meeting have closed.'} Message your instructor if you need help.</Text>}
          {beforeChangeCutoff(cohort, booking, now) && <MeetingButton danger disabled={disabled} onPress={() => onSelect({ kind: 'cancel', cohort, week, booking })} label={`Cancel Week ${week} meeting`} testID={`cancel-week-${week}`}>Cancel meeting</MeetingButton>}
        </>}
      </View>}
      {(!booking || isChanging) && <View style={styles.stack}>
        {closed ? <Text style={styles.copy}>Booking for Week {week} has closed — message your instructor.</Text> : !booking && !canBook ? <Text style={styles.warning}>You have used your schedule change for Week {week}. Message your instructor to arrange another time.</Text> : <>
          <Text style={styles.subheading}>{isChanging ? 'Choose a new time' : 'Available openings'}</Text>
          {slots.length === 0 ? <Text style={styles.copy}>No openings are available for Week {week} yet. Message your instructor if you need help.</Text> : slots.map((slot, index) => <MeetingButton key={slot.id} disabled={disabled} label={`Choose Week ${week}, ${formatCourseTimeRange(slot.starts_at, slot.ends_at)}`} testID={`meeting-slot-${week}-${index}`} onPress={() => onSelect({ kind: isChanging ? 'reschedule' : 'book', cohort, week, slot, booking })}>{formatCourseTimeRange(slot.starts_at, slot.ends_at)}</MeetingButton>)}
        </>}
      </View>}
      {((!booking && (closed || !canBook || slots.length === 0)) || (booking && !completed && !canReschedule(cohort, booking, now))) && <MeetingButton disabled={disabled} onPress={onMessage} label={`Message your instructor about Week ${week}`}>Message your instructor</MeetingButton>}
    </View>;
  }
}

export function MeetingConfirmation({ action, busy, disabled, blockedReason, onDismiss, onConfirm }: { action: MeetingAction | null; busy: boolean; disabled: boolean; blockedReason?: string; onDismiss: () => void; onConfirm: () => void }) {
  const { colors: c } = useTheme();
  const styles = useStyles();
  if (!action) return null;
  const cancelling = action.kind === 'cancel';
  const title = cancelling ? 'Cancel this meeting?' : action.kind === 'reschedule' ? 'Move your private meeting?' : 'Book your private hour?';
  const meeting = action.slot || action.booking!;
  return <Modal visible transparent animationType="fade" onRequestClose={() => { if (!busy) onDismiss(); }}>
    <View style={styles.overlay}><View style={styles.sheet} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={styles.stack}>
        <Text accessibilityRole="header" style={styles.cohortTitle}>{title}</Text>
        <Text style={styles.time}>Week {action.week} · {formatCourseTimeRange(meeting.starts_at, meeting.ends_at)}</Text>
        <Text style={styles.copy}>60 minutes with {meeting.instructor_name}</Text>
        <Text style={cancelling ? styles.warning : styles.copy}>{cancelling ? cancelConsequence(action.week, action.booking!.reschedule_count, action.cohort.max_student_changes) : action.kind === 'reschedule' ? `This uses ${action.cohort.max_student_changes - action.booking!.reschedule_count === 1 ? 'your only remaining schedule change' : 'one schedule change'} for Week ${action.week}. Your current time stays booked until the new time is confirmed.` : meetingRebookWarning(action.cohort, action.week) || 'This reserves the full hour for you.'}</Text>
        {cancelling && <Text style={styles.copy}>Your time will be released for someone else.</Text>}
        {blockedReason && !busy && <Text accessibilityLiveRegion="polite" style={styles.info}>{blockedReason}</Text>}
        {busy && <View accessibilityRole="progressbar" accessibilityLabel="Saving meeting" style={styles.timeRow}><ActivityIndicator color={c.action.primary} /><Text style={styles.copy}>Saving your meeting…</Text></View>}
        <MeetingButton disabled={busy} onPress={onDismiss} testID="meeting-confirm-dismiss">{cancelling ? 'Keep meeting' : 'Go back'}</MeetingButton>
        <MeetingButton primary={!cancelling} danger={cancelling} disabled={busy || disabled} onPress={onConfirm} testID="meeting-confirm-submit">{cancelling ? 'Cancel meeting' : action.kind === 'reschedule' ? 'Move meeting' : 'Book meeting'}</MeetingButton>
      </ScrollView>
    </View></View>
  </Modal>;
}

export const useMeetingStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page },
  content: { padding: 20, gap: 20, paddingBottom: 44 },
  header: { gap: 12 },
  title: { color: c.text.strong, fontSize: 28, fontFamily: fonts.extraBold },
  copy: { color: c.text.body, fontSize: 16, lineHeight: 24, fontFamily: fonts.regular },
  notice: { color: c.status.info.fg, backgroundColor: c.status.info.bg, padding: 14, borderRadius: 12, fontSize: 16, lineHeight: 24 },
  error: { color: c.status.danger.fg, backgroundColor: c.status.danger.bg, padding: 14, borderRadius: 12, fontSize: 16, lineHeight: 24 },
}));
const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  stack: { gap: 14 },
  cohortTitle: { color: c.text.strong, fontSize: 22, fontFamily: fonts.bold },
  copy: { color: c.text.body, fontSize: 16, lineHeight: 24, fontFamily: fonts.regular },
  card: { gap: 14, padding: 18, borderRadius: 16, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.strong },
  weekTitle: { color: c.text.strong, fontSize: 20, fontFamily: fonts.bold },
  subheading: { color: c.text.strong, fontSize: 16, fontFamily: fonts.semibold },
  badge: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  badgeText: { fontSize: 14, fontFamily: fonts.semibold },
  pending: { backgroundColor: c.status.pending.bg }, pendingText: { color: c.status.pending.fg },
  success: { backgroundColor: c.status.success.bg }, successText: { color: c.status.success.fg },
  timeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  time: { flexShrink: 1, color: c.text.strong, fontSize: 17, lineHeight: 26, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  button: { minHeight: 48, minWidth: 44, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.status.pending.bg, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, textAlign: 'center', flexShrink: 1 },
  primary: { backgroundColor: c.action.primary, borderColor: c.action.primary }, primaryText: { color: c.text.onAction },
  danger: { backgroundColor: c.status.danger.bg, borderColor: c.status.danger.border }, dangerText: { color: c.status.danger.fg },
  disabled: { opacity: .5 },
  warning: { color: c.status.warning.fg, backgroundColor: c.status.warning.bg, borderRadius: 12, padding: 12, fontSize: 16, lineHeight: 24 },
  info: { color: c.status.info.fg, backgroundColor: c.status.info.bg, borderRadius: 12, padding: 12, fontSize: 16, lineHeight: 24 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: c.overlay },
  sheet: { maxHeight: '90%', backgroundColor: c.surface.raised, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 44 },
}));
