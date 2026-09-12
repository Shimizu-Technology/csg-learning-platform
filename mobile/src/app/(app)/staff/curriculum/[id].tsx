import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ArrowLeft } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ErrorState, LoadingState } from '@/components/screen-states';
import { StaffCurriculumDetailView } from '@/components/staff-curriculum';
import { ExerciseEditorModal, ModuleEditorModal } from '@/components/staff-curriculum-management';
import { fonts, palette } from '@/constants/csg-theme';
import { demoStaffCurriculum } from '@/lib/demo-staff';
import { curriculumDayNames, scheduledDayIndices } from '@/lib/curriculum';
import { learningKeys } from '@/lib/learning';
import type { CurriculumModuleInput, ExerciseCreateInput, LessonDetail, StaffCurriculum, StaffCurriculumModule } from '@/lib/types';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

export default function StaffCurriculumScreen() {
  const id = Number(useLocalSearchParams<{ id: string }>().id);
  const router = useRouter();
  const queryClient = useQueryClient();
  const auth = useCsgAuth();
  const { api, user } = useSession();
  const [filter, setFilter] = useState('');
  const [moduleEditorOpen, setModuleEditorOpen] = useState(false);
  const [editingModule, setEditingModule] = useState<StaffCurriculumModule | null>(null);
  const [lessonTarget, setLessonTarget] = useState<{ module: StaffCurriculumModule; week: number } | null>(null);
  const validId = Number.isInteger(id) && id > 0;
  const query = useQuery({
    queryKey: learningKeys.curriculum(user?.id || 0, id),
    queryFn: ({ signal }) => auth.demo ? Promise.resolve({ curriculum: demoStaffCurriculum }) : api.curriculum(id, signal),
    enabled: Boolean(user?.is_staff && validId),
  });
  const curriculum = query.data?.curriculum;

  const cacheCurriculum = (next: StaffCurriculum) => queryClient.setQueryData(learningKeys.curriculum(user?.id || 0, id), { curriculum: next });

  const saveModule = async (input: CurriculumModuleInput) => {
    if (!curriculum) return;
    if (auth.demo) {
      const now = new Date().toISOString();
      const nextModule: StaffCurriculumModule = editingModule ? { ...editingModule, ...input, description: input.description || null, updated_at: now } : {
        id: Math.max(0, ...curriculum.modules.map((item) => item.id)) + 1,
        curriculum_id: curriculum.id,
        name: input.name,
        description: input.description || null,
        module_type: input.module_type,
        position: input.position,
        total_days: input.total_days,
        day_offset: input.day_offset,
        schedule_days: input.schedule_days,
        updated_at: now,
        scheduled_day_names: scheduledDayIndices(input.schedule_days).map((day) => curriculumDayNames[day]),
        week_count: 1,
        lessons_count: 0,
        archived_lessons_count: 0,
        lessons: [],
      };
      const modules = editingModule ? curriculum.modules.map((item) => item.id === editingModule.id ? nextModule : item) : [...curriculum.modules, nextModule];
      cacheCurriculum({ ...curriculum, modules, modules_count: modules.length });
      return;
    }
    const saved = editingModule
      ? (await api.updateCurriculumModule(editingModule.id, input)).module
      : (await api.createCurriculumModule(curriculum.id, input)).module;
    const nextModule: StaffCurriculumModule = {
      ...saved,
      archived_lessons_count: saved.archived_lessons_count ?? editingModule?.archived_lessons_count ?? 0,
      lessons: saved.lessons ?? editingModule?.lessons ?? [],
    };
    const modules = editingModule
      ? curriculum.modules.map((item) => item.id === editingModule.id ? nextModule : item)
      : [...curriculum.modules, nextModule];
    cacheCurriculum({ ...curriculum, modules, modules_count: modules.length });
    void queryClient.invalidateQueries({ queryKey: learningKeys.curriculum(user?.id || 0, id) });
    void queryClient.invalidateQueries({ queryKey: learningKeys.curricula(user?.id || 0) });
  };

  const saveExercise = async (input: ExerciseCreateInput) => {
    if (!lessonTarget || !curriculum) return;
    let lesson: LessonDetail;
    if (auth.demo) {
      const lessonId = Math.max(0, ...curriculum.modules.flatMap((item) => item.lessons.map((entry) => entry.id))) + 1;
      const now = new Date().toISOString();
      lesson = { id: lessonId, curriculum_id: curriculum.id, module_id: lessonTarget.module.id, title: input.title, lesson_type: 'exercise', position: lessonTarget.module.lessons.length + 1, release_day: input.release_day, required: input.required, archived_at: null, updated_at: now, requires_submission: false, submission_type: input.submission_type, content_blocks_count: 1, objectives: [], content_blocks: [{ id: lessonId * 10, block_type: 'exercise', position: 1, title: input.title, body: input.instructions, video_url: null, filename: null, submission_type: input.submission_type, submission_type_explicit: input.submission_type, submission_config: {}, metadata: {}, solution: null }], prev_lesson: null, next_lesson: null };
      const modules = curriculum.modules.map((item) => item.id !== lessonTarget.module.id ? item : { ...item, lessons: [...item.lessons, { id: lesson.id, title: lesson.title, lesson_type: lesson.lesson_type, position: lesson.position, release_day: lesson.release_day, required: lesson.required, archived_at: null, updated_at: now, requires_submission: false, submission_type: input.submission_type, content_blocks_count: 1 }], lessons_count: item.lessons_count + 1, week_count: Math.max(item.week_count, Math.floor(input.release_day / 7) + 1) });
      cacheCurriculum({ ...curriculum, modules });
    } else {
      lesson = (await api.createExercise(lessonTarget.module.id, input)).lesson;
      const modules = curriculum.modules.map((item) => item.id !== lessonTarget.module.id ? item : {
        ...item,
        lessons: [...item.lessons, lessonSummary(lesson)],
        lessons_count: item.lessons_count + 1,
        week_count: Math.max(item.week_count, Math.floor(input.release_day / 7) + 1),
      });
      cacheCurriculum({ ...curriculum, modules });
      void queryClient.invalidateQueries({ queryKey: learningKeys.curriculum(user?.id || 0, id) });
      void queryClient.invalidateQueries({ queryKey: learningKeys.curricula(user?.id || 0) });
    }
    queryClient.setQueryData(learningKeys.lesson(user?.id || 0, lesson.id), { lesson });
    router.push(`/staff/lesson/${lesson.id}/edit`);
  };

  if (!user?.is_staff || !validId) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><BackButton onPress={() => router.back()} /></View><ErrorState title="Curriculum unavailable" message="This staff curriculum link is not available for this account." /></SafeAreaView>;
  if (query.isPending && !curriculum) return <SafeAreaView style={styles.safe}><LoadingState label="Opening curriculum" /></SafeAreaView>;
  if (!curriculum) return <SafeAreaView style={styles.safe}><View style={styles.backRow}><BackButton onPress={() => router.back()} /></View><ErrorState message={query.error ? (query.error as Error).message : 'This curriculum is unavailable.'} retry={() => void query.refetch()} /></SafeAreaView>;

  return <SafeAreaView edges={['top']} style={styles.safe}><View style={styles.header}><BackButton onPress={() => router.back()} /><View style={styles.flex}><Text style={styles.headerKicker}>CURRICULUM STUDIO</Text><Text numberOfLines={1} style={styles.headerTitle}>{curriculum.name}</Text></View><View style={styles.preview}><Text style={styles.previewText}>STAFF TOOLS</Text></View></View><ScrollView keyboardDismissMode="on-drag" refreshControl={<RefreshControl refreshing={query.isRefetching} onRefresh={() => void query.refetch()} tintColor={palette.rubySoft} />} contentContainerStyle={styles.content}>
    {query.isError && <View style={styles.offline}><Text style={styles.offlineText}>Showing saved curriculum. Refresh when your connection returns.</Text></View>}
    <StaffCurriculumDetailView curriculum={curriculum} filter={filter} onFilterChange={setFilter} onOpenLesson={(lessonId) => router.push(`/lesson/${lessonId}`)} canManageModules={Boolean(user.is_admin)} onAddModule={() => { setEditingModule(null); setModuleEditorOpen(true); }} onEditModule={(module) => { setEditingModule(module); setModuleEditorOpen(true); }} onAddLesson={(module, week) => setLessonTarget({ module, week })} />
  </ScrollView><ModuleEditorModal visible={moduleEditorOpen} module={editingModule} defaultPosition={curriculum.modules.length} onClose={() => setModuleEditorOpen(false)} onSave={saveModule} /><ExerciseEditorModal visible={Boolean(lessonTarget)} module={lessonTarget?.module || null} defaultWeek={lessonTarget?.week || 1} onClose={() => setLessonTarget(null)} onSave={saveExercise} /></SafeAreaView>;
}

function lessonSummary(lesson: LessonDetail) {
  return {
    id: lesson.id,
    title: lesson.title,
    lesson_type: lesson.lesson_type,
    position: lesson.position,
    release_day: lesson.release_day,
    required: lesson.required,
    archived_at: lesson.archived_at ?? null,
    updated_at: lesson.updated_at || new Date().toISOString(),
    requires_submission: lesson.requires_submission,
    submission_type: lesson.submission_type || 'manual_complete',
    content_blocks_count: lesson.content_blocks_count,
  };
}

function BackButton({ onPress }: { onPress: () => void }) {
  return <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={onPress} style={styles.back}><ArrowLeft color={palette.text} size={22} /></Pressable>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.ink }, header: { minHeight: 68, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: palette.line, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 7 }, backRow: { minHeight: 68, paddingHorizontal: 10, justifyContent: 'center' }, back: { width: 44, height: 44, borderRadius: 14, alignItems: 'center', justifyContent: 'center' }, flex: { flex: 1, minWidth: 0 }, headerKicker: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 1 }, headerTitle: { color: palette.text, fontFamily: fonts.bold, fontSize: 15, marginTop: 2 }, preview: { minHeight: 30, borderRadius: 15, borderWidth: 1, borderColor: '#4D2630', backgroundColor: '#211319', paddingHorizontal: 9, justifyContent: 'center', marginRight: 8 }, previewText: { color: palette.rubySoft, fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.6 }, content: { padding: 20, paddingBottom: 90, gap: 14 }, offline: { minHeight: 36, borderRadius: 12, backgroundColor: '#2A2115', justifyContent: 'center', paddingHorizontal: 12 }, offlineText: { color: palette.warning, fontFamily: fonts.semibold, fontSize: 11 },
});
