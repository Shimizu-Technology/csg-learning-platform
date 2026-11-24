import { gradeLabel } from '@/lib/display-labels';
import { useQuery } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackButton } from '@/components/back-button';
import { LearningCard, SectionHeading } from '@/components/learning-ui';
import { AuthoredContent } from '@/components/authored-content';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { useSession } from '@/providers/session-provider';
import { useTheme } from '@/providers/theme-provider';

export default function MyWork() {
  const { cohort_id } = useLocalSearchParams<{ cohort_id: string }>();
  const cohortId = Number(cohort_id);
  const { api, user } = useSession();
  const router = useRouter();
  const { colors } = useTheme();
  const valid = Number.isSafeInteger(cohortId) && cohortId > 0;
  const query = useQuery({ queryKey: ['my-work', user?.id, cohortId], queryFn: ({ signal }) => api.myWork(cohortId, signal), enabled: Boolean(user && valid), staleTime: 0 });
  const work = query.data?.my_work;
  return <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface.page }}>
    <BackButton />
    <ScrollView contentContainerStyle={{ padding: 20, gap: 12 }}>
      <SectionHeading title="My work" />
      {!valid ? <ErrorState message="Choose a course to view your work." /> : query.isPending ? <LoadingState label="Loading your work" /> : !work ? <ErrorState message="Could not load your work." retry={() => void query.refetch()} /> : (['needs_you', 'waiting', 'graded'] as const).map(group => <LearningCard key={group}>
        <SectionHeading title={{ needs_you: 'Needs you', waiting: 'Waiting on your instructor', graded: 'Reviewed' }[group]} />
        {!work[group].length && <Text style={{ color: colors.text.body }}>No work here yet.</Text>}
        {work[group].map(item => <LearningCard key={item.submission_id} label={`Open ${item.lesson_title}`} onPress={() => router.push({ pathname: '/lesson/[id]', params: { id: String(item.lesson_id), cohort_id: String(cohortId), block_id: String(item.content_block_id) } })}>
          <Text style={{ color: colors.text.strong }}>{item.lesson_title} · {item.block_title}</Text>
          <Text style={{ color: colors.text.body }}>Attempt {item.attempt}{item.grade ? ` · ${gradeLabel(item.grade)}` : ''}</Text>
          {item.feedback && <AuthoredContent compact written body={item.feedback} />}
        </LearningCard>)}
      </LearningCard>)}
    </ScrollView>
  </SafeAreaView>;
}
