import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'expo-router';
import { ArrowRight, BadgeCheck, BookOpen, CalendarClock, Megaphone, MessageSquare, RotateCcw, Users, type LucideIcon } from 'lucide-react-native';
import { Alert, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { LearningCard, ProgressBar, SectionHeading } from '@/components/learning-ui';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { fonts, palette } from '@/constants/csg-theme';
import { demoDashboard } from '@/lib/demo-learning';
import { openExternalPage } from '@/lib/external-links';
import { isStudentDashboard, learningKeys } from '@/lib/learning';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function TodayScreen() {
  const router = useRouter();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const query = useQuery({
    queryKey: learningKeys.dashboard(user?.id || 0),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ dashboard: demoDashboard }) : api.dashboard(signal),
    enabled: Boolean(user),
  });
  const dashboard = query.data?.dashboard;

  if (query.isPending && !dashboard) return <SafeAreaView style={styles.safe}><LoadingState label="Loading today" /></SafeAreaView>;
  if (query.error && !dashboard) return <SafeAreaView style={styles.safe}><ErrorState message={(query.error as Error).message} retry={() => void query.refetch()} /></SafeAreaView>;

  if (!dashboard || !isStudentDashboard(dashboard)) {
    const cohorts = dashboard && 'cohorts' in dashboard ? dashboard.cohorts : [];
    return <SafeAreaView style={styles.safe}><ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}><Text style={styles.eyebrow}>TEACHING TODAY</Text><Text style={styles.heroTitle}>Good {dayPart()}</Text><Text style={styles.heroCopy}>Communication is native now. Student intervention tools arrive in the staff phase.</Text><LearningCard><View style={styles.staffMetric}><Users color={palette.rubySoft} size={22} /><View><Text style={styles.metricValue}>{cohorts.length}</Text><Text style={styles.metricLabel}>active cohort spaces</Text></View></View></LearningCard><View style={styles.section}><SectionHeading title="Quick actions" /><View style={styles.quickGrid}><QuickAction icon={MessageSquare} label="Messages" onPress={() => router.push('/messages')} /><QuickAction icon={Megaphone} label="Updates" onPress={() => router.push('/updates')} /></View></View></ScrollView></SafeAreaView>;
  }

  if (!dashboard.enrolled) return <SafeAreaView style={styles.safe}><View style={styles.center}><BookOpen color={palette.rubySoft} size={34} /><Text style={styles.emptyTitle}>No active learning path</Text><Text style={styles.emptyCopy}>Your lessons will appear here when your cohort enrollment is active.</Text></View></SafeAreaView>;

  const progress = dashboard.overall_progress?.percentage || 0;
  return (
    <SafeAreaView edges={['top']} style={styles.safe}>
      <ScrollView refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
        {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved learning data. Pull to reconnect.</Text></View>}
        <Text style={styles.eyebrow}>YOUR LEARNING DAY</Text><Text style={styles.heroTitle}>Good {dayPart()}, {firstName(dashboard.user.full_name)}</Text><Text style={styles.heroCopy}>{dashboard.cohort?.name || 'Code School of Guam'} · focus on the next useful step.</Text>
        <LearningCard onPress={dashboard.continue_lesson ? () => router.push(`/lesson/${dashboard.continue_lesson!.id}`) : undefined} label={dashboard.continue_lesson ? `Continue ${dashboard.continue_lesson.title}` : undefined}>
          <View style={styles.cardTop}><View style={styles.continueIcon}><BookOpen color={palette.rubySoft} size={21} /></View><View style={styles.flex}><Text style={styles.cardKicker}>NEXT BEST ACTION</Text><Text style={styles.cardTitle}>{dashboard.continue_lesson?.title || 'You’re caught up'}</Text><Text style={styles.cardMeta}>{dashboard.continue_lesson ? 'Continue your current lesson' : 'Review your completed lessons anytime'}</Text></View>{dashboard.continue_lesson && <ArrowRight color={palette.muted} size={20} />}</View>
          <View style={styles.progressCopy}><Text style={styles.progressLabel}>Overall progress</Text><Text style={styles.progressValue}>{Math.round(progress)}%</Text></View><ProgressBar value={progress} label="Overall learning progress" />
        </LearningCard>

        {!!dashboard.action_items?.length && <View style={styles.section}><SectionHeading eyebrow="Needs attention" title="Redo work" /><View style={styles.stack}>{dashboard.action_items.map((item) => <LearningCard key={item.submission_id} onPress={() => router.push(`/lesson/${item.lesson_id}`)} label={`Open redo for ${item.lesson_title}`}><View style={styles.row}><View style={styles.redoIcon}><RotateCcw color={palette.rubySoft} size={18} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{item.lesson_title}</Text><Text style={styles.cardMeta}>{item.content_block_title}</Text>{item.feedback && <Text numberOfLines={3} style={styles.feedback}>{item.feedback}</Text>}</View><ArrowRight color={palette.quiet} size={18} /></View></LearningCard>)}</View></View>}

        {!!dashboard.recently_graded?.length && <View style={styles.section}><SectionHeading eyebrow="Instructor feedback" title="Recently graded" /><View style={styles.stack}>{dashboard.recently_graded.map((item) => <LearningCard key={item.submission_id} onPress={() => router.push(`/lesson/${item.lesson_id}`)} label={`Review feedback for ${item.lesson_title}`}><View style={styles.row}><View style={styles.gradeIcon}><BadgeCheck color={palette.success} size={19} /></View><View style={styles.flex}><View style={styles.gradeRow}><Text style={styles.cardTitle}>{item.lesson_title}</Text><Text style={styles.grade}>{item.grade}</Text></View><Text style={styles.cardMeta}>{item.content_block_title}</Text>{item.feedback && <Text numberOfLines={3} style={styles.feedback}>{item.feedback}</Text>}</View><ArrowRight color={palette.quiet} size={18} /></View></LearningCard>)}</View></View>}

        {!!dashboard.cohort?.announcements?.length && <View style={styles.section}><SectionHeading eyebrow="Class updates" title="Announcements" actionLabel="View all" onAction={() => router.push('/updates')} /><View style={styles.stack}>{dashboard.cohort.announcements.slice(0, 2).map((announcement) => <LearningCard key={announcement.id} onPress={() => router.push('/updates')} label={`Open announcement: ${announcement.title}`}><View style={styles.row}><View style={styles.announcementIcon}><Megaphone color={palette.rubySoft} size={18} /></View><View style={styles.flex}><Text style={styles.cardTitle}>{announcement.title}</Text><Text numberOfLines={3} style={styles.announcementBody}>{announcement.body}</Text></View>{!announcement.read_at && <View style={styles.unreadDot} />}</View></LearningCard>)}</View></View>}

        <View style={styles.section}><SectionHeading title="Stay connected" /><View style={styles.quickGrid}><QuickAction icon={MessageSquare} label="Messages" onPress={() => router.push('/messages')} /><QuickAction icon={Megaphone} label={dashboard.cohort?.unread_notifications_count ? `${dashboard.cohort.unread_notifications_count} updates` : 'Updates'} onPress={() => router.push('/updates')} /></View></View>

        {!!dashboard.office_hours?.length && <View style={styles.section}><SectionHeading eyebrow="Coming up" title="Office hours" /><LearningCard onPress={dashboard.office_hours[0].meeting_url ? () => void openExternalPage(dashboard.office_hours![0].meeting_url).catch((error) => Alert.alert('Could not open office hours', (error as Error).message)) : undefined} label={dashboard.office_hours[0].meeting_url ? `Join ${dashboard.office_hours[0].title || 'office hours'}` : undefined}><View style={styles.row}><CalendarClock color={palette.rubySoft} size={21} /><View style={styles.flex}><Text style={styles.cardTitle}>{dashboard.office_hours[0].title || 'Office hours'}</Text><Text style={styles.cardMeta}>{formatOfficeHours(dashboard.office_hours[0])}</Text></View>{dashboard.office_hours[0].meeting_url && <ArrowRight color={palette.quiet} size={18} />}</View></LearningCard></View>}
      </ScrollView>
    </SafeAreaView>
  );
}

function QuickAction({ icon: Icon, label, onPress }: { icon: LucideIcon; label: string; onPress: () => void }) { return <LearningCard onPress={onPress} label={label}><Icon color={palette.rubySoft} size={21} /><Text style={styles.quickLabel}>{label}</Text></LearningCard>; }
function firstName(value: string) { return value.trim().split(/\s+/)[0] || 'there'; }
function dayPart() { const hour = new Date().getHours(); return hour < 12 ? 'morning' : hour < 17 ? 'afternoon' : 'evening'; }
function formatOfficeHours(value: { starts_at?: string; start_time?: string; location?: string | null }) { const raw = value.starts_at || value.start_time; if (!raw) return value.location || 'Schedule available in your cohort'; const date = new Date(raw); return `${new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)}${value.location ? ` · ${value.location}` : ''}`; }

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, content: { padding: 20, paddingBottom: 120, gap: 16 },
  offline: { minHeight: 36, borderRadius: 12, backgroundColor: '#2A2115', justifyContent: 'center', paddingHorizontal: 12, marginBottom: 2 }, offlineText: { color: palette.warning, fontFamily: fonts.semibold, fontSize: 10 },
  eyebrow: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 10, letterSpacing: 1.8, marginTop: 8 }, heroTitle: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 32, letterSpacing: -1.1, marginTop: -8 }, heroCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, marginTop: -9, marginBottom: 4 },
  cardTop: { flexDirection: 'row', alignItems: 'center', gap: 12 }, continueIcon: { width: 44, height: 44, borderRadius: 14, backgroundColor: '#2A151B', alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, cardKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 8, letterSpacing: 1 }, cardTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 }, cardMeta: { color: palette.quiet, fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, marginTop: 2 }, progressCopy: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 18, marginBottom: 7 }, progressLabel: { color: palette.muted, fontFamily: fonts.semibold, fontSize: 10 }, progressValue: { color: palette.text, fontFamily: fonts.bold, fontSize: 10 },
  section: { gap: 12, marginTop: 10 }, stack: { gap: 9 }, row: { flexDirection: 'row', alignItems: 'center', gap: 12 }, redoIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#32161D', alignItems: 'center', justifyContent: 'center' }, gradeIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#10271F', alignItems: 'center', justifyContent: 'center' }, gradeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }, grade: { color: palette.success, fontFamily: fonts.extraBold, fontSize: 12 }, feedback: { color: '#D7D9E0', fontFamily: fonts.regular, fontSize: 11, lineHeight: 17, marginTop: 8 }, announcementIcon: { width: 38, height: 38, borderRadius: 12, backgroundColor: '#32161D', alignItems: 'center', justifyContent: 'center' }, announcementBody: { color: palette.muted, fontFamily: fonts.regular, fontSize: 10, lineHeight: 15, marginTop: 4 }, unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.rubySoft },
  quickGrid: { flexDirection: 'row', gap: 10 }, quickLabel: { color: palette.text, fontFamily: fonts.bold, fontSize: 12, marginTop: 10 }, staffMetric: { flexDirection: 'row', alignItems: 'center', gap: 14 }, metricValue: { color: palette.text, fontFamily: fonts.extraBold, fontSize: 24 }, metricLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 }, emptyTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 19, marginTop: 15 }, emptyCopy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 },
});
