import { useMutation, useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { Text, View } from 'react-native';
import { LearningCard, SectionHeading } from './learning-ui';
import { Button } from './ui/button';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';
import { openExternalPage, openWebTask } from '@/lib/external-links';
import { brand } from '@/lib/brand';
import { themedAlert as Alert } from '@/lib/alerts';
import { ClosedWorkRecovery } from './closed-work-recovery';
import type { StudentDashboard } from '@/lib/types';

export function StudentTodayV2({ dashboard, githubApp, refresh }: { dashboard: StudentDashboard; githubApp: boolean; refresh: () => void }) {
  const router = useRouter();
  const { api, enrollments, user } = useSession();
  const { colors } = useTheme();
  const today = dashboard.student_today!;
  const cohortId = dashboard.cohort!.id;
  const enrollmentId = enrollments?.find(item => item.cohort.id === cohortId)?.id;
  const binding = useQuery({ queryKey: ['github-bindings', user?.id, enrollmentId], queryFn: ({ signal }) => api.githubBindings(enrollmentId!, signal), enabled: githubApp && Boolean(enrollmentId && today.first_run) });
  const pace = today.personal_pace;
  const savePace = useMutation({ mutationFn: (weeks: number) => api.choosePace(pace!.enrollment_id, weeks), onSuccess: refresh, onError: () => Alert.alert('Could not save your pace', 'Try again in a moment.') });
  const completion = today.course_completion;
  const openLesson = (id: number, blockId?: number, helpId?: number) => router.push({ pathname: '/lesson/[id]', params: { id: String(id), cohort_id: String(cohortId), ...(blockId ? { block_id: String(blockId) } : {}), ...(helpId ? { help_request: String(helpId) } : {}) } });
  const messageInstructor = async () => {
    if (!today.contact) return;
    try {
      const result = await api.createCohortDm(cohortId, [today.contact.id]);
      router.push({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(result.direct_conversation.id) } });
    } catch {
      Alert.alert('Could not open your conversation', 'Try again in a moment.');
    }
  };
  const body = { color: colors.text.body };
  const next = today.next_lesson;

  return <View style={{ gap: 12 }}>
    {today.first_run && <LearningCard><SectionHeading title="Welcome to your course" /><Text style={body}>Start in Learn, hand in your work as you go, and return here for feedback and your next lesson.</Text>
      {githubApp && !binding.data?.bindings.some(item => item.verification_state === 'verified') && <Button label="Connect GitHub" variant="secondary" onPress={() => void openWebTask(api, `/profile#github-repository-${cohortId}`).then(() => binding.refetch()).catch(() => Alert.alert('Could not open GitHub setup'))} />}
    </LearningCard>}
    {pace?.available && pace.status === 'not_chosen' && <LearningCard><SectionHeading title="Choose your pace" /><Text style={body}>Pick how many weeks you want to spend on the course.</Text>{pace.choices.map(choice => <Button key={choice.weeks} variant="secondary" label={`${choice.weeks} weeks · finish ${choice.ends_on}`} disabled={savePace.isPending} onPress={() => savePace.mutate(choice.weeks)} />)}</LearningCard>}
    {next && <LearningCard><SectionHeading title={next.title} />{next.status === 'redo' && <Text style={body}>Redo requested</Text>}<Button label={next.status === 'redo' ? 'Fix your redo' : 'Continue'} onPress={() => openLesson(next.id)} /></LearningCard>}
    <ClosedWorkRecovery dashboard={dashboard} />
    {completion?.all_work_handed_in && <LearningCard><SectionHeading title={completion.course_completed ? 'Course completed' : 'All work handed in'} />{completion.certificate && !completion.certificate.revoked && <Button label="View certificate" onPress={() => void openExternalPage(`${brand.appUrl}/certificates/${encodeURIComponent(completion.certificate!.code)}`).catch(() => Alert.alert('Could not open certificate'))} />}</LearningCard>}
    {today.needs_you.count > 0 && <LearningCard><SectionHeading title="Needs you" />{today.needs_you.items.map(item => {
      if (item.kind === 'redo') return <Button key={`redo-${item.submission_id}`} variant="secondary" label={`Redo requested · ${item.lesson_title}`} onPress={() => openLesson(item.lesson_id, item.content_block_id)} />;
      if (item.kind === 'message') return <Button key={`message-${item.message_id}`} variant="secondary" label={`Message from ${item.author.full_name}`} onPress={() => router.push(`/conversation/dm/${item.direct_conversation_id}?message_id=${item.message_id}` as Href)} />;
      const lesson = /^\/lessons\/(\d+)(?:[?#]|$)/.exec(item.path);
      const block = /#block-(\d+)$/.exec(item.path);
      return <Button key={`help-${item.help_request_id}`} variant="secondary" label={`Help reply · ${item.context_label}`} onPress={() => lesson ? openLesson(Number(lesson[1]), block ? Number(block[1]) : undefined, item.help_request_id) : void openWebTask(api, item.path).catch(() => Alert.alert('Could not open help reply'))} />;
    })}</LearningCard>}
    {today.waiting.count > 0 && <LearningCard><SectionHeading title="Waiting on your instructor" /><Text style={body}>{today.waiting.count} waiting for review · {today.review_response_time}</Text>{today.waiting.items.map(item => <Button key={item.submission_id} variant="quiet" label={item.lesson_title} onPress={() => openLesson(item.lesson_id, item.content_block_id)} />)}</LearningCard>}
    <Button label="My work" variant="secondary" onPress={() => router.push(`/my-work?cohort_id=${cohortId}` as Href)} />
    {(today.contact || today.reviewer) && <LearningCard><SectionHeading title="Your instructor" /><Text style={body}>{(today.contact || today.reviewer)?.full_name}</Text>{today.contact && <Button variant="secondary" label="Message your instructor" onPress={() => void messageInstructor()} />}</LearningCard>}
  </View>;
}
