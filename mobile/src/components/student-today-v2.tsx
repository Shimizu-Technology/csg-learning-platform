import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import {
  ArrowRight,
  Award,
  BookOpen,
  CalendarClock,
  ChevronRight,
  ClipboardCheck,
  Clock3,
  Compass,
  HelpCircle,
  MessageSquare,
  RotateCcw,
  Sparkles,
  Target,
} from 'lucide-react-native';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from './avatar';
import { ClosedWorkRecovery } from './closed-work-recovery';
import { LearningCard, ProgressBar, SectionHeading } from './learning-ui';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { PressableScale } from './ui/pressable-scale';
import { fonts, tabularNums } from '@/constants/csg-theme';
import { themedAlert as Alert } from '@/lib/alerts';
import { brand } from '@/lib/brand';
import { formatCourseDate, formatCourseDateTime } from '@/lib/course-time';
import { openExternalPage, openWebTask } from '@/lib/external-links';
import { haptic } from '@/lib/haptics';
import { markdownExcerpt } from '@/lib/plain-text';
import type { StudentDashboard } from '@/lib/types';
import { useSession } from '@/providers/session-provider';
import { makeStyles, useTheme } from '@/providers/theme-provider';

export function StudentTodayV2({ dashboard, githubApp, refresh }: { dashboard: StudentDashboard; githubApp: boolean; refresh: () => void }) {
  const router = useRouter();
  const { api, enrollments, user } = useSession();
  const { colors: c } = useTheme();
  const styles = useStyles();
  const today = dashboard.student_today!;
  const cohortId = dashboard.cohort!.id;
  const enrollmentId = enrollments?.find((item) => item.cohort.id === cohortId)?.id;
  const binding = useQuery({
    queryKey: ['github-bindings', user?.id, enrollmentId],
    queryFn: ({ signal }) => api.githubBindings(enrollmentId!, signal),
    enabled: githubApp && Boolean(enrollmentId && today.first_run),
  });
  const pace = today.personal_pace;
  const savePace = useMutation({
    mutationFn: (weeks: number) => api.choosePace(pace!.enrollment_id, weeks),
    onSuccess: () => {
      haptic('success');
      refresh();
    },
    onError: () => Alert.alert('Could not save your pace', 'Try again in a moment.'),
  });
  const completion = today.course_completion;
  const next = today.next_lesson;
  const counts = today.counts;
  const coursePercent = counts && counts.total_lessons > 0 ? Math.round((counts.completed_lessons / counts.total_lessons) * 100) : null;
  const openLesson = (id: number, blockId?: number, helpId?: number) =>
    router.push({
      pathname: '/lesson/[id]',
      params: {
        id: String(id),
        cohort_id: String(cohortId),
        ...(blockId ? { block_id: String(blockId) } : {}),
        ...(helpId ? { help_request: String(helpId) } : {}),
      },
    });
  const messageInstructor = async () => {
    if (!today.contact) return;
    try {
      const result = await api.createCohortDm(cohortId, [today.contact.id]);
      router.push({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(result.direct_conversation.id) } });
    } catch {
      Alert.alert('Could not open your conversation', 'Try again in a moment.');
    }
  };

  const paceChosen = pace?.plan_source === 'learner_pace' && pace.weeks != null;
  const [showAllCatchUp, setShowAllCatchUp] = useState(false);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const needsYouItems = today.needs_you?.items ?? [];
  const waitingItems = today.waiting?.items ?? [];
  const questionItems = today.questions?.items ?? [];
  const catchUp = today.catch_up_plan;
  const visibleCatchUpItems = catchUp ? (showAllCatchUp ? catchUp.items : catchUp.items.slice(0, 5)) : [];
  const visibleQuestionItems = showAllQuestions ? questionItems : questionItems.slice(0, 5);
  const thisWeek = today.this_week;
  const nextSession = today.next_session;
  const instructor = today.contact || today.reviewer;

  return (
    <View style={styles.root}>
      {today.first_run && (
        <LearningCard>
          <View style={styles.rowHeader}>
            <View style={styles.iconTile}>
              <Sparkles color={c.selection.indicator} size={18} />
            </View>
            <View style={styles.flex}>
              <SectionHeading title="Welcome to your course" />
            </View>
          </View>
          <Text style={styles.body}>
            Start in Learn, hand in your work as you go, and return here for feedback and your next lesson.
          </Text>
          {githubApp && !binding.isSuccess && (
            <Text style={styles.meta}>
              {binding.isFetching ? 'Checking GitHub connection…' : 'GitHub connection status unavailable.'}
            </Text>
          )}
          {githubApp && binding.isSuccess && !binding.data.bindings.some((item) => item.verification_state === 'verified') && (
            <Button
              label="Connect GitHub"
              variant="secondary"
              size="sm"
              onPress={() =>
                void openWebTask(api, `/profile#github-repository-${cohortId}`)
                  .then(() => binding.refetch())
                  .catch(() => Alert.alert('Could not open GitHub setup'))
              }
            />
          )}
        </LearningCard>
      )}

      {pace?.available && pace.status === 'not_chosen' && (
        <LearningCard>
          <View style={styles.rowHeader}>
            <View style={styles.iconTile}>
              <Compass color={c.text.strong} size={18} />
            </View>
            <View style={styles.flex}>
              <SectionHeading title="Choose your pace" />
            </View>
          </View>
          <Text style={styles.body}>Pick how many weeks you want to spend on the course.</Text>
          <View style={styles.choiceList}>
            {pace.choices.map((choice) => (
              <Button
                key={choice.weeks}
                variant="secondary"
                size="sm"
                label={`${choice.weeks} weeks · finish ${choice.ends_on}`}
                disabled={savePace.isPending}
                onPress={() => {
                  haptic('selection');
                  savePace.mutate(choice.weeks);
                }}
              />
            ))}
          </View>
        </LearningCard>
      )}

      {completion?.all_work_handed_in && (
        <LearningCard>
          <View style={styles.rowHeader}>
            <View style={[styles.iconTile, styles.successTile]}>
              <Award color={c.status.success.fg} size={20} />
            </View>
            <View style={styles.flex}>
              <SectionHeading title={completion.course_completed ? 'Course completed' : 'All work handed in'} />
              <Text style={styles.meta}>
                {completion.course_completed
                  ? 'Every required lesson is complete and reviewed.'
                  : 'Your instructor is finishing the last review.'}
              </Text>
            </View>
          </View>
          {completion.certificate && !completion.certificate.revoked && (
            <Button
              label="View certificate"
              onPress={() =>
                void openExternalPage(`${brand.appUrl}/certificates/${encodeURIComponent(completion.certificate!.code)}`).catch(() =>
                  Alert.alert('Could not open certificate'),
                )
              }
            />
          )}
        </LearningCard>
      )}

      {next && (
        <LearningCard>
          <View style={styles.heroTop}>
            <View style={[styles.iconTile, next.status === 'redo' && styles.warningTile]}>
              {next.status === 'redo' ? (
                <RotateCcw color={c.status.warning.fg} size={19} />
              ) : (
                <BookOpen color={c.selection.indicator} size={19} />
              )}
            </View>
            <View style={styles.flex}>
              <View style={styles.badgeRow}>
                {next.status === 'redo' ? (
                  <Badge label="Redo requested" tone="warning" />
                ) : (
                  <Text style={styles.heroKicker}>
                    {[next.module_name, next.week ? `Week ${next.week}` : null].filter(Boolean).join(' · ') || 'Next lesson'}
                  </Text>
                )}
              </View>
              <Text accessibilityRole="header" style={styles.heroTitle}>{next.title}</Text>
            </View>
          </View>
          {coursePercent !== null && counts && (
            <View style={styles.progressBlock}>
              <View style={styles.progressHeader}>
                <Text style={styles.meta}>
                  {counts.completed_lessons} of {counts.total_lessons} lessons completed
                </Text>
                <Text style={styles.progressPercent}>{coursePercent}%</Text>
              </View>
              <ProgressBar value={coursePercent} label="Course progress" />
            </View>
          )}
          <Button
            label={next.status === 'redo' ? 'Fix your redo' : 'Continue'}
            onPress={() => openLesson(next.id)}
          />
        </LearningCard>
      )}

      {pace?.available && paceChosen && (
        <LearningCard>
          <View style={styles.rowHeader}>
            <View style={[styles.iconTile, pace.status === 'behind' && styles.warningTile]}>
              <Target color={pace.status === 'behind' ? c.status.warning.fg : c.text.strong} size={18} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.rowTitle}>{pace.weeks}-week personal pace</Text>
              <Text style={styles.meta}>
                {pace.ends_on ? `Target finish ${formatCourseDate(pace.ends_on, { withYear: true, fallback: pace.ends_on })}` : 'Active pace'}
                {pace.status === 'behind' && pace.weeks_behind ? ` · ${pace.weeks_behind} ${pace.weeks_behind === 1 ? 'week' : 'weeks'} behind` : ''}
              </Text>
            </View>
            {pace.status === 'behind' && <Badge label="Behind pace" tone="warning" />}
          </View>
        </LearningCard>
      )}

      <ClosedWorkRecovery dashboard={dashboard} />

      {catchUp && (
        <LearningCard>
          <SectionHeading title={catchUp.title || 'Catch-up plan'} />
          <Text style={styles.meta}>
            {catchUp.remaining_count} {catchUp.remaining_count === 1 ? 'lesson' : 'lessons'} left
            {catchUp.target_date ? ` · target ${formatCourseDate(catchUp.target_date, { withYear: false, weekday: true })}` : ''}
          </Text>
          {catchUp.items.length > 0 && (
            <View style={styles.list}>
              {visibleCatchUpItems.map((item, idx) => (
                <PressableScale
                  key={item.lesson_id}
                  disabled={!item.available}
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${item.title}`}
                  onPress={() => openLesson(item.lesson_id)}
                  style={[styles.listRow, idx > 0 && styles.rowDivider]}
                >
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{item.title}</Text>
                    {!!item.due_on && (
                      <Text style={styles.meta}>
                        Target {formatCourseDate(item.due_on, { withYear: false, weekday: true })}
                      </Text>
                    )}
                  </View>
                  {item.available && <ChevronRight color={c.text.muted} size={18} />}
                </PressableScale>
              ))}
              {catchUp.items.length > 5 && (
                <Button
                  variant="quiet"
                  size="sm"
                  label={showAllCatchUp ? 'Show fewer' : `Show all (${catchUp.items.length})`}
                  onPress={() => setShowAllCatchUp((v) => !v)}
                />
              )}
            </View>
          )}
        </LearningCard>
      )}

      {today.needs_you.count > 0 && (
        <LearningCard>
          <View style={styles.cardHeadingRow}>
            <SectionHeading title="Needs you" />
            <Badge label={String(today.needs_you.count)} tone="warning" />
          </View>
          <View style={styles.list}>
            {needsYouItems.map((item, idx) => {
              if (item.kind === 'redo') {
                return (
                  <PressableScale
                    key={`redo-${item.submission_id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Redo requested · ${item.lesson_title}`}
                    onPress={() => openLesson(item.lesson_id, item.content_block_id)}
                    style={[styles.listRow, idx > 0 && styles.rowDivider]}
                  >
                    <View style={[styles.smallIcon, styles.warningTile]}>
                      <RotateCcw color={c.status.warning.fg} size={16} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>Redo requested · {item.lesson_title}</Text>
                      <Text style={styles.meta}>
                        {[item.block_title !== item.lesson_title ? item.block_title : null, item.grader?.full_name ? `from ${item.grader.full_name}` : null].filter(Boolean).join(' · ') || 'Update and resubmit'}
                      </Text>
                      {!!item.feedback && (
                        <Text numberOfLines={2} style={styles.excerpt}>{markdownExcerpt(item.feedback, 120)}</Text>
                      )}
                    </View>
                    <ChevronRight color={c.text.muted} size={18} />
                  </PressableScale>
                );
              }
              if (item.kind === 'message') {
                return (
                  <PressableScale
                    key={`message-${item.message_id}`}
                    accessibilityRole="button"
                    accessibilityLabel={`Message from ${item.author.full_name}`}
                    onPress={() => router.push(`/conversation/dm/${item.direct_conversation_id}?message_id=${item.message_id}` as Href)}
                    style={[styles.listRow, idx > 0 && styles.rowDivider]}
                  >
                    <View style={[styles.smallIcon, styles.infoTile]}>
                      <MessageSquare color={c.status.info.fg} size={16} />
                    </View>
                    <View style={styles.flex}>
                      <Text style={styles.rowTitle}>Message from {item.author.full_name}</Text>
                      {!!item.excerpt && <Text numberOfLines={2} style={styles.excerpt}>{item.excerpt}</Text>}
                    </View>
                    <ChevronRight color={c.text.muted} size={18} />
                  </PressableScale>
                );
              }
              const lesson = /^\/lessons\/(\d+)(?:[?#]|$)/.exec(item.path);
              const block = /#block-(\d+)$/.exec(item.path);
              return (
                <PressableScale
                  key={`help-${item.help_request_id}`}
                  accessibilityRole="button"
                  accessibilityLabel={`Help reply · ${item.context_label}`}
                  onPress={() =>
                    lesson
                      ? openLesson(Number(lesson[1]), block ? Number(block[1]) : undefined, item.help_request_id)
                      : void openWebTask(api, item.path).catch(() => Alert.alert('Could not open help reply'))
                  }
                  style={[styles.listRow, idx > 0 && styles.rowDivider]}
                >
                  <View style={[styles.smallIcon, styles.infoTile]}>
                    <HelpCircle color={c.status.info.fg} size={16} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>Help reply · {item.context_label}</Text>
                    {!!item.excerpt && <Text numberOfLines={2} style={styles.excerpt}>{item.excerpt}</Text>}
                  </View>
                  <ChevronRight color={c.text.muted} size={18} />
                </PressableScale>
              );
            })}
          </View>
        </LearningCard>
      )}

      {questionItems.length > 0 && (
        <LearningCard>
          <View style={styles.cardHeadingRow}>
            <SectionHeading title="Your questions" />
            <Badge label={String(today.questions.count)} tone="pending" />
          </View>
          <View style={styles.list}>
            {visibleQuestionItems.map((q, idx) => {
              const lesson = /^\/lessons\/(\d+)(?:[?#]|$)/.exec(q.path);
              const block = /#block-(\d+)$/.exec(q.path);
              return (
                <PressableScale
                  key={q.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Open question on ${q.context_label}`}
                  onPress={() =>
                    lesson
                      ? openLesson(Number(lesson[1]), block ? Number(block[1]) : undefined, q.id)
                      : void openWebTask(api, q.path).catch(() => Alert.alert('Could not open question'))
                  }
                  style={[styles.listRow, idx > 0 && styles.rowDivider]}
                >
                  <View style={styles.smallIcon}>
                    <HelpCircle color={c.text.body} size={16} />
                  </View>
                  <View style={styles.flex}>
                    <Text style={styles.rowTitle}>{q.context_label}</Text>
                    {!!q.message && <Text numberOfLines={2} style={styles.excerpt}>{q.message}</Text>}
                  </View>
                  <ChevronRight color={c.text.muted} size={18} />
                </PressableScale>
              );
            })}
            {questionItems.length > 5 && (
              <Button
                variant="quiet"
                size="sm"
                label={showAllQuestions ? 'Show fewer' : `Show all (${questionItems.length})`}
                onPress={() => setShowAllQuestions((v) => !v)}
              />
            )}
          </View>
        </LearningCard>
      )}

      {today.waiting.count > 0 && (
        <LearningCard>
          <View style={styles.cardHeadingRow}>
            <SectionHeading title="Waiting on your instructor" />
            <Badge label={String(today.waiting.count)} tone="pending" />
          </View>
          <Text style={styles.meta}>
            {today.waiting.count} waiting for review{today.review_response_time ? ` · ${today.review_response_time}` : ''}
          </Text>
          <View style={styles.list}>
            {waitingItems.map((item, idx) => (
              <PressableScale
                key={item.submission_id}
                accessibilityRole="button"
                accessibilityLabel={item.lesson_title}
                onPress={() => openLesson(item.lesson_id, item.content_block_id)}
                style={[styles.listRow, idx > 0 && styles.rowDivider]}
              >
                <View style={styles.smallIcon}>
                  <Clock3 color={c.text.body} size={16} />
                </View>
                <View style={styles.flex}>
                  <Text style={styles.rowTitle}>{item.lesson_title}</Text>
                  <Text style={styles.meta}>
                    {item.expected_review_on
                      ? `Feedback expected by ${formatCourseDate(item.expected_review_on, { withYear: false, weekday: true })}`
                      : item.block_title}
                  </Text>
                </View>
                <ChevronRight color={c.text.muted} size={18} />
              </PressableScale>
            ))}
          </View>
        </LearningCard>
      )}

      {nextSession && (
        <LearningCard
          onPress={
            nextSession.meeting_url
              ? () => void openExternalPage(nextSession.meeting_url!).catch((error) => Alert.alert('Could not open session', (error as Error).message))
              : undefined
          }
          label={nextSession.meeting_url ? `Join ${nextSession.title || 'session'}` : undefined}
        >
          <View style={styles.rowHeader}>
            <View style={[styles.iconTile, styles.infoTile]}>
              <CalendarClock color={c.status.info.fg} size={18} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.heroKicker}>Next live session</Text>
              <Text style={styles.rowTitle}>{nextSession.title || 'Live class'}</Text>
              <Text style={styles.meta}>
                {formatCourseDateTime(nextSession.starts_at, { weekday: true, fallback: nextSession.starts_at })}
              </Text>
            </View>
            {nextSession.meeting_url && <ArrowRight color={c.text.muted} size={18} />}
          </View>
        </LearningCard>
      )}

      {thisWeek && thisWeek.total > 0 && (
        <LearningCard onPress={() => router.push('/learn' as Href)} label="Open this week in Learn">
          <View style={styles.rowHeader}>
            <View style={styles.flex}>
              <Text style={styles.heroKicker}>This week</Text>
              <Text style={styles.weekFraction}>
                {thisWeek.completed} of {thisWeek.total}
              </Text>
              <Text style={styles.meta}>
                Required lessons · week ends {formatCourseDate(thisWeek.ends_on, { withYear: false, weekday: true })}
              </Text>
            </View>
            <ChevronRight color={c.text.muted} size={18} />
          </View>
        </LearningCard>
      )}

      <LearningCard onPress={() => router.push(`/my-work?cohort_id=${cohortId}` as Href)} label="My work">
        <View style={styles.rowHeader}>
          <View style={styles.iconTile}>
            <ClipboardCheck color={c.text.strong} size={18} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.rowTitle}>My work</Text>
            <Text style={styles.meta}>Submissions, redos, and instructor feedback</Text>
          </View>
          <ChevronRight color={c.text.muted} size={18} />
        </View>
      </LearningCard>

      {instructor && (
        <LearningCard>
          <View style={styles.rowHeader}>
            <Avatar name={instructor.full_name} size={42} />
            <View style={styles.flex}>
              <Text style={styles.heroKicker}>Your instructor</Text>
              <Text style={styles.rowTitle}>{instructor.full_name}</Text>
            </View>
          </View>
          {today.contact && (
            <Button variant="secondary" size="sm" label="Message your instructor" onPress={() => void messageInstructor()} />
          )}
        </LearningCard>
      )}
    </View>
  );
}

const useStyles = makeStyles(({ colors: c, radius }) => StyleSheet.create({
  root: { gap: 14 },
  flex: { flex: 1, minWidth: 0 },
  rowHeader: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardHeadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  heroTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  badgeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  heroKicker: { color: c.text.muted, fontFamily: fonts.semibold, fontSize: 12 },
  heroTitle: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 19, lineHeight: 25, letterSpacing: -0.3 },
  body: { color: c.text.body, fontFamily: fonts.regular, fontSize: 15, lineHeight: 22 },
  meta: { ...tabularNums, color: c.text.muted, fontFamily: fonts.medium, fontSize: 13, lineHeight: 18, marginTop: 2 },
  excerpt: { color: c.text.body, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, marginTop: 4 },
  iconTile: { width: 40, height: 40, borderRadius: radius.control, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center' },
  smallIcon: { width: 34, height: 34, borderRadius: radius.control, backgroundColor: c.surface.sunken, alignItems: 'center', justifyContent: 'center', marginTop: 2 },
  warningTile: { backgroundColor: c.status.warning.bg },
  successTile: { backgroundColor: c.status.success.bg },
  infoTile: { backgroundColor: c.status.info.bg },
  progressBlock: { gap: 6 },
  progressHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  progressPercent: { ...tabularNums, color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 },
  choiceList: { gap: 8 },
  list: { marginTop: 2 },
  listRow: { minHeight: 54, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: c.border.subtle },
  rowTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 15, lineHeight: 21 },
  weekFraction: { ...tabularNums, color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 22, letterSpacing: -0.4, marginTop: 2 },
}));
