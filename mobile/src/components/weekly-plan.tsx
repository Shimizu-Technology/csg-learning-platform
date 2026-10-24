import { PressableScale as Pressable } from '@/components/ui/pressable-scale';
import { themedAlert as Alert } from '@/lib/alerts';
import { makeStyles, useTheme } from '@/providers/theme-provider';
import { useRouter } from 'expo-router';
import { ArrowRight, BookOpen, CalendarClock, Check, ClipboardList, Film, LockKeyhole, RotateCcw, Sparkles, type LucideIcon } from 'lucide-react-native';
import { useEffect, useState, useRef, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { fontScaleLimits, fonts } from '@/constants/csg-theme';
import { captureProductEvent } from '@/lib/analytics';
import { formatCourseDate, formatCourseDateTime, formatCourseWeekdayTime } from '@/lib/course-time';
import { openExternalPage } from '@/lib/external-links';
import { weeklyItemStatus, type LearnerStatus } from '@/lib/learning-status';
import { webLessonUrl } from '@/lib/hafa-starter-links';
import { markdownExcerpt } from '@/lib/plain-text';
import { CourseSupportAction } from './course-support-action';
import { StatusBadge, StatusIcon } from './learning-ui';
import type { WeeklyPlan, WeeklyPlanLessonItem } from '@/lib/types';

export function WeeklyPlanCard({ plan }: { plan: WeeklyPlan }) {
  const styles = useStyles();
  return <View style={styles.planStack}>{plan.enrolled && plan.personal_plan && <PersonalPlan plan={plan} />}<RegularWeeklyPlanCard plan={plan} /></View>;
}

function RegularWeeklyPlanCard({ plan }: { plan: WeeklyPlan }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const router = useRouter();
  const capturedKey = useRef<string | null>(null);
  const summary = plan.summary;
  const key = `${plan.cohort?.id}:${plan.week_number}`;

  useEffect(() => {
    if (!plan.enrolled || !plan.cohort || !plan.week_number || !summary || capturedKey.current === key) return;
    capturedKey.current = key;
    captureProductEvent('weekly_plan_viewed', { cohort_id: plan.cohort.id, week_number: plan.week_number, role: 'student', required_count: summary.required_count });
  }, [key, plan.cohort, plan.enrolled, plan.week_number, summary]);

  if (!plan.enrolled) return null;
  if (plan.personal_plan) return <PersonalPlanExtras plan={plan} />;
  if (plan.plan_kind === 'self_paced') return <SelfPacedPlan plan={plan} />;
  if (plan.mode === 'library' && plan.library_summary) return <LibraryPlan plan={plan} />;
  if (!summary) return null;
  const hasRequired = summary.required_count > 0;
  // Never claim 100% of nothing: with no required work there is no bar at all.
  const completion = hasRequired ? Math.round((summary.required_completed_count / summary.required_count) * 100) : 0;
  const awaitingReview = (plan.required || []).filter((item) => weeklyItemStatus(item) === 'awaiting_review').length;
  const openLesson = (lessonId: number, blockId?: number) => router.push(`/lesson/${lessonId}?cohort_id=${plan.cohort!.id}${blockId ? `&block_id=${blockId}` : ''}`);

  return <View style={styles.shell}>
    <View style={styles.header}><Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>WEEK {plan.week_number}</Text><Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heading}>This Week</Text><Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.headerCopy}>{weekRange(plan.starts_on, plan.ends_on)} · required work stays clear when you work ahead.</Text>{hasRequired ? <><View style={styles.progressCopy}><Text style={styles.progressText}>{summary.required_completed_count} of {summary.required_count} required submitted or done</Text><Text style={styles.progressText}>{completion}%</Text></View><View accessibilityLabel={`${completion}% of required weekly work submitted or done`} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: completion }} style={styles.track}><View style={[styles.fill, { width: `${completion}%` }]} /></View>{awaitingReview > 0 && <View style={styles.awaitingLine}><StatusIcon status="awaiting_review" size={14} color={c.text.body} /><Text style={styles.awaitingText}>{awaitingReview} awaiting your instructor’s review</Text></View>}</> : <Text style={[styles.progressText, styles.noRequired]}>No required work is scheduled this week.</Text>}</View>

    {!!plan.redos?.length && <PlanSection icon={RotateCcw} title="Redo first" tone="warning">{plan.redos.map((redo) => <PlanRow key={redo.id} icon={RotateCcw} title={redo.title} meta={`${redo.lesson_title}${redo.state === 'closed' ? ' · window closed' : ''}`} excerpt={markdownExcerpt(redo.feedback, 140)} status="redo" onPress={() => openLesson(redo.lesson_id, redo.content_block_id)} tone="warning" />)}</PlanSection>}
    <PlanSection icon={ClipboardList} title="Required work">{plan.required?.length ? <LessonGroups items={plan.required} onOpen={openLesson} /> : <EmptyLine text="No required work is open this week." />}</PlanSection>
    {!!plan.optional?.length && <PlanSection icon={Sparkles} title="Optional stretch" subtle><Text style={styles.sectionCopy}>Useful if you finish early; it does not count against the required week.</Text><LessonGroups items={plan.optional} onOpen={openLesson} /></PlanSection>}
    {!!plan.events?.length && <PlanSection icon={CalendarClock} title="Live schedule">{plan.events.map((event) => <PlanRow key={event.id} icon={CalendarClock} title={event.title} meta={`${event.kind === 'live_class' ? 'Live class' : 'Office hours'} · ${formatCourseWeekdayTime(event.starts_at)}`} onPress={() => void openExternalPage(event.meeting_url).catch((error) => Alert.alert('Could not open session', (error as Error).message))} />)}</PlanSection>}
    {!!plan.recording_catch_up?.length && <PlanSection icon={Film} title="Recording catch-up">{plan.recording_catch_up.map((recording) => <PlanRow key={recording.id} icon={Film} title={recording.title} meta={`${Math.round(recording.progress_percentage)}% watched`} onPress={() => router.push(`/recording/${recording.recording_id}${recording.cohort_id ? `?cohort_id=${recording.cohort_id}` : ''}`)} />)}</PlanSection>}
    {!!plan.upcoming_unlocks?.length && <PlanSection icon={LockKeyhole} title="Unlocking next">{plan.upcoming_unlocks.slice(0, 3).map((unlock) => <PlanRow key={unlock.id} icon={LockKeyhole} title={unlock.title} meta={`${unlock.module_title} · ${dateLabel(unlock.unlocks_on)}`} />)}</PlanSection>}
  </View>;
}

function PersonalPlan({ plan }: { plan: WeeklyPlan }) {
  const styles = useStyles();
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const personal = plan.personal_plan!;
  const current = personal.milestones.find((milestone) => milestone.lessons.some((lesson) => lesson.required && !lesson.completed));
  const milestones = expanded ? personal.milestones : current ? [current] : [];
  return <View accessibilityLabel="Your personal learning plan" style={styles.shell}>
    <View style={styles.header}>
      <Text style={styles.eyebrow}>YOUR PERSONAL PLAN</Text>
      <Text accessibilityRole="header" style={styles.heading}>{personal.title}</Text>
      {!!personal.description && <Text style={styles.headerCopy}>{personal.description}</Text>}
      {!!personal.target_date && <Text style={styles.headerCopy}>Target finish: {dateLabel(personal.target_date)}</Text>}
      {!!personal.next_check_in_on && <Text style={styles.headerCopy}>Next check-in: {dateLabel(personal.next_check_in_on)}</Text>}
      <Text style={styles.headerCopy}>{personal.completed_count} of {personal.required_count} required lessons done or submitted. {personal.awaiting_review_count > 0 ? `${personal.awaiting_review_count} awaiting instructor review.` : ''}</Text>
    </View>
    {milestones.map((milestone) => <PlanSection key={milestone.title + milestone.due_on} icon={CalendarClock} title={milestone.title}>
      <Text style={styles.sectionCopy}>Target {dateLabel(milestone.due_on)} · {milestone.completed_count}/{milestone.required_count} required done or submitted</Text>
      {milestone.lessons.map((lesson) => <PlanRow key={lesson.lesson_id} title={lesson.title} meta={`${lesson.required ? 'Required' : 'Optional'}${!lesson.available ? ' · Not open yet' : ''}`} status={lesson.review_status === 'redo_requested' ? 'redo' : lesson.review_status === 'awaiting_review' ? 'awaiting_review' : lesson.completed ? 'done' : 'open'} onPress={lesson.available ? () => router.push(`/lesson/${lesson.lesson_id}?cohort_id=${plan.cohort!.id}`) : undefined} />)}
    </PlanSection>)}
    {!!personal.submission_deadlines?.length && <PlanSection icon={CalendarClock} title="Submission deadlines"><Text style={styles.sectionCopy}>Milestone targets do not extend submission windows.</Text>{personal.submission_deadlines.map((deadline) => <PlanRow key={deadline.lesson_id} title={deadline.title} meta={`${deadline.closed ? 'Submissions closed' : 'Submissions close'}${deadline.closes_at ? ` · ${formatCourseDateTime(deadline.closes_at, { weekday: true })}` : ''}`} onPress={() => router.push(`/lesson/${deadline.lesson_id}?cohort_id=${plan.cohort!.id}`)} />)}</PlanSection>}
    <Pressable accessibilityRole="button" onPress={() => router.push('/learn')} style={styles.section}><Text style={styles.sectionTitle}>Browse all lessons and optional resources</Text></Pressable>
    {!!personal.milestones.length && <Pressable accessibilityRole="button" accessibilityState={{ expanded }} onPress={() => setExpanded(!expanded)} style={styles.section}><Text style={styles.sectionTitle}>{expanded ? 'Show current milestone' : 'Show all milestones'}</Text></Pressable>}
    {!!personal.requirement_changes.length && <PlanSection icon={Sparkles} title="What’s different in your plan">{personal.requirement_changes.map((change) => <View key={change.lesson_id}><Text style={styles.rowTitle}>{change.title} · {change.required ? 'Required' : 'Optional'}</Text><Text style={styles.sectionCopy}>{change.reason}</Text></View>)}</PlanSection>}
    <View style={styles.section}><Text style={styles.sectionCopy}>Target dates guide your pace. Other assigned lessons and optional resources remain in Learn. Done or submitted work may still need instructor review.</Text></View>
  </View>;
}

function PersonalPlanExtras({ plan }: { plan: WeeklyPlan }) {
  const styles = useStyles();
  const router = useRouter();
  const openLesson = (id: number, block?: number) => router.push(`/lesson/${id}?cohort_id=${plan.cohort!.id}${block ? `&block_id=${block}` : ''}`);
  if (!plan.redos?.length && !plan.events?.length && !plan.recording_catch_up?.length && plan.plan_kind !== 'self_paced') return null;
  return <View style={styles.shell}>
    {!!plan.redos?.length && <PlanSection icon={RotateCcw} title="Redo first" tone="warning">{plan.redos.map((redo) => <PlanRow key={redo.id} title={redo.title} meta={`${redo.lesson_title}${redo.state === 'closed' ? ' · window closed' : ''}`} excerpt={markdownExcerpt(redo.feedback, 140)} status="redo" onPress={() => openLesson(redo.lesson_id, redo.content_block_id)} />)}</PlanSection>}
    {!!plan.events?.length && <PlanSection icon={CalendarClock} title="Live schedule">{plan.events.map((event) => <PlanRow key={event.id} icon={CalendarClock} title={event.title} meta={formatCourseWeekdayTime(event.starts_at)} onPress={() => void openExternalPage(event.meeting_url).catch((error) => Alert.alert('Could not open session', (error as Error).message))} />)}</PlanSection>}
    {!!plan.recording_catch_up?.length && <PlanSection icon={Film} title="Recording catch-up">{plan.recording_catch_up.map((recording) => <PlanRow key={recording.id} icon={Film} title={recording.title} meta={`${Math.round(recording.progress_percentage)}% watched`} onPress={() => router.push(`/recording/${recording.recording_id}?cohort_id=${recording.cohort_id || plan.cohort!.id}`)} />)}</PlanSection>}
    {plan.plan_kind === 'self_paced' && <View style={styles.section}>
      {plan.capabilities?.read_only && <Text style={styles.headerCopy}>Past course · review only</Text>}
      {plan.capabilities?.access_expires_at && <Text style={styles.headerCopy}>Course access ends {formatCourseDate(plan.capabilities.access_expires_at, { withYear: true })}</Text>}
      {plan.capabilities?.support_expires_at && <Text style={styles.headerCopy}>Instructor support through {formatCourseDate(plan.capabilities.support_expires_at, { withYear: true })}</Text>}
    </View>}
    {plan.plan_kind === 'self_paced' && plan.cohort && <View style={styles.section}><CourseSupportAction capabilities={plan.capabilities} cohortId={plan.cohort.id} contextLabel={plan.personal_plan?.title || plan.cohort.name} /></View>}
  </View>;
}

function SelfPacedPlan({ plan }: { plan: WeeklyPlan }) {
  const styles = useStyles();
  const router = useRouter();
  const next = plan.course_overview?.next_lesson;
  return <View style={styles.shell}>
    <View style={styles.header}>
      <Text style={styles.eyebrow}>YOUR SELF-PACED COURSE</Text>
      <Text accessibilityRole="header" style={styles.heading}>{plan.course_overview?.course_name || plan.cohort?.name}</Text>
      {plan.capabilities?.read_only && <Text style={styles.headerCopy}>Past course · review only</Text>}
      <Text style={styles.headerCopy}>{plan.capabilities?.access_expires_at ? `Course access ends ${formatCourseDate(plan.capabilities.access_expires_at, { withYear: true })}` : 'No scheduled access end date'}</Text>
      {plan.capabilities?.support_expires_at && <Text style={styles.headerCopy}>Instructor support through {formatCourseDate(plan.capabilities.support_expires_at, { withYear: true })}</Text>}
      {next ? <PlanRow icon={BookOpen} title={next.title} meta="Next lesson" onPress={() => router.push(`/lesson/${next.lesson_id}?cohort_id=${plan.cohort!.id}`)} /> : <Text style={styles.headerCopy}>Review your course lessons at your own pace.</Text>}
      {plan.cohort && <CourseSupportAction capabilities={plan.capabilities} cohortId={plan.cohort.id} contextLabel={plan.course_overview?.course_name || plan.cohort.name} contextPath={next ? webLessonUrl(next.lesson_id, plan.cohort.id) : undefined} />}
    </View>
    {!!plan.redos?.length && <PlanSection icon={RotateCcw} title="Redo first" tone="warning">{plan.redos.map((redo) => <PlanRow key={redo.id} icon={RotateCcw} title={redo.title} meta={redo.lesson_title} excerpt={markdownExcerpt(redo.feedback, 140)} status="redo" onPress={() => router.push(`/lesson/${redo.lesson_id}?cohort_id=${plan.cohort!.id}${redo.content_block_id ? `&block_id=${redo.content_block_id}` : ''}`)} tone="warning" />)}</PlanSection>}
  </View>;
}

function LibraryPlan({ plan }: { plan: WeeklyPlan }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const router = useRouter();
  const library = plan.library_summary!;

  return <View style={styles.shell}>
    <View style={styles.header}>
      <Text maxFontSizeMultiplier={fontScaleLimits.utility} style={styles.eyebrow}>KEEP LEARNING AT YOUR PACE</Text>
      <Text accessibilityRole="header" maxFontSizeMultiplier={fontScaleLimits.display} style={styles.heading}>Alumni Learning Library</Text>
      <Text maxFontSizeMultiplier={fontScaleLimits.content} style={styles.headerCopy}>Revisit every CSG topic, watch current and past class recordings, and use the optional exercises and reference projects whenever they help.</Text>
      <Pressable accessibilityRole="button" accessibilityLabel="Browse the alumni learning library" onPress={() => router.push('/learn')} style={({ pressed }) => [styles.libraryButton, pressed && styles.pressed]}><BookOpen color={c.text.strong} size={17} /><Text style={styles.libraryButtonText}>Browse the library</Text><ArrowRight color={c.text.strong} size={17} /></Pressable>
    </View>
    <View style={styles.libraryStats}><LibraryStat value={library.module_count} label="Modules" /><LibraryStat value={library.lesson_count} label="Lessons" /><LibraryStat value={library.recording_count} label="Recorded lessons" /></View>
    {!!plan.events?.length && <PlanSection icon={CalendarClock} title="Upcoming sessions">{plan.events.map((event) => <PlanRow key={event.id} icon={CalendarClock} title={event.title} meta={`${event.kind === 'live_class' ? 'Live class' : 'Office hours'} · ${formatCourseDateTime(event.starts_at, { weekday: true })}`} onPress={() => void openExternalPage(event.meeting_url).catch((error) => Alert.alert('Could not open session', (error as Error).message))} />)}</PlanSection>}
    {!!plan.recording_catch_up?.length && <PlanSection icon={Film} title="Continue watching">{plan.recording_catch_up.map((recording) => <PlanRow key={recording.id} icon={Film} title={recording.title} meta={`${Math.round(recording.progress_percentage)}% watched`} onPress={() => router.push(`/recording/${recording.recording_id}${recording.cohort_id ? `?cohort_id=${recording.cohort_id}` : ''}`)} />)}</PlanSection>}
  </View>;
}

function LibraryStat({ value, label }: { value: number; label: string }) {
  const styles = useStyles(); return <View style={styles.libraryStat}><Text style={styles.libraryStatValue}>{value}</Text><Text style={styles.libraryStatLabel}>{label}</Text></View>; }

function LessonGroups({ items, onOpen }: { items: WeeklyPlanLessonItem[]; onOpen: (lessonId: number) => void }) {
  const styles = useStyles();
  return <>{groupLessons(items).map(([label, lessons]) => <View key={label} style={styles.lessonGroup}><Text style={styles.groupLabel}>{label}</Text>{lessons.map((item) => <LessonRow key={item.id} item={item} onPress={() => onOpen(item.lesson_id)} />)}</View>)}</>;
}

function LessonRow({ item, onPress }: { item: WeeklyPlanLessonItem; onPress: () => void }) {
  const status = weeklyItemStatus(item);
  return <PlanRow title={item.title} meta={`${item.module_title} · ${item.carried_forward ? 'Open from earlier' : dateLabel(item.scheduled_for)}${item.submission_close_at ? ` · closes ${formatCourseDateTime(item.submission_close_at, { weekday: true })}` : ''}`} status={status} onPress={onPress} />;
}

function PlanSection({ icon: Icon, title, children, tone, subtle }: { icon: LucideIcon; title: string; children: ReactNode; tone?: 'warning'; subtle?: boolean }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); return <View style={[styles.section, tone === 'warning' && styles.warningSection, subtle && styles.subtleSection]}><View style={styles.sectionHeading}><Icon color={tone === 'warning' ? c.status.warning.fg : c.text.body} size={17} /><Text style={[styles.sectionTitle, tone === 'warning' && styles.warningText]}>{title}</Text></View>{children}</View>; }
/** A plan row. Lesson rows show one truthful status (icon + chip); open work is a neutral circle, never an alert. */
function PlanRow({ icon: Icon, title, meta, excerpt, status, onPress, tone }: { icon?: LucideIcon; title: string; meta: string; excerpt?: string; status?: LearnerStatus; onPress?: () => void; tone?: 'warning' }) {
  const styles = useStyles();
  const { colors: c } = useTheme();
  const showChip = status && status !== 'open' && !tone;
  const content = <><View style={[styles.rowIcon, tone === 'warning' && styles.warningIcon, !Icon && styles.statusIcon]}>{Icon ? <Icon color={tone === 'warning' ? c.status.warning.fg : c.text.body} size={17} /> : status ? <StatusIcon status={status} size={17} color={status === 'open' ? c.text.body : undefined} /> : null}</View><View style={styles.flex}><Text style={styles.rowTitle}>{title}</Text><Text style={styles.rowMeta}>{meta}</Text>{!!excerpt && <Text numberOfLines={2} style={styles.rowExcerpt}>{excerpt}</Text>}{showChip && <View style={styles.rowChip}><StatusBadge status={status} short /></View>}</View>{onPress && <ArrowRight color={c.text.body} size={17} />}</>;
  return onPress ? <Pressable accessibilityRole="button" accessibilityLabel={`Open ${title}${status ? `, ${status === 'open' ? 'to do' : status.replace('_', ' ')}` : ''}`} onPress={onPress} style={({ pressed }) => [styles.row, pressed && styles.pressed]}>{content}</Pressable> : <View style={styles.row}>{content}</View>;
}
function EmptyLine({ text }: { text: string }) {
  const styles = useStyles();
  const { colors: c } = useTheme(); return <View style={styles.empty}><Check color={c.status.success.fg} size={16} /><Text style={styles.emptyText}>{text}</Text></View>; }
function dateLabel(value: string) { return formatCourseDate(value, { weekday: true }); }
function weekRange(start?: string, end?: string) { return start && end ? `${dateLabel(start)} – ${dateLabel(end)}` : 'Current learning week'; }
function groupLessons(items: WeeklyPlanLessonItem[]) {
  const groups = new Map<string, WeeklyPlanLessonItem[]>();
  items.forEach((item) => {
    const label = item.carried_forward ? 'Open from earlier' : dateLabel(item.scheduled_for);
    groups.set(label, [...(groups.get(label) || []), item]);
  });
  return [...groups.entries()];
}

const useStyles = makeStyles(({ colors: c }) => StyleSheet.create({
  planStack: { gap: 16 },
  shell: { overflow: 'hidden', borderRadius: 22, borderWidth: 1, borderColor: c.border.subtle, backgroundColor: c.surface.sunken },
  header: { padding: 18, backgroundColor: c.surface.sunken }, eyebrow: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 1.5 }, heading: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 23, letterSpacing: -0.5, marginTop: 3 }, headerCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18, marginTop: 4 },
  progressCopy: { flexDirection: 'row', justifyContent: 'space-between', gap: 10, marginTop: 16 }, progressText: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12 }, track: { height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: c.surface.sunken, marginTop: 7 }, fill: { height: 7, borderRadius: 4, backgroundColor: c.action.primary },
  libraryButton: { alignSelf: 'flex-start', minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, borderRadius: 12, backgroundColor: c.selection.bg, paddingHorizontal: 14, paddingVertical: 10 }, libraryButtonText: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13 }, libraryStats: { flexDirection: 'row', borderTopWidth: 1, borderTopColor: c.border.subtle }, libraryStat: { flex: 1, minWidth: 0, paddingHorizontal: 12, paddingVertical: 14, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: c.border.subtle }, libraryStatValue: { color: c.text.strong, fontFamily: fonts.extraBold, fontSize: 21 }, libraryStatLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', marginTop: 2 },
  section: { paddingHorizontal: 16, paddingVertical: 15, borderTopWidth: 1, borderTopColor: c.border.subtle }, warningSection: { backgroundColor: c.status.warning.bg }, subtleSection: { backgroundColor: c.surface.raised }, sectionHeading: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 4 }, sectionTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 14 }, warningText: { color: c.status.warning.fg }, sectionCopy: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginBottom: 4 }, lessonGroup: { paddingTop: 9 }, groupLabel: { color: c.text.body, fontFamily: fonts.bold, fontSize: 12, letterSpacing: 0.8, textTransform: 'uppercase' },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 9, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: c.border.subtle }, rowIcon: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: c.surface.sunken }, warningIcon: { backgroundColor: c.status.warning.bg }, flex: { flex: 1, minWidth: 0 }, rowTitle: { color: c.text.strong, fontFamily: fonts.bold, fontSize: 13, lineHeight: 19 }, rowMeta: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 16, marginTop: 1 }, statusIcon: { backgroundColor: c.surface.sunken }, rowExcerpt: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, marginTop: 3 }, rowChip: { marginTop: 6 }, awaitingLine: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 8 }, awaitingText: { color: c.text.body, fontFamily: fonts.semibold, fontSize: 12 }, noRequired: { marginTop: 14 }, pressed: { opacity: 0.7 }, empty: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 8 }, emptyText: { color: c.text.body, fontFamily: fonts.regular, fontSize: 12 },
}));
