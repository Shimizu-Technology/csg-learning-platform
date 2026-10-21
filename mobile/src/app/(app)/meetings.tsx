import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useFocusEffect, useRouter, type Href } from 'expo-router';
import { getNetworkStateAsync, useNetworkState } from 'expo-network';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Linking, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MeetingButton, MeetingCohort, MeetingConfirmation, meetingStyles as styles, type MeetingAction } from '@/components/private-meetings';
import { PrivateMeetingsPreview } from '@/components/private-meetings-preview';
import { ApiError } from '@/lib/api';
import { availableSlotsForWeek, beforeChangeCutoff, canReschedule, currentBookingForWeek, isWeekBookingClosed, type PrivateMeetingCohort, type PrivateMeetingsResponse } from '@/lib/private-meetings';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function MeetingsScreen() {
  const { api, user } = useSession();
  const { demo } = useCsgAuth();
  const router = useRouter();
  const client = useQueryClient();
  const network = useNetworkState();
  const connected = network.isConnected === true && network.isInternetReachable !== false;
  const key = ['learning', user?.id || 0, 'private-meetings'];
  const query = useQuery({ queryKey: key, queryFn: ({ signal }) => api.privateMeetings(signal), enabled: Boolean(user && !user.is_staff && !demo && connected), retry: false });
  const [now, setNow] = useState(() => Date.now());
  const [action, setAction] = useState<MeetingAction | null>(null);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [writeError, setWriteError] = useState<string | null>(null);
  const disabled = !connected || query.isError || query.isPending || query.isFetching || busy;
  const refetch = query.refetch;
  const refresh = useCallback(() => { setNow(Date.now()); if (connected && !lock.current) void refetch(); }, [connected, refetch]);
  useFocusEffect(useCallback(() => { refresh(); }, [refresh]));
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15_000);
    const sub = AppState.addEventListener('change', (state) => { if (state === 'active') refresh(); });
    return () => { clearInterval(timer); sub.remove(); };
  }, [refresh]);

  async function confirm() {
    if (!action || disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setWriteError(null);
    setNotice(null);
    try {
      const state = await getNetworkStateAsync();
      if (!state.isConnected || state.isInternetReachable === false) throw new Error('You are offline. Reconnect before changing your meeting.');
      const cohort = query.data?.cohorts.find((c) => c.id === action.cohort.id);
      const booking = cohort && currentBookingForWeek(cohort.bookings, action.week);
      const time = Date.now();
      if (!cohort || (action.kind === 'cancel' && (!booking || !beforeChangeCutoff(cohort, booking, time))) || (action.kind === 'reschedule' && (!booking || !canReschedule(cohort, booking, time))) || (action.kind === 'book' && (booking || !cohort.bookable_week_numbers.includes(action.week) || isWeekBookingClosed(cohort, action.week, time))) || (action.slot && !availableSlotsForWeek(cohort, action.week, time).some((s) => s.id === action.slot!.id))) {
        throw new Error('This meeting has changed or its booking cutoff has passed. Refresh and choose another time, or message your instructor.');
      }
      const response = action.kind === 'cancel' ? await api.cancelPrivateMeeting(action.booking!.id) : action.kind === 'reschedule' ? await api.reschedulePrivateMeeting(action.booking!.id, action.slot!.id) : await api.bookPrivateMeeting(action.slot!.id);
      // Keep the acknowledged outcome readable even if the following refresh fails.
      client.setQueryData<PrivateMeetingsResponse>(key, (old) => old && ({ cohorts: old.cohorts.map((c) => c.id !== action.cohort.id ? c : { ...c, bookings: [...c.bookings.filter((b) => b.id !== response.booking.id), response.booking] }) }));
      setNotice(action.kind === 'cancel' ? 'Your meeting was cancelled.' : action.kind === 'reschedule' ? 'Your meeting was moved.' : 'Your meeting is booked.');
      setAction(null);
      await query.refetch();
    } catch (error) {
      setAction(null);
      const conflict = error instanceof ApiError && error.status === 409;
      const uncertain = error instanceof ApiError && !error.status;
      setWriteError(conflict ? 'That time is no longer available. Choose another opening after availability refreshes.' : uncertain ? 'We could not confirm the result. Check your refreshed meetings before trying again.' : (error as Error).message || 'Could not save your meeting. Try again.');
      // No automatic write retry: a lost response might already have saved.
      await query.refetch();
    } finally { lock.current = false; setBusy(false); setNow(Date.now()); }
  }

  async function messageInstructor(cohort: PrivateMeetingCohort) {
    if (disabled || lock.current) return;
    lock.current = true;
    setBusy(true);
    setWriteError(null);
    try {
      const response = await api.createCohortDm(cohort.id, [cohort.instructor_id]);
      router.push(`/conversation/dm/${response.direct_conversation.id}` as Href);
    } catch { setWriteError('Could not open your instructor conversation. Reconnect and try again.'); }
    finally { lock.current = false; setBusy(false); }
  }

  return <SafeAreaView edges={['top', 'bottom']} style={styles.safe}>
    <ScrollView contentContainerStyle={styles.content} refreshControl={<RefreshControl refreshing={query.isFetching} onRefresh={refresh} tintColor="#9c292b" />}>
      <View style={styles.header}><MeetingButton onPress={() => router.canGoBack() ? router.back() : router.replace('/')} label="Back to your learning">Back</MeetingButton><Text accessibilityRole="header" style={styles.title}>Meetings</Text><Text style={styles.copy}>Book your weekly private hour.</Text></View>
      {user?.is_staff ? <Text style={styles.copy}>Private meeting booking is for learners. Manage your class meetings on CSG Learn web.</Text> : demo && __DEV__ ? <PrivateMeetingsPreview /> : <>
        {!connected && <Text accessibilityLiveRegion="polite" style={styles.notice}>You are offline. Previously loaded meetings stay readable. Reconnect to book, change a meeting, or open your instructor conversation.</Text>}
        {query.isPending && connected && <View accessibilityRole="progressbar" accessibilityLabel="Loading your meetings"><ActivityIndicator color="#9c292b" /><Text style={styles.copy}>Loading your meetings…</Text></View>}
        {query.isError && <><Text accessibilityRole="alert" style={styles.error}>{query.data ? 'Showing saved meetings. We could not refresh availability. Reconnect and retry before booking or changing a meeting.' : 'Could not load your meetings. Check your connection and try again.'}</Text><MeetingButton onPress={refresh} disabled={!connected || busy || query.isFetching}>Try again</MeetingButton></>}
        {notice && <Text accessibilityLiveRegion="polite" style={styles.notice}>{notice}</Text>}
        {writeError && <Text accessibilityRole="alert" style={styles.error}>{writeError}</Text>}
        {query.data?.cohorts.length === 0 && <Text style={styles.copy}>No private meetings are available for your courses. If you expected weekly meetings, message your instructor from Messages.</Text>}
        {query.data?.cohorts.map((cohort) => <MeetingCohort key={cohort.id} cohort={cohort} now={now} disabled={disabled} joinDisabled={!connected} onSelect={(next) => { if (!lock.current) setAction(next); }} onMessage={() => void messageInstructor(cohort)} onJoin={(url) => void Linking.openURL(url).catch(() => setWriteError('Could not open Zoom. Try again or message your instructor.'))} />)}
      </>}
    </ScrollView>
    <MeetingConfirmation action={action} busy={busy} disabled={disabled} blockedReason={!connected ? "You are offline. Reconnect before confirming." : query.isError ? "Availability could not refresh. Go back and try again." : query.isFetching ? "Refreshing availability…" : undefined} onDismiss={() => setAction(null)} onConfirm={() => void confirm()} />
  </SafeAreaView>;
}
