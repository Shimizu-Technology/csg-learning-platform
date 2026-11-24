import { useRouter } from 'expo-router';
import { Text, View } from 'react-native';
import { LearningCard, SectionHeading } from './learning-ui';
import { Button } from './ui/button';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';
import { formatCourseDateTime } from '@/lib/course-time';
import { themedAlert as Alert } from '@/lib/alerts';
import type { StudentDashboard } from '@/lib/types';

export function closedRequiredWork(dashboard: StudentDashboard) {
  return (dashboard.modules ?? []).flatMap(module => module.lessons).filter(lesson =>
    lesson.available && lesson.required !== false && !lesson.completed && lesson.submission_window?.submissions_closed);
}

export function ClosedWorkRecovery({ dashboard }: { dashboard: StudentDashboard }) {
  const { api } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const cohortId = dashboard.cohort?.id;
  const items = closedRequiredWork(dashboard);
  if (!cohortId || !items.length) return null;
  const contactId = dashboard.student_today?.contact?.id ?? dashboard.support_instructor_id;
  const requestPlan = async () => {
    if (!contactId) return;
    try {
      const result = await api.createCohortDm(cohortId, [contactId]);
      router.push({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(result.direct_conversation.id), prefill: 'Could we make a catch-up plan for my closed coursework?' } });
    } catch {
      Alert.alert('Could not open your conversation', 'Try again in a moment.');
    }
  };
  return <LearningCard>
    <SectionHeading title="Catch up on closed work" />
    {items.map(lesson => <View key={lesson.id} style={{ gap: 4 }}>
      <Text style={{ color: colors.text.body }}>{lesson.title}{lesson.submission_window?.submissions_close_at ? ` · Closed ${formatCourseDateTime(lesson.submission_window.submissions_close_at, { withYear: true })}` : ''}</Text>
      <Button variant="secondary" label={lesson.review_status === 'reviewed' || lesson.review_status === 'redo_requested' ? 'Read feedback' : 'Open lesson'} onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: String(lesson.id), cohort_id: String(cohortId) } })} />
    </View>)}
    {contactId && <Button label="Ask for a catch-up plan" onPress={() => void requestPlan()} />}
  </LearningCard>;
}
