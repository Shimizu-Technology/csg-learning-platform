import { useQuery } from '@tanstack/react-query';
import { useRouter, type Href } from 'expo-router';
import { Text } from 'react-native';
import { LearningCard, SectionHeading } from './learning-ui';
import { Button } from './ui/button';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';
import { isStudentDashboard, learningKeys } from '@/lib/learning';
import { formatCourseDate } from '@/lib/course-time';
import { themedAlert as Alert } from '@/lib/alerts';

export function PausedLearningCard({ cohortId }: { cohortId: number | null }) {
  const { demo } = useCsgAuth();
  const { cohorts } = useCohort();
  const { api, user } = useSession();
  const { colors } = useTheme();
  const router = useRouter();
  const paused = cohorts?.some(item => item.id === cohortId && item.enrollment_status === 'paused');
  const query = useQuery({ queryKey: learningKeys.dashboard(user?.id || 0, cohortId), queryFn: ({ signal }) => api.dashboard(signal, cohortId), enabled: Boolean(!demo && paused && user && !user.is_staff) });
  const dashboard = query.data?.dashboard;
  if (demo || !paused || user?.is_staff) return null;
  const data = dashboard && isStudentDashboard(dashboard) ? dashboard : undefined;
  const contactId = data?.student_today?.contact?.id ?? data?.support_instructor_id;
  return <LearningCard>
    <SectionHeading title={data?.paused_since ? `Paused since ${formatCourseDate(data.paused_since, { withYear: true })}` : 'Enrollment paused'} />
    <Text style={{ color: colors.text.body }}>Your past work is saved. You can review it while your enrollment is paused.</Text>
    <Button variant="secondary" label="View past work" onPress={() => router.push(`/my-work?cohort_id=${cohortId}` as Href)} />
    {cohortId && contactId && <Button variant="secondary" label="Ask about resuming" onPress={() => void api.createCohortDm(cohortId, [contactId]).then(result => router.push({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: String(result.direct_conversation.id), prefill: 'How can I resume my course?' } })).catch(() => Alert.alert('Could not open your conversation'))} />}
  </LearningCard>;
}
