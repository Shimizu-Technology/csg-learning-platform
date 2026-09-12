import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { StaffLessonEditor } from '@/components/staff-lesson-editor';
import { ErrorState, LoadingState } from '@/components/screen-states';
import { palette } from '@/constants/csg-theme';
import { demoLearningObjectives, demoLessonFor, demoRubrics } from '@/lib/demo-learning';
import { appendCatalogItem, learningKeys } from '@/lib/learning';
import { lessonForEditorInput } from '@/lib/lesson-editor';
import type { LearningObjective, LessonDetail, LessonEditorInput, Rubric } from '@/lib/types';
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
  const curriculumId = lesson?.curriculum_id || 0;
  const objectiveKey = learningKeys.learningObjectives(user?.id || 0, curriculumId);
  const rubricKey = learningKeys.rubrics(user?.id || 0, curriculumId);
  const objectiveQuery = useQuery({ queryKey: objectiveKey, queryFn: ({ signal }) => auth.demo ? Promise.resolve({ learning_objectives: demoLearningObjectives }) : api.learningObjectives(curriculumId, signal), enabled: Boolean(user?.is_staff && curriculumId) });
  const rubricQuery = useQuery({ queryKey: rubricKey, queryFn: ({ signal }) => auth.demo ? Promise.resolve({ rubrics: demoRubrics }) : api.rubrics(curriculumId, signal), enabled: Boolean(user?.is_staff && curriculumId) });
  const objectiveCatalog = objectiveQuery.data?.learning_objectives || [];
  const rubricCatalog = rubricQuery.data?.rubrics || [];

  const cacheLesson = (next: LessonDetail) => {
    queryClient.setQueryData(queryKey, { lesson: next });
    void queryClient.invalidateQueries({ queryKey: learningKeys.curricula(user?.id || 0) });
    if (next.curriculum_id) void queryClient.invalidateQueries({ queryKey: learningKeys.curriculum(user?.id || 0, next.curriculum_id) });
    return next;
  };

  const save = async (input: LessonEditorInput) => {
    if (auth.demo) return cacheLesson(lessonForEditorInput(queryClient.getQueryData<{ lesson: LessonDetail }>(queryKey)?.lesson || lesson!, input, new Date().toISOString(), objectiveCatalog, rubricCatalog));
    return cacheLesson((await api.updateLessonEditor(id, input)).lesson);
  };

  const reload = async () => {
    if (auth.demo) return queryClient.getQueryData<{ lesson: LessonDetail }>(queryKey)?.lesson || demoLessonFor(id);
    return cacheLesson((await api.lesson(id)).lesson);
  };

  const createObjective = async (input: { code: string; title: string; description?: string; success_criteria: string }) => {
    if (!curriculumId) throw new Error('Refresh this lesson before creating an objective.');
    const objective = auth.demo ? { id: Math.max(0, ...objectiveCatalog.map((item) => item.id)) + 1, curriculum_id: curriculumId, position: objectiveCatalog.length, active: true, alignment_count: 0, ...input, description: input.description || null } : (await api.createLearningObjective({ ...input, curriculum_id: curriculumId, position: objectiveCatalog.length })).learning_objective;
    queryClient.setQueryData<{ learning_objectives: LearningObjective[] }>(objectiveKey, (current) => ({ learning_objectives: appendCatalogItem(current?.learning_objectives, objective) }));
    return objective;
  };

  const createRubric = async (input: { title: string; description?: string; criteria: { title: string; description: string }[] }) => {
    if (!curriculumId) throw new Error('Refresh this lesson before creating a rubric.');
    const rubric: Rubric = auth.demo ? { id: Math.max(0, ...rubricCatalog.map((item) => item.id)) + 1, curriculum_id: curriculumId, active: true, title: input.title, description: input.description || null, criteria: input.criteria.map((criterion, index) => ({ id: 800 + index, position: index, ...criterion })) } : (await api.createRubric({ ...input, curriculum_id: curriculumId })).rubric;
    queryClient.setQueryData<{ rubrics: Rubric[] }>(rubricKey, (current) => ({ rubrics: appendCatalogItem(current?.rubrics, rubric) }));
    return rubric;
  };

  const retryCatalogs = () => { void Promise.all([objectiveQuery.refetch(), rubricQuery.refetch()]); };

  if (!validId || !user?.is_staff) return <ScreenError message={!validId ? 'This lesson link is invalid.' : 'Staff access is required to edit curriculum.'} onBack={() => router.back()} />;
  if (query.isPending && !lesson) return <SafeAreaView style={styles.safe}><LoadingState label="Opening lesson editor" /></SafeAreaView>;
  if (!lesson) return <ScreenError message={query.error ? (query.error as Error).message : 'This lesson is unavailable.'} onBack={() => router.back()} retry={() => void query.refetch()} />;
  return <StaffLessonEditor lesson={lesson} userId={user.id} onBack={() => router.back()} onSave={save} onReload={reload} objectiveCatalog={objectiveCatalog} rubricCatalog={rubricCatalog} catalogLoading={objectiveQuery.isPending || rubricQuery.isPending} catalogError={objectiveQuery.isError || rubricQuery.isError} canCreateResources={Boolean(user.is_admin)} onRetryCatalogs={retryCatalogs} onCreateObjective={createObjective} onCreateRubric={createRubric} />;
}

function ScreenError({ message, onBack, retry }: { message: string; onBack: () => void; retry?: () => void }) {
  return <SafeAreaView style={styles.safe}><View style={styles.backRow}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onBack} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable></View><ErrorState message={message} retry={retry} /></SafeAreaView>;
}

const styles = StyleSheet.create({ safe: { flex: 1, backgroundColor: palette.ink }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' } });
