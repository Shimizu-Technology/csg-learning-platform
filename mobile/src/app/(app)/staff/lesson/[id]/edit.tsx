import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StaffLessonEditor } from '@/components/staff-lesson-editor';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { palette } from '@/constants/csg-theme';
import { demoLessonFor } from '@/lib/demo-learning';
import { learningKeys } from '@/lib/learning';
import { lessonForEditorInput } from '@/lib/lesson-editor';
import type { LessonDetail, LessonEditorInput } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function StaffLessonEditorScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const validId = Number.isInteger(id) && id > 0;
  const queryKey = learningKeys.lesson(user?.id || 0, id);
  const query = useQuery({ queryKey, queryFn: ({ signal }) => auth.demo ? Promise.resolve({ lesson: demoLessonFor(id) }) : api.lesson(id, signal), enabled: Boolean(user?.is_staff && validId) });
  const lesson = query.data?.lesson;

  const cacheLesson = (next: LessonDetail) => {
    queryClient.setQueryData(queryKey, { lesson: next });
    void queryClient.invalidateQueries({ queryKey: learningKeys.curricula(user?.id || 0) });
    if (next.curriculum_id) void queryClient.invalidateQueries({ queryKey: learningKeys.curriculum(user?.id || 0, next.curriculum_id) });
    return next;
  };

  const save = async (input: LessonEditorInput) => {
    if (auth.demo) return cacheLesson(lessonForEditorInput(queryClient.getQueryData<{ lesson: LessonDetail }>(queryKey)?.lesson || lesson!, input));
    return cacheLesson((await api.updateLessonEditor(id, input)).lesson);
  };

  const reload = async () => {
    if (auth.demo) return queryClient.getQueryData<{ lesson: LessonDetail }>(queryKey)?.lesson || demoLessonFor(id);
    return cacheLesson((await api.lesson(id)).lesson);
  };

  if (!validId || !user?.is_staff) return <ScreenError message={!validId ? 'This lesson link is invalid.' : 'Staff access is required to edit curriculum.'} onBack={() => router.back()} />;
  if (query.isPending && !lesson) return <SafeAreaView style={styles.safe}><LoadingState label="Opening lesson editor" /></SafeAreaView>;
  if (!lesson) return <ScreenError message={query.error ? (query.error as Error).message : 'This lesson is unavailable.'} onBack={() => router.back()} retry={() => void query.refetch()} />;
  return <StaffLessonEditor lesson={lesson} userId={user.id} onBack={() => router.back()} onSave={save} onReload={reload} />;
}

function ScreenError({ message, onBack, retry }: { message: string; onBack: () => void; retry?: () => void }) {
  return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable></View><ErrorState message={message} retry={retry} /></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: palette.ink }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' } });
