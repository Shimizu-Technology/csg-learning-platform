import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { themedAlert as Alert } from '@/lib/alerts';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { AlertTriangle, ArrowRight, BadgeCheck, BookOpen, CalendarCheck, CalendarClock, ClipboardCheck, Clock3, ExternalLink, Hourglass, LifeBuoy, Megaphone, MessageSquare, RotateCcw, Users, type LucideIcon } from 'lucide-react-native';
import { RefreshControl, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, SectionHeading } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { WeeklyPlanCard } from '@/components/weekly-plan';
import { CohortSwitcher } from '@/components/cohort-switcher';
import { fontScaleLimits, fonts, typography } from '@/constants/csg-theme';
import { formatCourseDateTime } from '@/lib/course-time';
import { markdownExcerpt } from '@/lib/plain-text';
import { demoDashboard, demoWeeklyPlan } from '@/lib/demo-learning';
import { demoStaffDashboard } from '@/lib/demo-staff';
import { openAuthenticatedWebPage, openExternalPage } from '@/lib/external-links';
import { isStudentDashboard, learningKeys, staffAttentionRank } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';
import { useCohort } from '@/providers/cohort-provider';

export default function TodayScreen() {
  const styles = useStyles();
  const { colors: c, statusTones } = useTheme();
  const router = useRouter();
  const { fontScale } = useWindowDimensions();
  const largeText = fontScale >= 1.5;
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const { selectedCohortId } = useCohort();
  const query = useQuery({
    queryKey: learningKeys.dashboard(user?.id || 0, selectedCohortId),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ dashboard: user?.is_staff ? { ...demoStaffDashboard, cohorts: selectedCohortId ? demoStaffDashboard.cohorts.filter((item) => item.cohort.id === selectedCohortId) : demoStaffDashboard.cohorts } : demoDashboard }) : api.dashboard(signal, selectedCohortId),
    enabled: Boolean(user),
  });
  const dashboard = query.data?.dashboard;
  const weeklyQuery = useQuery({
    queryKey: learningKeys.weeklyPlan(user?.id || 0, selectedCohortId),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ weekly_plan: demoWeeklyPlan }) : api.weeklyPlan(signal, selectedCohortId),
    enabled: Boolean(user && !user.is_staff),
  });
  const weeklyPlan = weeklyQuery.data?.weekly_plan;

  const refresh = () => void Promise.all([query.refetch(), user?.is_staff ? Promise.resolve() : weeklyQuery.refetch()]);

  if (query.isPending && !dashboard) return <SafeAreaView style={styles.safe}><LoadingState label="Loading today" /></SafeAreaView>;
  if (query.error && !dashboard) return <SafeAreaView style={styles.safe}><ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /></SafeAreaView>;

  if (!dashboard || !isStudentDashboard(dashboard)) {
    const cohorts = dashboard && 'cohorts' in dashboard ? dashboard.cohorts : [];
    const students = cohorts.flatMap((cohort) => cohort.students.map((student) => ({ ...student, cohort_id: cohort.cohort.id, cohort_name: cohort.cohort.name })));
    const attention = [...students].sort((a, b) => staffAttentionRank(b) - staffAttentionRank(a));
    const ungraded = cohorts.reduce((total, cohort) => total + cohort.ungraded_count, 0);
    const redos = students.reduce((total, student) => total + student.redo_count, 0);
    return <SafeAreaView edges={['top']} style={styles.safe}><ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={refresh} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
      {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved staff data. Pull to reconnect.</Text></View>}
      <CohortSwitcher />
      <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>TEACHING TODAY</Text><Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heroTitle}>Good {dayPart()}, {firstName(dashboard?.user.full_name || user?.full_name || '')}</Text><Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.heroCopy}>See who needs a response, review work, and move the class forward from your phone.</Text>
      <View style={[styles.metricGrid, largeText && styles.singleColumn]}><MetricCard icon={Clock3} value={ungraded} label="awaiting review" tone="pending" large={largeText} /><MetricCard icon={RotateCcw} value={redos} label="redo requests" tone="warning" large={largeText} /><MetricCard icon={Users} value={students.length} label="active students" tone="success" large={largeText} /></View>
      <View style={styles.section}><SectionHeading eyebrow="Highest signal first" title="Needs attention" actionLabel={ungraded ? 'Grading queue' : undefined} onAction={ungraded ? () => router.push('/staff/grading') : undefined} />
        <View style={styles.stack}>{attention.slice(0, 8).map((student) => <LearningCard key={`${student.cohort_id}:${student.user_id}`} onPress={() => router.push({ pathname: '/staff/student/[id]', params: { id: String(student.user_id), cohort_id: String(student.cohort_id) } })} label={`Open ${student.full_name} in ${student.cohort_name}`}><View style={styles.row}><View style={styles.studentAvatar}><Text allowFontScaling={false} style={styles.studentInitials}>{initials(student.full_name)}</Text></View><View style={styles.flex}><View style={styles.studentTop}><Text style={styles.cardTitle}>{student.full_name}</Text><Text style={styles.studentPercent}>{Math.round(student.progress_percentage)}%</Text></View><Text style={styles.cardMeta}>{student.cohort_name} · {student.completed_blocks}/{student.total_blocks} steps</Text><View style={styles.signalRow}>{student.redo_count > 0 && <Signal icon={RotateCcw} label={`${student.redo_count} redo`} tone="warning" />}{student.ungraded_count > 0 && <Signal icon={Clock3} label={`${student.ungraded_count} awaiting review`} tone="pending" />}{isInactive(student.last_activity_at || student.last_seen_at) && <Signal icon={AlertTriangle} label="Inactive 7d+" tone="quiet" />}</View></View><ArrowRight color={c.text.muted} size={18} /></View></LearningCard>)}</View>
      </View>
      <View style={styles.section}><SectionHeading title="Quick actions" /><View style={[styles.quickGrid, largeText && styles.singleColumn]}><QuickAction icon={Users} label="Student access" large={largeText} onPress={() => router.push('/staff/access')} /><QuickAction icon={LifeBuoy} label="Student support" large={largeText} onPress={() => router.push('/staff/support' as Href)} /></View><View style={[styles.quickGrid, largeText && styles.singleColumn]}><QuickAction icon={ClipboardCheck} label="Grade work" large={largeText} onPress={() => router.push('/staff/grading')} /><QuickAction icon={MessageSquare} label="Messages" large={largeText} onPress={() => router.push('/messages')} /></View><View style={[styles.quickGrid, largeText && styles.singleColumn]}><QuickAction icon={Megaphone} label="Updates" large={largeText} onPress={() => router.push('/updates')} /><QuickAction icon={ExternalLink} label="Full staff tools" large={largeText} onPress={() => void openAuthenticatedWebPage(api, '/admin').catch((error) => Alert.alert('Could not open staff tools', (error as Error).message))} /></View></View>
    </ScrollView></SafeAreaView>;
  }

  if (!dashboard.enrolled) return <SafeAreaView style={styles.safe}><View style={styles.content}><CohortSwitcher /></View><View style={styles.center}><BookOpen color={c.text.body} size={34} /><Text style={styles.emptyTitle}>No active learning path</Text><Text style={styles.emptyCopy}>Choose a current cohort to see its lessons, or open a past cohort to revisit your class.</Text></View></SafeAreaView>;

  const progress = dashboard.overall_progress?.percentage || 0;
  const modules = dashboard.modules || [];
  // Enrolled but nothing assigned yet: say so plainly instead of "caught up" and 100% of nothing.
  const courseNotOpen = modules.length === 0 || modules.every((mod) => mod.lessons.length === 0);
  const awaitingReviewCount = modules.reduce((sum, mod) => sum + mod.lessons.filter((lesson) => lesson.completed && lesson.review_status === 'awaiting_review').length, 0);
  const showWeeklyPlan = Boolean(!courseNotOpen && weeklyPlan?.enrolled && (!selectedCohortId || weeklyPlan.cohort?.id === selectedCohortId));
  // One progress number on Today: the week's required work when the plan shows it, otherwise the course.
  const showCourseProgress = !courseNotOpen && !(showWeeklyPlan && weeklyPlan?.mode !== 'library' && (weeklyPlan?.summary?.required_count || 0) > 0);
  const showWeeklyFallback = !courseNotOpen && !weeklyQuery.isPending && !weeklyPlan?.enrolled;
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching || weeklyQuery.isRefetching} onRefresh={refresh} tintColor={c.text.body} />} contentContainerStyle={styles.content}>
        {(query.isError || weeklyQuery.isError) && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved learning data. Pull to reconnect.</Text></View>}
        <CohortSwitcher />
        <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>YOUR LEARNING DAY</Text><Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heroTitle}>Good {dayPart()}, {firstName(dashboard.user.full_name)}</Text><Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.heroCopy}>{dashboard.cohort?.name || 'Code School of Guam'} · focus on the next useful step.</Text>
        {courseNotOpen ? <View accessibilityRole="summary" style={styles.notOpen} testID="course-not-open">
          <View style={styles.cardTop}><View style={styles.notOpenIcon}><Hourglass color={c.text.body} size={21} /></View><View style={styles.flex}><Text style={styles.cardTitle}>Your course isn’t open yet</Text><Text style={styles.notOpenCopy}>Your lessons will appear here as soon as your instructor opens them. If you expected to start already, message your instructor.</Text></View></View>
          <Pressable accessibilityRole="button" accessibilityLabel="Message your instructor" onPress={() => router.push('/messages')} style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}><MessageSquare color={c.text.strong} size={17} /><Text style={styles.secondaryButtonText}>Message your instructor</Text></Pressable>
        </View> : <LearningCard onPress={dashboard.continue_lesson ? () => router.push(`/lesson/${dashboard.continue_lesson!.id}`) : undefined} label={dashboard.continue_lesson ? `Continue ${dashboard.continue_lesson.title}` : undefined}>
          <View style={styles.cardTop}><View style={styles.continueIcon}>{!dashboard.continue_lesson && awaitingReviewCount > 0 ? <Clock3 color={statusTones.pending.text} size={21} /> : <BookOpen color={c.text.body} size={21} />}</View><View style={styles.flex}><Text style={styles.cardKicker}>NEXT BEST ACTION</Text><Text style={styles.cardTitle}>{dashboard.continue_lesson?.title || (awaitingReviewCount > 0 ? 'Everything open is submitted' : 'You’re caught up')}</Text><Text style={styles.cardMeta}>{dashboard.continue_lesson ? 'Continue your current lesson' : awaitingReviewCount > 0 ? `Your instructor is reviewing ${awaitingReviewCount === 1 ? 'one piece of work' : `${awaitingReviewCount} pieces of work`}.` : 'New lessons will appear here when they open.'}</Text></View>{dashboard.continue_lesson && <ArrowRight color={c.text.body} size={20} />}</View>
          {showCourseProgress && <><View style={styles.progressCopy}><Text style={styles.progressLabel}>Course progress</Text><Text style={styles.progressValue}>{Math.round(progress)}%</Text></View><ProgressBar value={progress} label="Course progress" /></>}
        </LearningCard>}

        {dashboard.private_meetings_enabled && <Pressable accessibilityRole="button" accessibilityLabel="Book your weekly private hour" accessibilityHint="Choose or change your weekly meeting in the app" onPress={() => router.push('/meetings' as Href)} style={({ pressed }) => [styles.meetings, pressed && styles.pressed]} testID="book-private-hour"><View style={styles.meetingsIcon}><CalendarCheck color={c.text.onAction} size={20} /></View><View style={styles.flex}><Text style={styles.cardTitle}>Book your weekly private hour</Text><Text style={styles.cardMeta}>Choose or change your 60-minute Zoom hour.</Text></View><ArrowRight color={c.text.body} size={18} /></Pressable>}

        {showWeeklyPlan && weeklyPlan && <WeeklyPlanCard plan={weeklyPlan} />}

        {showWeeklyFallback && !!dashboard.action_items?.length && <View style={styles.section}><SectionHeading eyebrow="Needs attention" title="Redo work" /><View style={styles.stack}>{dashboard.action_items.map((item) => <LearningCard key={item.submission_id} onPress={() => router.push(`/lesson/${item.lesson_id}${item.cohort_id || dashboard.cohort?.id ? `?cohort_id=${item.cohort_id || dashboard.cohort!.id}` : ''}${item.content_block_id ? `${item.cohort_id || dashboard.cohort?.id ? '&' : '?'}block_id=${item.content_block_id}` : ''}`)} label={`Open redo for ${item.lesson_title}`}><View style={styles.row}><View style={styles.redoIcon}><RotateCcw color={c.text.body} size={18} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{item.lesson_title}</Text><Text style={styles.cardMeta}>{item.content_block_title}</Text>{item.feedback && <Text numberOfLines={3} style={styles.feedback}>{markdownExcerpt(item.feedback)}</Text>}</View><ArrowRight color={c.text.body} size={18} /></View></LearningCard>)}</View></View>}

        {!!dashboard.recently_graded?.length && <View style={styles.section}><SectionHeading eyebrow="Instructor feedback" title="Recently graded" /><View style={styles.stack}>{dashboard.recently_graded.map((item) => <LearningCard key={item.submission_id} onPress={() => router.push(`/lesson/${item.lesson_id}${item.cohort_id || dashboard.cohort?.id ? `?cohort_id=${item.cohort_id || dashboard.cohort!.id}` : ''}${item.content_block_id ? `${item.cohort_id || dashboard.cohort?.id ? '&' : '?'}block_id=${item.content_block_id}` : ''}`)} label={`Review feedback for ${item.lesson_title}`}><View style={styles.row}><View style={styles.gradeIcon}><BadgeCheck color={c.status.success.fg} size={19} /></View><View style={styles.flex}><View style={styles.gradeRow}><Text style={styles.cardTitle}>{item.lesson_title}</Text><Text style={styles.grade}>Reviewed · {item.grade}</Text></View><Text style={styles.cardMeta}>{item.content_block_title}</Text>{item.feedback && <Text numberOfLines={3} style={styles.feedback}>{markdownExcerpt(item.feedback)}</Text>}</View><ArrowRight color={c.text.muted} size={18} /></View></LearningCard>)}</View></View>}

        {!!dashboard.cohort?.announcements?.length && <View style={styles.section}><SectionHeading eyebrow="Class updates" title="Announcements" actionLabel="View all" onAction={() => router.push('/updates')} /><View style={styles.stack}>{dashboard.cohort.announcements.slice(0, 2).map((announcement) => <LearningCard key={announcement.id} onPress={() => router.push(`/updates?announcement_id=${announcement.id}`)} label={`Open announcement: ${announcement.title}`}><View style={styles.row}><View style={styles.announcementIcon}><Megaphone color={c.text.body} size={18} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{announcement.title}</Text><Text numberOfLines={3} style={styles.announcementBody}>{markdownExcerpt(announcement.body)}</Text></View>{(announcement.unread ?? !announcement.read_at) && <View testID={`announcement-unread-${announcement.id}`} style={styles.unreadDot} />}</View></LearningCard>)}</View></View>}


        {!courseNotOpen && <View style={styles.section}><SectionHeading title="Stay connected" /><View style={[styles.quickGrid, largeText && styles.singleColumn]}><QuickAction icon={MessageSquare} label="Messages" large={largeText} onPress={() => router.push('/messages')} /><QuickAction icon={Megaphone} label={dashboard.cohort?.unread_notifications_count ? `${dashboard.cohort.unread_notifications_count} updates` : 'Updates'} large={largeText} onPress={() => router.push('/updates')} /></View></View>}

        {showWeeklyFallback && !!dashboard.office_hours?.length && <View style={styles.section}><SectionHeading eyebrow="Coming up" title="Live schedule" /><LearningCard onPress={dashboard.office_hours[0].meeting_url ? () => void openExternalPage(dashboard.office_hours![0].meeting_url).catch((error) => Alert.alert('Could not open session', (error as Error).message)) : undefined} label={dashboard.office_hours[0].meeting_url ? `Join ${dashboard.office_hours[0].title || 'session'}` : undefined}><View style={styles.row}><CalendarClock color={c.text.body} size={21} /><View style={styles.flex}><Text style={styles.cardTitle}>{dashboard.office_hours[0].title || 'Live session'}</Text><Text style={styles.cardMeta}>{formatOfficeHours(dashboard.office_hours[0])}</Text></View>{dashboard.office_hours[0].meeting_url && <ArrowRight color={c.text.muted} size={18} />}</View></LearningCard></View>}
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ icon: Icon, label, onPress, large = false }: { icon: LucideIcon; label: string; onPress: () => void; large?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); return <View style={[styles.quickItem, large && styles.quickItemLarge]}><LearningCard onPress={onPress} label={label}><Icon color={c.text.body} size={21} /><Text style={styles.quickLabel}>{label}</Text></LearningCard></View>; }
function MetricCard({ icon: Icon, value, label, tone, large = false }: { icon: LucideIcon; value: number; label: string; tone: 'pending' | 'warning' | 'success'; large?: boolean }) {
  const styles = useStyles();
  const { colors: c, statusTones } = useTheme(); const color = tone === 'warning' ? c.status.warning.fg : tone === 'success' ? c.status.success.fg : statusTones.pending.text; return <View style={[styles.metricCard, large && styles.metricCardLarge]}><Icon color={color} size={18} /><Text style={styles.metricNumber}>{value}</Text><Text style={styles.metricCardLabel}>{label}</Text></View>; }
function Signal({ icon: Icon, label, tone }: { icon: LucideIcon; label: string; tone: 'pending' | 'warning' | 'quiet' }) {
  const styles = useStyles();
  const { colors: c, statusTones } = useTheme(); const color = tone === 'warning' ? c.status.warning.fg : tone === 'pending' ? statusTones.pending.text : c.text.body; return <View style={styles.signal}><Icon color={color} size={11} /><Text style={[styles.signalText, { color }]}>{label}</Text></View>; }
function firstName(value: string) { return value.trim().split(/\s+/)[0] || 'there'; }
function initials(value: string) { return value.split(/\s+/).slice(0, 2).map((part) => part[0]).join('').toUpperCase(); }
function isInactive(value: string | null) { return !value || Date.now() - Date.parse(value) >= 7 * 86_400_000; }
function dayPart() { const hour = new Date().getHours(); return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'; }
function formatOfficeHours(value: { starts_at?: string; start_time?: string; location?: string | null }) { const raw = value.starts_at || value.start_time; if (!raw) return value.location || 'Schedule available in your cohort'; return `${formatCourseDateTime(raw, { weekday: true, fallback: raw })}${value.location ? ` · ${value.location}` : ''}`; }

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  safe: { flex: 1, backgroundColor: c.surface.page }, content: { padding: 20, paddingBottom: 120, gap: 16 },
  offline: { minHeight: 36, borderRadius: 12, backgroundColor: c.status.warning.bg, justifyContent: 'center', paddingHorizontal: 12, marginBottom: 2 }, offlineText: { color: c.status.warning.fg, fontFamily: fonts.semibold, fontSize: 12 },
  eyebrow: { ...typography.label, color: c.text.body, fontFamily: fonts.bold, letterSpacing: 1.8, marginTop: 8 }, heroTitle: { ...typography.display, color: c.text.strong, fontFamily: fonts.extraBold, letterSpacing: -1.1, marginTop: -8 }, heroCopy: { ...typography.support, color: c.text.body, fontFamily: fonts.regular, marginTop: -9, marginBottom: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, continueIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, cardKicker: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1 }, cardTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 }, cardMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 2 }, progressCopy: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, marginBottom: 7 }, progressLabel: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, progressValue: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12 },
  section: { gap: 12, marginTop: 10 }, stack: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, redoIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.status.warning.bg, alignItems: 'center', justifyContent: 'center' }, gradeIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.status.success.bg, alignItems: 'center', justifyContent: 'center' }, gradeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, grade: { color: c.status.success.fg, fontFamily: fonts.extraBold, fontSize: 12 }, feedback: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 8 }, announcementIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: c.status.info.bg, alignItems: 'center', justifyContent: 'center' }, announcementBody: { color: c.status.info.fg, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 4 }, unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: c.text.body },
  quickGrid: { flexDirection: 'row', gap: 10 }, singleColumn: { flexDirection: 'column' }, quickItem: { flex: 1 }, quickItemLarge: { flex: 0 }, quickLabel: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 12, marginTop: 10 },
  metricGrid: { flexDirection: 'row', gap: 8 }, metricCard: { flex: 1, minHeight: 112, borderRadius: 18, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, padding: 14, justifyContent: 'space-between' }, metricCardLarge: { flex: 0, minHeight: 154 }, metricNumber: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 24, marginTop: 9 }, metricCardLabel: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16 }, studentAvatar: { width: 44, height: 44, borderRadius: 15, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, studentInitials: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, studentTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, studentPercent: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 12 }, signalRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 }, signal: { minHeight: 24, borderRadius: 12, backgroundColor: c.surface.raised, borderWidth: 1, borderColor: c.border.subtle, paddingHorizontal: 7, flexDirection: 'row', alignItems: 'center', gap: 4 }, signalText: { fontFamily: fonts.bold, fontSize: 12 },
  notOpen: { borderRadius: 20, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.sunken, padding: 16, gap: 14 }, notOpenIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' }, notOpenCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 4 }, secondaryButton: { minHeight: 48, borderRadius: 14, borderWidth: 1, borderColor: c.border.strong, backgroundColor: c.surface.raised, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 }, secondaryButtonText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, meetings: { minHeight: 76, borderRadius: 20, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken, padding: 16, flexDirection: 'row', alignItems: 'center', gap: 12 }, meetingsIcon: { width: 42, height: 42, borderRadius: 13, backgroundColor: c.action.primary, alignItems: 'center', justifyContent: 'center' }, pressed: { opacity: 0.84, transform: [{ scale: 0.99 }] },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }, emptyTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 19, marginTop: 15 }, emptyCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 },
}));
