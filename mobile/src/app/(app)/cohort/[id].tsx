import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Bell, BookOpen, CalendarDays, ChevronRight, ClipboardCheck, Clock3, LifeBuoy, MessageSquare, Users, type LucideIcon } from 'lucide-react-native';
import { RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useEffect, useRef } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CohortSwitcher } from '@/components/cohort-switcher';
import { EmptyState, ErrorState, LoadingState } from '@/components/screen-states';
import { fonts } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { demoStaffDashboard } from '@/lib/demo-staff';
import type { CohortHome } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';
import { formatCourseDate, formatCourseDateTime } from '@/lib/course-time';

function demoHome(id: number, staff: boolean): CohortHome {
  const staffCohort = demoStaffDashboard.cohorts.find((item) => item.cohort.id === id);
  const cohort = staff ? staffCohort?.cohort : demoDashboard.cohort;
  return {
    cohort: { id, name: cohort?.name || 'Code School cohort', status: cohort?.status || 'active', cohort_type: 'bootcamp', curriculum_name: 'Code School curriculum', workspace_id: null, start_date: cohort?.start_date || new Date().toISOString(), end_date: null },
    permissions: { can_manage_roster: staff, can_manage_schedule: staff, can_manage_learning_schedule: staff, can_grade: staff, can_announce: staff },
    ...(staff ? {
      counts: { invited: 0, joined: staffCohort?.students.length || 0, active_students: staffCohort?.students.length || 0, ungraded: staffCohort?.ungraded_count || 0, redos: 0, open_help: 0 },
      students: (staffCohort?.students || []).map((student) => ({ user_id: student.user_id, enrollment_id: student.user_id, full_name: student.full_name, email: student.email, status: 'active', invited_at: cohort?.start_date || null, joined_at: cohort?.start_date || null, invite_delivery_status: 'accepted', progress_percentage: student.progress_percentage, ungraded_count: student.ungraded_count, redo_count: student.redo_count, last_seen_at: student.last_seen_at })),
    } : { own_progress_percentage: demoDashboard.overall_progress?.percentage || 0 }),
    upcoming_events: [], recent_announcements: [],
  };
}

export default function CohortHomeScreen() {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const cohortId = Number(id);
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { cohorts, selectedCohortId, selectCohort } = useCohort();
  const syncedRouteId = useRef<number | null>(null);
  const { workspaces, selectWorkspace } = useWorkspace();
  const query = useQuery({
    queryKey: ['cohort-home', user?.id, cohortId],
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ home: demoHome(cohortId, Boolean(user?.is_staff)) }) : api.cohortHome(cohortId, signal),
    enabled: Boolean(user && Number.isInteger(cohortId) && cohortId > 0),
  });
  const home = query.data?.home;
  const scopedWorkspace = workspaces.find((workspace) => workspace.cohort_id === cohortId);
  useEffect(() => {
    if (!home || syncedRouteId.current === cohortId || !cohorts.some((cohort) => cohort.id === cohortId)) return;
    syncedRouteId.current = cohortId;
    if (selectedCohortId === cohortId) return;
    const frame = requestAnimationFrame(() => void selectCohort(cohortId));
    return () => cancelAnimationFrame(frame);
  }, [cohortId, cohorts, home, selectedCohortId, selectCohort]);

  const openMessages = () => {
    if (scopedWorkspace) void selectWorkspace(scopedWorkspace.id);
    router.push('/messages');
  };
  const openGrading = () => router.push({ pathname: '/staff/grading', params: { cohort_id: String(cohortId) } });
  const openSupport = () => router.push({ pathname: '/staff/support', params: { cohort_id: String(cohortId) } });
  const openPeople = () => router.push({ pathname: '/staff/access', params: { cohort_id: String(cohortId) } });

  if (!Number.isInteger(cohortId) || cohortId <= 0) return <SafeAreaView style={styles.safe}><EmptyState title="Cohort unavailable" copy="Choose a cohort from Today to continue." /></SafeAreaView>;
  if (query.isPending && !home) return <SafeAreaView style={styles.safe}><LoadingState label="Opening cohort" /></SafeAreaView>;
  if (query.error && !home) return <SafeAreaView style={styles.safe}><ErrorState title="Cohort unavailable" message={(query.error as Error).message} retry={() => void query.refetch()} /></SafeAreaView>;
  if (!home) return null;
  const staff = Boolean(user?.is_staff);
  const students = home.students || [];
  const attention = home.attention?.students || [];

  return <SafeAreaView edges={['top']} style={styles.safe}>
    <View style={styles.topbar}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => router.back()} style={styles.back}><ArrowLeft color={c.text.strong} size={22} /></Pressable><Text style={styles.topTitle}>Cohort home</Text><View style={styles.back} /></View>
    <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
      <CohortSwitcher showHomeLink={false} navigateOnSelect />
      <View style={styles.hero}><Text style={styles.eyebrow}>{home.cohort.cohort_type.toUpperCase()} · {home.cohort.status.toUpperCase()}</Text><Text accessibilityRole="header" style={styles.title}>{home.cohort.name}</Text><Text style={styles.subtitle}>{home.cohort.curriculum_name}</Text><Text style={styles.heroDates}>{dateRange(home.cohort.start_date, home.cohort.end_date)}</Text></View>

      {staff && home.counts ? <>
        <View style={styles.metrics}><Metric value={home.counts.active_students} label="active students" /><Metric value={home.counts.ungraded} label="to grade" urgent={home.counts.ungraded > 0} /><Metric value={home.counts.open_help} label="need help" urgent={home.counts.open_help > 0} /></View>
        <View style={styles.section}><Text style={styles.sectionLabel}>PEOPLE & ACCESS</Text><Text style={styles.sectionTitle}>Know who is here</Text><View style={styles.peopleSplit}><View><Text style={styles.largeNumber}>{home.counts.joined}</Text><Text style={styles.smallCaption}>joined cohort</Text></View><View><Text style={styles.largeNumber}>{home.counts.invited}</Text><Text style={styles.smallCaption}>added, not yet opened</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Manage cohort people" onPress={openPeople} style={styles.inlineAction}><ChevronRight color={c.text.body} size={23} /></Pressable></View>
          {students.slice(0, 4).map((student) => <Pressable key={student.enrollment_id} accessibilityRole="button" accessibilityLabel={`Open ${student.full_name}`} onPress={() => router.push({ pathname: '/staff/student/[id]', params: { id: String(student.user_id), cohort_id: String(cohortId) } })} style={styles.person}><View style={styles.avatar}><Text style={styles.avatarText}>{initials(student.full_name)}</Text></View><View style={styles.flex}><Text style={styles.personName}>{student.full_name}</Text><Text style={styles.personMeta}>{student.joined_at ? 'Joined cohort' : 'Added, not yet opened'} · {Math.round(student.progress_percentage)}% complete</Text>{student.invite_delivery_status !== 'accepted' && <Text style={styles.personMeta}>Account {inviteLabel(student.invite_delivery_status)}</Text>}</View><ChevronRight color={c.text.muted} size={18} /></Pressable>)}
          <Action label="See full roster and invites" icon={Users} onPress={openPeople} />
        </View>
        <View style={styles.section}><Text style={styles.sectionLabel}>NEXT TO DO</Text><Text style={styles.sectionTitle}>Teach with context</Text><View style={styles.actionStack}><Action label={`Grade work${home.counts.ungraded ? ` · ${home.counts.ungraded}` : ''}`} icon={ClipboardCheck} onPress={openGrading} /><Action label={`Help requests${home.counts.open_help ? ` · ${home.counts.open_help}` : ''}`} icon={LifeBuoy} onPress={openSupport} /><Action label="Class messages" icon={MessageSquare} onPress={openMessages} /><Action label="Post an announcement" icon={Bell} onPress={() => router.push({ pathname: '/updates', params: { cohort_id: String(cohortId) } })} /></View>
          {attention.length > 0 && <Text style={styles.supportText}>{attention.length} {attention.length === 1 ? 'student has' : 'students have'} a reason to follow up.</Text>}
        </View>
      </> : <>
        <View style={styles.studentProgress}><Text style={styles.sectionLabel}>YOUR PROGRESS</Text><Text style={styles.studentPercent}>{Math.round(home.own_progress_percentage || 0)}%</Text><Text style={styles.supportText}>Keep going at your own pace. Your lessons and feedback live in this cohort.</Text></View>
        <View style={styles.actionStack}><Action label="Continue learning" icon={BookOpen} onPress={() => router.push('/learn')} /><Action label="Class messages" icon={MessageSquare} onPress={openMessages} /><Action label="Announcements" icon={Bell} onPress={() => router.push('/updates')} /></View>
      </>}

      <View style={styles.section}><Text style={styles.sectionLabel}>SCHEDULE</Text><Text style={styles.sectionTitle}>Coming up</Text>{home.upcoming_events.length ? home.upcoming_events.slice(0, 3).map((event) => <View key={`${event.office_hour_id}:${event.starts_at}`} style={styles.event}><View style={styles.eventIcon}><CalendarDays color={c.text.body} size={19} /></View><View style={styles.flex}><Text style={styles.eventTitle}>{event.title}</Text><Text style={styles.eventTime}>{dateTime(event.starts_at)} · {event.event_kind.replaceAll('_', ' ')}</Text></View></View>) : <Text style={styles.emptyText}>No upcoming sessions have been scheduled.</Text>}{staff && home.permissions.can_manage_schedule && <Action label="Manage sessions and office hours" icon={Clock3} onPress={() => router.push({ pathname: '/cohort/[id]/schedule', params: { id: String(cohortId) } })} />}</View>
      <View style={styles.section}><Text style={styles.sectionLabel}>COMMUNICATION</Text><Text style={styles.sectionTitle}>Latest announcements</Text>{home.recent_announcements.length ? home.recent_announcements.slice(0, 3).map((announcement) => <Pressable key={announcement.id} accessibilityRole="button" onPress={() => router.push('/updates')} style={styles.announcement}><Bell color={c.text.body} size={17} /><View style={styles.flex}><Text style={styles.eventTitle}>{announcement.title}</Text><Text style={styles.eventTime}>{announcement.published_at ? dateTime(announcement.published_at) : 'Draft'}</Text></View><ChevronRight color={c.text.muted} size={18} /></Pressable>) : <Text style={styles.emptyText}>Announcements for this cohort will appear here.</Text>}</View>
      {staff && <Action label="Learning schedule and releases" icon={BookOpen} onPress={() => router.push('/learn' as Href)} />}
    </ScrollView>
  </SafeAreaView>;
}

function Action({ label, icon: Icon, onPress }: { label: string; icon: LucideIcon; onPress: () => void }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onPress} style={styles.action}><View style={styles.actionIcon}><Icon color={c.text.body} size={20} /></View><Text style={styles.actionText}>{label}</Text><ArrowRight color={c.text.muted} size={18} /></Pressable>; }
function Metric({ value, label, urgent = false }: { value: number; label: string; urgent?: boolean }) {
  const styles = useStyles(); return <View style={styles.metric}><Text style={[styles.metricNumber, urgent && styles.metricUrgent]}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>; }
function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function inviteLabel(value: string) { return ({ not_sent: 'invite not sent', queued: 'invite queued', sent: 'invite sent', failed: 'invite failed' } as Record<string, string>)[value] || value; }
function dateTime(value: string) { return formatCourseDateTime(value, { weekday: true, fallback: value }); }
function dateRange(start: string, end: string | null) { const startLabel = formatCourseDate(start, { withYear: true, fallback: start }); return end ? `${startLabel} – ${formatCourseDate(end, { withYear: true, fallback: end })}` : `Started ${startLabel}`; }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, topbar: { minHeight: 57, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 9 }, back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' }, topTitle: { flex: 1, textAlign: 'center', color: c.text.strong, fontFamily: fonts.bold, fontSize: 15 }, content: { padding: 20, paddingBottom: 100, gap: 16 }, flex: { flex: 1, minWidth: 0 }, focusNotice: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: c.status.warning.bg, borderRadius: 12, paddingHorizontal: 14 }, focusText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, hero: { paddingTop: 10, paddingBottom: 6 }, eyebrow: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.5 }, title: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 30, lineHeight: 37, letterSpacing: -0.7, marginTop: 5 }, subtitle: { color: c.text.body, fontFamily: fonts.medium, fontSize: 13, marginTop: 5 }, heroDates: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 7 }, metrics: { flexDirection: 'row', gap: 8 }, metric: { flex: 1, minHeight: 91, backgroundColor: c.surface.sunken, borderColor: c.border.subtle, borderWidth: 1, borderRadius: 16, padding: 11, justifyContent: 'space-between' }, metricNumber: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 23 }, metricUrgent: { color: c.status.danger.fg}, metricLabel: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 15 }, section: { gap: 10, marginTop: 13 }, sectionLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.35 }, sectionTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 21, marginTop: -5 }, peopleSplit: { minHeight: 86, backgroundColor: c.surface.sunken, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, largeNumber: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 22 }, smallCaption: { color: c.text.body, fontFamily: fonts.medium, fontSize: 12 }, inlineAction: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, person: { minHeight: 67, paddingHorizontal: 11, backgroundColor: c.surface.raised, borderColor: c.border.subtle, borderWidth: 1, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 10 }, avatar: { width: 39, height: 39, borderRadius: 12, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, avatarText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, personName: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, personMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 }, actionStack: { gap: 8 }, action: { minHeight: 62, flexDirection: 'row', alignItems: 'center', gap: 11, paddingHorizontal: 12, borderRadius: 16, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken }, actionIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, actionText: { flex: 1, color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, supportText: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 }, studentProgress: { minHeight: 145, backgroundColor: c.surface.sunken, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 20, padding: 17, gap: 7 }, studentPercent: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 38 }, event: { minHeight: 63, flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 11, borderWidth: 1, borderColor: c.border.subtle, borderRadius: 15, backgroundColor: c.surface.raised }, eventIcon: { width: 37, height: 37, borderRadius: 11, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, eventTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 }, eventTime: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, marginTop: 4 }, announcement: { minHeight: 60, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 13, backgroundColor: c.status.info.bg, borderWidth: 1, borderColor: c.status.info.border, borderRadius: 15 }, emptyText: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, paddingVertical: 12 },
}));
