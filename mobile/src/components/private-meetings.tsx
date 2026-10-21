import { useEffect, useRef, useState, type PropsWithChildren } from 'react';
import { AccessibilityInfo, ActivityIndicator, Animated, Easing, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { CalendarCheck, ChevronDown, ChevronUp, Video } from 'lucide-react-native';
import { fonts } from '@/constants/csg-theme';
import { formatCourseTimeRange } from '@/lib/course-time';
import { availableSlotsForWeek, beforeChangeCutoff, cancelConsequence, canReschedule, currentBookingForWeek, isWeekBookingClosed, meetingJoinUrl, meetingRebookWarning, partitionMeetingWeeks, type PrivateMeetingBooking, type PrivateMeetingCohort, type PrivateMeetingSlot } from '@/lib/private-meetings';

const tokens = { ink: '#0f172a', muted: '#475569', surface: '#ffffff', background: '#f8fafc', line: '#cbd5e1', ruby: '#9c292b', danger: '#b91c1c', dangerBg: '#fef2f2', success: '#15803d', successBg: '#f0fdf4', warning: '#92400e', warningBg: '#fffbeb', pending: '#334155', pendingBg: '#f1f5f9', info: '#075985', infoBg: '#f0f9ff' };
export type MeetingAction = { kind: 'book' | 'reschedule' | 'cancel'; cohort: PrivateMeetingCohort; week: number; slot?: PrivateMeetingSlot; booking?: PrivateMeetingBooking };

export function MeetingButton({ children, onPress, disabled = false, danger = false, primary = false, label, testID, expanded }: PropsWithChildren<{ onPress: () => void; disabled?: boolean; danger?: boolean; primary?: boolean; label?: string; testID?: string; expanded?: boolean }>) {
  const [scale] = useState(() => new Animated.Value(1));
  const reduced = useRef(true);
  useEffect(() => {
    let active = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => { if (active) reduced.current = value; });
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', (value) => { reduced.current = value; scale.setValue(1); });
    return () => { active = false; sub.remove(); };
  }, [scale]);
  const animate = (value: number) => { Animated.timing(scale, { toValue: reduced.current ? 1 : value, duration: 120, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start(); };
  return <Animated.View style={{ transform: [{ scale }] }}><Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, ...(expanded === undefined ? {} : { expanded }) }} disabled={disabled} onPress={onPress} onPressIn={() => animate(.97)} onPressOut={() => animate(1)} testID={testID} style={[styles.button, primary && styles.primary, danger && styles.danger, disabled && styles.disabled]}><Text style={[styles.buttonText, primary && styles.primaryText, danger && styles.dangerText]}>{children}</Text></Pressable></Animated.View>;
}

export function MeetingCohort({ cohort, now, disabled, onSelect, onMessage, onJoin }: { cohort: PrivateMeetingCohort; now: number; disabled: boolean; onSelect: (action: MeetingAction) => void; onMessage: () => void; onJoin: (url: string) => void }) {
  const [showPast, setShowPast] = useState(false);
  const [changing, setChanging] = useState<number | null>(null);
  const weeks = partitionMeetingWeeks(cohort.start_date, cohort.weeks, now);
  return <View style={styles.stack}>
    <Text accessibilityRole="header" style={styles.cohortTitle}>{cohort.name}</Text>
    <Text style={styles.copy}>One private 60-minute Zoom hour per course week with {cohort.instructor_name}. All times are Guam time (ChST).</Text>
    <Text style={styles.copy}>Changes close {cohort.reschedule_cutoff_hours} hours before your meeting. You can change your time {cohort.max_student_changes === 1 ? 'once per week' : `up to ${cohort.max_student_changes} times per week`}.</Text>
    {weeks.current.length === 0 && <Text style={styles.copy}>All meeting weeks for this course are over.</Text>}
    {weeks.current.map(renderWeek)}
    {weeks.past.length > 0 && <><MeetingButton onPress={() => setShowPast(!showPast)} expanded={showPast} testID={`past-weeks-${cohort.id}`}>Past weeks ({weeks.past.length}) {showPast ? <ChevronUp size={14} color={tokens.pending} /> : <ChevronDown size={14} color={tokens.pending} />}</MeetingButton>{showPast && weeks.past.map(renderWeek)}</>}
    <MeetingButton onPress={onMessage} disabled={disabled} label={`Message your instructor for ${cohort.name}`}>Message your instructor</MeetingButton>
  </View>;

  function renderWeek(week: number) {
    const booking = currentBookingForWeek(cohort.bookings, week);
    const completed = Boolean(booking && Date.parse(booking.ends_at) <= now);
    const closed = isWeekBookingClosed(cohort, week, now);
    const slots = availableSlotsForWeek(cohort, week, now);
    const canBook = cohort.bookable_week_numbers.includes(week);
    const isChanging = Boolean(booking && changing === booking.id && canReschedule(cohort, booking, now));
    const status = booking ? completed ? 'Completed' : 'Booked' : closed ? 'Booking closed' : 'To schedule';
    const join = booking && !completed ? meetingJoinUrl(booking, now) : null;
    return <View key={week} style={styles.card} testID={`meeting-week-${cohort.id}-${week}`}>
      <Text accessibilityRole="header" style={styles.weekTitle}>Week {week}</Text>
      <View style={[styles.badge, booking && !completed ? styles.success : styles.pending]}><Text style={[styles.badgeText, booking && !completed ? styles.successText : styles.pendingText]}>{status}</Text></View>
      {booking && <View style={styles.stack}>
        <View style={styles.timeRow}><CalendarCheck size={20} color={tokens.muted} /><Text style={styles.time}>{formatCourseTimeRange(booking.starts_at, booking.ends_at)}</Text></View>
        <Text style={styles.copy}>60 minutes with {booking.instructor_name}</Text>
        {join ? <MeetingButton primary disabled={disabled} onPress={() => onJoin(join)} label={`Join Week ${week} meeting on Zoom`}><Video size={16} color="white" /> Join on Zoom</MeetingButton> : !completed && <Text style={styles.info}>{booking.zoom_url ? 'Join opens 15 minutes before your meeting.' : 'Your Zoom link is being prepared. It will appear here before your meeting.'}</Text>}
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
    </View>;
  }
}

export function MeetingConfirmation({ action, busy, disabled, onDismiss, onConfirm }: { action: MeetingAction | null; busy: boolean; disabled: boolean; onDismiss: () => void; onConfirm: () => void }) {
  if (!action) return null;
  const cancelling = action.kind === 'cancel';
  const title = cancelling ? 'Cancel this meeting?' : action.kind === 'reschedule' ? 'Move your private meeting?' : 'Book your private hour?';
  const meeting = action.slot || action.booking!;
  return <Modal visible transparent animationType="none" onRequestClose={() => { if (!busy) onDismiss(); }}>
    <View style={styles.overlay}><View style={styles.sheet} accessibilityViewIsModal>
      <ScrollView contentContainerStyle={styles.stack}>
        <Text accessibilityRole="header" style={styles.cohortTitle}>{title}</Text>
        <Text style={styles.time}>Week {action.week} · {formatCourseTimeRange(meeting.starts_at, meeting.ends_at)}</Text>
        <Text style={styles.copy}>60 minutes with {meeting.instructor_name}</Text>
        <Text style={cancelling ? styles.warning : styles.copy}>{cancelling ? cancelConsequence(action.week, action.booking!.reschedule_count, action.cohort.max_student_changes) : action.kind === 'reschedule' ? `This uses ${action.cohort.max_student_changes - action.booking!.reschedule_count === 1 ? 'your only remaining schedule change' : 'one schedule change'} for Week ${action.week}. Your current time stays booked until the new time is confirmed.` : meetingRebookWarning(action.cohort, action.week) || 'This reserves the full hour for you.'}</Text>
        {cancelling && <Text style={styles.copy}>Your time will be released for someone else.</Text>}
        {busy && <View accessibilityRole="progressbar" accessibilityLabel="Saving meeting" style={styles.timeRow}><ActivityIndicator color={tokens.ruby} /><Text style={styles.copy}>Saving your meeting…</Text></View>}
        <MeetingButton disabled={busy} onPress={onDismiss} testID="meeting-confirm-dismiss">{cancelling ? 'Keep meeting' : 'Go back'}</MeetingButton>
        <MeetingButton primary={!cancelling} danger={cancelling} disabled={busy || disabled} onPress={onConfirm} testID="meeting-confirm-submit">{cancelling ? 'Cancel meeting' : action.kind === 'reschedule' ? 'Move meeting' : 'Book meeting'}</MeetingButton>
      </ScrollView>
    </View></View>
  </Modal>;
}

export const meetingStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: tokens.background },
  content: { padding: 20, gap: 20, paddingBottom: 44 },
  header: { gap: 12 },
  title: { color: tokens.ink, fontSize: 28, fontFamily: fonts.extraBold },
  copy: { color: tokens.muted, fontSize: 16, lineHeight: 24, fontFamily: fonts.regular },
  notice: { color: tokens.info, backgroundColor: tokens.infoBg, padding: 14, borderRadius: 12, fontSize: 16, lineHeight: 24 },
  error: { color: tokens.danger, backgroundColor: tokens.dangerBg, padding: 14, borderRadius: 12, fontSize: 16, lineHeight: 24 },
});
const styles = StyleSheet.create({
  stack: { gap: 14 },
  cohortTitle: { color: tokens.ink, fontSize: 22, fontFamily: fonts.bold },
  copy: meetingStyles.copy,
  card: { gap: 14, padding: 18, borderRadius: 16, backgroundColor: tokens.surface, borderWidth: 1, borderColor: tokens.line },
  weekTitle: { color: tokens.ink, fontSize: 20, fontFamily: fonts.bold },
  subheading: { color: tokens.ink, fontSize: 16, fontFamily: fonts.semibold },
  badge: { alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 8 },
  badgeText: { fontSize: 14, fontFamily: fonts.semibold },
  pending: { backgroundColor: tokens.pendingBg }, pendingText: { color: tokens.pending },
  success: { backgroundColor: tokens.successBg }, successText: { color: tokens.success },
  timeRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  time: { flexShrink: 1, color: tokens.ink, fontSize: 17, lineHeight: 26, fontFamily: fonts.semibold, fontVariant: ['tabular-nums'] },
  button: { minHeight: 48, minWidth: 44, paddingHorizontal: 14, paddingVertical: 12, borderRadius: 12, borderWidth: 1, borderColor: tokens.line, backgroundColor: tokens.pendingBg, justifyContent: 'center', alignItems: 'center' },
  buttonText: { color: tokens.ink, fontFamily: fonts.bold, fontSize: 16, lineHeight: 24, textAlign: 'center', flexShrink: 1 },
  primary: { backgroundColor: tokens.ruby, borderColor: tokens.ruby }, primaryText: { color: '#fff' },
  danger: { backgroundColor: tokens.dangerBg, borderColor: '#fecaca' }, dangerText: { color: tokens.danger },
  disabled: { opacity: .5 },
  warning: { color: tokens.warning, backgroundColor: tokens.warningBg, borderRadius: 12, padding: 12, fontSize: 16, lineHeight: 24 },
  info: { color: tokens.info, backgroundColor: tokens.infoBg, borderRadius: 12, padding: 12, fontSize: 16, lineHeight: 24 },
  overlay: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(15,23,42,0.5)' },
  sheet: { maxHeight: '90%', backgroundColor: tokens.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingHorizontal: 24, paddingTop: 24, paddingBottom: 44 },
});
