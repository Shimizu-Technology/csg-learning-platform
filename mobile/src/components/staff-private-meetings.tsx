import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getNetworkStateAsync } from 'expo-network';
import { useRouter, type Href } from 'expo-router';
import { Calendar, ExternalLink, Link2, MessageSquare, Video, XCircle } from 'lucide-react-native';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, StyleSheet, Text, TextInput, View } from 'react-native';

import { MeetingButton } from '@/components/private-meetings';
import { BottomSheet } from '@/components/ui/bottom-sheet';
import { Button } from '@/components/ui/button';
import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { fonts } from '@/constants/csg-theme';
import { themedAlert as Alert } from '@/lib/alerts';
import type { components } from '@/lib/api.generated';
import { formatCourseDateTime } from '@/lib/course-time';
import { haptic } from '@/lib/haptics';
import { safeExternalUrl } from '@/lib/learning';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useSession } from '@/providers/session-provider';

type StaffMeetingBooking = components['schemas']['StaffPrivateMeetingBooking'];
type StaffMeetingCohort = components['schemas']['StaffPrivateMeetingCohort'];

export interface StaffPrivateMeetingsProps {
  cohortId: number | null;
  targetBookingId: number | null;
  targetWeek: number | null;
  connected: boolean;
  busy: boolean;
  onOpenWeb: () => void;
  writeError: string | null;
}

export function StaffPrivateMeetings({
  cohortId,
  targetBookingId,
  targetWeek,
  connected,
  busy,
  onOpenWeb,
  writeError,
}: StaffPrivateMeetingsProps) {
  const styles = useStyles();
  const { colors: c, scheme } = useTheme();
  const { api, user } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();

  const queryKey = ['staff', user?.id || 0, 'private-meetings', cohortId ?? 'all'] as const;
  const query = useQuery({
    queryKey,
    queryFn: ({ signal }) => api.staffPrivateMeetings(cohortId ? { cohort_id: cohortId } : undefined, signal),
    enabled: Boolean(user?.is_staff && connected && typeof api.staffPrivateMeetings === 'function'),
    retry: false,
  });

  const [editingBooking, setEditingBooking] = useState<StaffMeetingBooking | null>(null);
  const [zoomDraft, setZoomDraft] = useState('');
  const [messagingId, setMessagingId] = useState<number | null>(null);
  const [openingEditorId, setOpeningEditorId] = useState<number | null>(null);
  const [savingZoom, setSavingZoom] = useState(false);
  const [cancelingId, setCancelingId] = useState<number | null>(null);

  const mountedRef = useRef(true);
  const openingEditorRef = useRef(false);
  const savingZoomRef = useRef(false);
  const cancelingRef = useRef(false);
  const messagingRef = useRef(false);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const updateMutation = useMutation({
    mutationFn: ({ bookingId, input }: { bookingId: number; input: { zoom_url?: string | null; status?: 'canceled' } }) =>
      api.updateStaffPrivateMeeting(bookingId, input),
    onSuccess: (result) => {
      haptic('success');
      queryClient.setQueryData<components['schemas']['StaffPrivateMeetingsResponse']>(queryKey, (current) => {
        if (!current) return current;
        return {
          ...current,
          cohorts: current.cohorts.map((cohort) => ({
            ...cohort,
            bookings: cohort.bookings.map((booking) => (booking.id === result.booking.id ? result.booking : booking)),
          })),
        };
      });
      setEditingBooking(null);
      void query.refetch();
    },
    onError: (error) => {
      haptic('error');
      Alert.alert('Could not update meeting', (error as Error).message || 'Try again.');
    },
  });

  const ensureOnline = async (): Promise<boolean> => {
    if (!connected) {
      Alert.alert('You are offline', 'Reconnect before updating or messaging about a meeting.');
      return false;
    }
    try {
      if (typeof getNetworkStateAsync === 'function') {
        const state = await getNetworkStateAsync();
        if (!state.isConnected || state.isInternetReachable === false) {
          Alert.alert('You are offline', 'Reconnect before updating or messaging about a meeting.');
          return false;
        }
      }
    } catch {
      // Proceed if native network probe is unavailable; server request handles failure.
    }
    return true;
  };

  const sheetBusy = savingZoom || updateMutation.isPending;
  const actionBusy = !connected || sheetBusy || cancelingId !== null || openingEditorId !== null;

  const openZoomEditor = async (booking: StaffMeetingBooking) => {
    if (openingEditorRef.current || savingZoomRef.current || cancelingRef.current || updateMutation.isPending) return;
    openingEditorRef.current = true;
    setOpeningEditorId(booking.id);
    try {
      if (!(await ensureOnline()) || !mountedRef.current) return;
      setEditingBooking(booking);
      setZoomDraft(booking.zoom_url || '');
    } finally {
      openingEditorRef.current = false;
      if (mountedRef.current) setOpeningEditorId(null);
    }
  };

  const saveZoom = async () => {
    const booking = editingBooking;
    if (!booking || savingZoomRef.current || updateMutation.isPending) return;
    const trimmed = zoomDraft.trim();
    if (trimmed && !safeExternalUrl(trimmed)) {
      Alert.alert('Invalid link', 'Enter an https:// meeting URL, or leave it blank to clear the link.');
      return;
    }
    savingZoomRef.current = true;
    setSavingZoom(true);
    try {
      if (!(await ensureOnline()) || !mountedRef.current) return;
      await updateMutation.mutateAsync({ bookingId: booking.id, input: { zoom_url: trimmed || null } });
    } catch {
      // Alert is handled by updateMutation.onError.
    } finally {
      savingZoomRef.current = false;
      if (mountedRef.current) setSavingZoom(false);
    }
  };

  const confirmCancel = (booking: StaffMeetingBooking) => {
    if (!connected || cancelingRef.current || savingZoomRef.current || updateMutation.isPending) return;
    Alert.alert(
      `Cancel meeting with ${booking.student_name}?`,
      'The learner will be notified and their slot will be released.',
      [
        { text: 'Keep meeting', style: 'cancel' },
        {
          text: 'Cancel meeting',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              if (cancelingRef.current || savingZoomRef.current || updateMutation.isPending) return;
              cancelingRef.current = true;
              setCancelingId(booking.id);
              try {
                if (!(await ensureOnline()) || !mountedRef.current) return;
                haptic('destructive');
                await updateMutation.mutateAsync({ bookingId: booking.id, input: { status: 'canceled' } });
              } catch {
                // Alert is handled by updateMutation.onError.
              } finally {
                cancelingRef.current = false;
                if (mountedRef.current) setCancelingId(null);
              }
            })();
          },
        },
      ],
    );
  };

  const messageStudent = async (booking: StaffMeetingBooking) => {
    if (messagingRef.current) return;
    messagingRef.current = true;
    setMessagingId(booking.id);
    try {
      if (!(await ensureOnline()) || !mountedRef.current) return;
      const response = await api.createCohortDm(booking.cohort_id, [booking.student_id]);
      if (!mountedRef.current) return;
      router.push(`/conversation/dm/${response.direct_conversation.id}` as Href);
    } catch (error) {
      if (mountedRef.current) {
        Alert.alert('Could not open conversation', (error as Error).message || 'Try again.');
      }
    } finally {
      messagingRef.current = false;
      if (mountedRef.current) setMessagingId(null);
    }
  };

  const cohorts = query.data?.cohorts ?? [];
  const otherCohorts = query.data?.other_cohorts ?? [];
  const adminContacts = query.data?.admin_contacts ?? [];

  return (
    <View style={styles.root}>
      {targetBookingId && targetWeek ? (
        <Text style={styles.notice}>Your meeting update · Week {targetWeek}</Text>
      ) : null}

      {!connected ? (
        <Text accessibilityLiveRegion="polite" style={styles.notice}>
          You are offline. Reconnect to view or update student meetings.
        </Text>
      ) : null}

      {query.isPending && connected && typeof api.staffPrivateMeetings === 'function' ? (
        <View style={styles.loading} accessibilityRole="progressbar" accessibilityLabel="Loading staff meetings">
          <ActivityIndicator color={c.action.primary} />
          <Text style={styles.copy}>Loading meetings…</Text>
        </View>
      ) : null}

      {query.isError ? (
        <View style={styles.card}>
          <Text accessibilityRole="alert" style={styles.error}>
            {(query.error as Error).message || 'Could not load meetings.'}
          </Text>
          <Button variant="secondary" label="Try again" onPress={() => void query.refetch()} />
        </View>
      ) : null}

      {cohorts.map((cohort) => (
        <StaffCohortSection
          key={cohort.id}
          cohort={cohort}
          targetBookingId={targetBookingId}
          connected={connected}
          busy={actionBusy}
          messagingId={messagingId}
          onEditZoom={(booking) => void openZoomEditor(booking)}
          onCancel={confirmCancel}
          onMessage={(booking) => void messageStudent(booking)}
        />
      ))}

      {query.isSuccess && cohorts.length === 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>No hosted meetings yet</Text>
          <Text style={styles.copy}>
            {otherCohorts.length > 0
              ? 'Another instructor currently hosts weekly meetings for your courses.'
              : 'Set up weekly meeting slots on web to let learners book 1:1 hours.'}
          </Text>
          {otherCohorts.map((item) => (
            <Text key={item.id} style={styles.meta}>
              {item.name} · {item.host ? `Hosted by ${item.host.full_name}` : 'No host assigned'}
            </Text>
          ))}
          {adminContacts.length > 0 ? (
            <Text style={styles.meta}>
              Ask an admin to adjust hosts: {adminContacts.map((admin) => admin.full_name).join(', ')}
            </Text>
          ) : null}
        </View>
      ) : null}

      <View style={styles.webRow}>
        <Text style={styles.meta}>Need to add or delete weekly time slots?</Text>
        <MeetingButton disabled={busy} onPress={onOpenWeb}>
          Manage on web
        </MeetingButton>
      </View>

      {writeError ? (
        <Text accessibilityRole="alert" style={styles.error}>
          {writeError}
        </Text>
      ) : null}

      <BottomSheet
        visible={Boolean(editingBooking)}
        title="Meeting link"
        subtitle={editingBooking ? `${editingBooking.student_name} · Week ${editingBooking.week_number}` : undefined}
        onClose={() => {
          if (!sheetBusy) setEditingBooking(null);
        }}
      >
        <View style={styles.sheetBody}>
          <Text style={styles.fieldLabel}>ZOOM OR MEETING URL</Text>
          <TextInput
            keyboardAppearance={scheme}
            accessibilityLabel="Meeting URL"
            editable={!sheetBusy}
            value={zoomDraft}
            onChangeText={setZoomDraft}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            placeholder="https://zoom.us/j/..."
            placeholderTextColor={c.text.muted}
            style={styles.input}
          />
          <View style={styles.sheetActions}>
            <Button
              variant="secondary"
              label="Cancel"
              disabled={sheetBusy}
              onPress={() => setEditingBooking(null)}
              style={styles.sheetButton}
            />
            <Button
              variant="primary"
              label={sheetBusy ? 'Saving…' : 'Save link'}
              disabled={!connected || sheetBusy}
              onPress={() => void saveZoom()}
              style={styles.sheetButton}
            />
          </View>
        </View>
      </BottomSheet>
    </View>
  );
}

function StaffCohortSection({
  cohort,
  targetBookingId,
  connected,
  busy,
  messagingId,
  onEditZoom,
  onCancel,
  onMessage,
}: {
  cohort: StaffMeetingCohort;
  targetBookingId: number | null;
  connected: boolean;
  busy: boolean;
  messagingId: number | null;
  onEditZoom: (booking: StaffMeetingBooking) => void;
  onCancel: (booking: StaffMeetingBooking) => void;
  onMessage: (booking: StaffMeetingBooking) => void;
}) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const openSlots = cohort.slots.filter((slot) => slot.available).length;
  const activeBookings = cohort.bookings.filter((b) => !['canceled', 'cancelled'].includes(b.status));
  const canceledBookings = cohort.bookings.filter((b) => ['canceled', 'cancelled'].includes(b.status));

  return (
    <View style={styles.cohortSection}>
      <View style={styles.cohortHeader}>
        <View style={styles.flex}>
          <Text style={styles.cohortTitle}>{cohort.name}</Text>
          <Text style={styles.meta}>
            Host: {cohort.instructor_name} · {activeBookings.length} booked · {openSlots} open{' '}
            {openSlots === 1 ? 'slot' : 'slots'}
          </Text>
        </View>
      </View>

      {activeBookings.length === 0 ? (
        <View style={styles.emptyCard}>
          <Calendar color={c.text.muted} size={18} />
          <Text style={styles.copy}>No active student bookings yet.</Text>
        </View>
      ) : (
        activeBookings.map((booking) => {
          const joinUrl = safeExternalUrl(booking.zoom_url);
          const highlighted = targetBookingId === booking.id;
          return (
            <View
              key={booking.id}
              testID={`staff-meeting-booking-${booking.id}`}
              style={[styles.bookingCard, highlighted && styles.bookingHighlighted]}
            >
              {highlighted ? <Text style={styles.highlightBadge}>Meeting from your update</Text> : null}
              <View style={styles.bookingTop}>
                <View style={styles.flex}>
                  <Text style={styles.studentName}>{booking.student_name}</Text>
                  <Text style={styles.meta}>
                    Week {booking.week_number} · {formatCourseDateTime(booking.starts_at, { fallback: booking.starts_at })}
                  </Text>
                </View>
              </View>

              <View style={styles.actionRow}>
                {joinUrl ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Join meeting with ${booking.student_name}`}
                    onPress={() =>
                      void Linking.openURL(joinUrl).catch(() =>
                        Alert.alert('Could not open meeting link', 'Check the URL and try again.'),
                      )
                    }
                    style={[styles.actionChip, styles.joinChip]}
                  >
                    <Video color={c.text.onAction} size={15} />
                    <Text style={styles.joinChipText}>Join</Text>
                    <ExternalLink color={c.text.onAction} size={13} />
                  </Pressable>
                ) : null}

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit link for ${booking.student_name}`}
                  disabled={busy}
                  onPress={() => onEditZoom(booking)}
                  style={styles.actionChip}
                >
                  <Link2 color={c.text.strong} size={15} />
                  <Text style={styles.actionChipText}>{booking.zoom_url ? 'Edit link' : 'Add link'}</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${booking.student_name}`}
                  disabled={!connected || messagingId !== null}
                  onPress={() => onMessage(booking)}
                  style={styles.actionChip}
                >
                  <MessageSquare color={c.text.strong} size={15} />
                  <Text style={styles.actionChipText}>Message</Text>
                </Pressable>

                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Cancel meeting with ${booking.student_name}`}
                  disabled={busy}
                  onPress={() => onCancel(booking)}
                  style={[styles.actionChip, styles.cancelChip]}
                >
                  <XCircle color={c.status.danger.fg} size={15} />
                  <Text style={styles.cancelChipText}>Cancel</Text>
                </Pressable>
              </View>
            </View>
          );
        })
      )}

      {canceledBookings.length > 0 ? (
        <View style={styles.canceledBox}>
          <Text style={styles.canceledLabel}>CANCELED ({canceledBookings.length})</Text>
          {canceledBookings.slice(0, 3).map((booking) => (
            <Text key={booking.id} style={styles.meta}>
              {booking.student_name} · Week {booking.week_number} ·{' '}
              {formatCourseDateTime(booking.starts_at, { fallback: booking.starts_at })}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const useStyles = makeStyles(({ colors: c, radius }) =>
  StyleSheet.create({
    root: { gap: 16 },
    flex: { flex: 1, minWidth: 0 },
    loading: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12 },
    notice: {
      borderRadius: radius.control,
      backgroundColor: c.surface.sunken,
      color: c.text.strong,
      fontFamily: fonts.semibold,
      fontSize: 13,
      padding: 12,
    },
    error: { color: c.status.danger.fg, fontFamily: fonts.semibold, fontSize: 13, lineHeight: 19 },
    copy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
    meta: { color: c.text.muted, fontFamily: fonts.medium, fontSize: 12, lineHeight: 18 },
    card: {
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border.subtle,
      backgroundColor: c.surface.raised,
      padding: 16,
      gap: 8,
    },
    cardTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 },
    cohortSection: { gap: 10 },
    cohortHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    cohortTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 18 },
    emptyCard: {
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border.subtle,
      backgroundColor: c.surface.raised,
      padding: 14,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
    },
    bookingCard: {
      borderRadius: radius.card,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: c.border.subtle,
      backgroundColor: c.surface.raised,
      padding: 14,
      gap: 12,
    },
    bookingHighlighted: {
      borderColor: c.selection.indicator,
      borderWidth: 2,
    },
    highlightBadge: {
      alignSelf: 'flex-start',
      borderRadius: radius.sm,
      overflow: 'hidden',
      backgroundColor: c.selection.bg,
      color: c.text.strong,
      fontFamily: fonts.bold,
      fontSize: 12,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    bookingTop: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    studentName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 16 },
    actionRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    actionChip: {
      minHeight: 44,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: c.border.subtle,
      backgroundColor: c.surface.sunken,
      paddingHorizontal: 12,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    actionChipText: { color: c.text.strong, fontFamily: fonts.semibold, fontSize: 13 },
    joinChip: { backgroundColor: c.action.primary, borderColor: c.action.primary },
    joinChipText: { color: c.text.onAction, fontFamily: fonts.bold, fontSize: 13 },
    cancelChip: { borderColor: c.status.danger.border, backgroundColor: c.status.danger.bg },
    cancelChipText: { color: c.status.danger.fg, fontFamily: fonts.semibold, fontSize: 13 },
    canceledBox: {
      borderRadius: radius.control,
      backgroundColor: c.surface.sunken,
      padding: 12,
      gap: 4,
    },
    canceledLabel: { color: c.text.muted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8 },
    webRow: { gap: 8, paddingTop: 4 },
    sheetBody: { gap: 12, paddingTop: 4 },
    fieldLabel: { color: c.text.muted, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8 },
    input: {
      minHeight: 48,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: c.border.subtle,
      backgroundColor: c.surface.sunken,
      color: c.text.strong,
      fontFamily: fonts.regular,
      fontSize: 15,
      paddingHorizontal: 14,
    },
    sheetActions: { flexDirection: 'row', gap: 10, marginTop: 4 },
    sheetButton: { flex: 1 },
  }),
);
