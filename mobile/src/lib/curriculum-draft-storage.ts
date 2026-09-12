import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LessonEditorFields } from './lesson-editor';
import { beginUserStorageCleanup, userStorageCleanupIsCurrent, userStorageGeneration, userStorageGenerationIsCurrent, userStorageIsActive, type UserStorageCleanup } from './user-storage-lifecycle';

const curriculumDraftWrites = new Map<string, Promise<void>>();
const submissionTypes = new Set(['manual_complete', 'text_submission', 'prework_github_sync', 'repo_url_submission', 'repo_and_live_url_submission']);

type OptionalDraftFields = 'objective_alignments' | 'rubric_id' | 'retrieval_check' | 's3_video_key' | 's3_video_content_type' | 's3_video_size' | 'runner';

export type LessonEditorDraft = Omit<LessonEditorFields, OptionalDraftFields> & Partial<Pick<LessonEditorFields, OptionalDraftFields>> & {
  base_updated_at: string;
  saved_at: string;
};

export function lessonEditorDraftKey(userId: number, lessonId: number) {
  return `csg.lesson-editor-draft.${userId}.${lessonId}`;
}

function enqueueDraftWrite(userId: number, key: string, operation: (generation: number) => Promise<void>) {
  const generation = userStorageGeneration(userId);
  const previous = curriculumDraftWrites.get(key) || Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    if (!userStorageGenerationIsCurrent(userId, generation)) return;
    await operation(generation);
  });
  curriculumDraftWrites.set(key, write);
  return write.finally(() => {
    if (curriculumDraftWrites.get(key) === write) curriculumDraftWrites.delete(key);
  });
}

export async function loadLessonEditorDraft(userId: number, lessonId: number) {
  if (!userStorageIsActive(userId)) return null;
  const generation = userStorageGeneration(userId);
  const key = lessonEditorDraftKey(userId, lessonId);
  const pending = curriculumDraftWrites.get(key);
  if (pending) await pending.catch(() => undefined);
  const value = await AsyncStorage.getItem(key);
  if (!userStorageGenerationIsCurrent(userId, generation) || !value) return null;
  try {
    const draft = JSON.parse(value) as Partial<LessonEditorDraft>;
    if (typeof draft.title !== 'string' || typeof draft.required !== 'boolean' || typeof draft.video_url !== 'string' || typeof draft.filename !== 'string' || typeof draft.instructions !== 'string' || typeof draft.solution !== 'string' || typeof draft.submission_type !== 'string' || !submissionTypes.has(draft.submission_type) || typeof draft.base_updated_at !== 'string' || typeof draft.saved_at !== 'string') throw new Error('Invalid lesson draft');
    if (draft.s3_video_key !== undefined && !(draft.s3_video_key === null || typeof draft.s3_video_key === 'string')) throw new Error('Invalid lesson draft video');
    if (draft.s3_video_content_type !== undefined && !(draft.s3_video_content_type === null || typeof draft.s3_video_content_type === 'string')) throw new Error('Invalid lesson draft video type');
    if (draft.s3_video_size !== undefined && !(draft.s3_video_size === null || (Number.isInteger(draft.s3_video_size) && draft.s3_video_size > 0))) throw new Error('Invalid lesson draft video size');
    if (draft.runner !== undefined && !(draft.runner !== null && typeof draft.runner === 'object' && typeof draft.runner.enabled === 'boolean' && ['ruby', 'javascript'].includes(draft.runner.language))) throw new Error('Invalid lesson draft runner');
    if (draft.objective_alignments !== undefined && (!Array.isArray(draft.objective_alignments) || draft.objective_alignments.some((alignment) => !Number.isInteger(alignment?.learning_objective_id) || !(alignment?.content_block_id === null || Number.isInteger(alignment?.content_block_id))))) throw new Error('Invalid lesson draft objectives');
    if (draft.rubric_id !== undefined && !(draft.rubric_id === null || Number.isInteger(draft.rubric_id))) throw new Error('Invalid lesson draft rubric');
    if (draft.retrieval_check !== undefined) {
      const check = draft.retrieval_check;
      if (typeof check.enabled !== 'boolean' || typeof check.title !== 'string' || typeof check.prompt !== 'string' || !Array.isArray(check.options) || check.options.some((option) => typeof option !== 'string') || !Number.isInteger(check.correct_option) || typeof check.explanation !== 'string' || !(check.learning_objective_id === null || Number.isInteger(check.learning_objective_id)) || !(check.content_block_id === undefined || Number.isInteger(check.content_block_id)) || !Number.isInteger(check.attempt_count)) throw new Error('Invalid lesson draft check');
    }
    return draft as LessonEditorDraft;
  } catch {
    await enqueueDraftWrite(userId, key, async () => {
      if (await AsyncStorage.getItem(key) === value) await AsyncStorage.removeItem(key);
    }).catch(() => undefined);
    return null;
  }
}

export function saveLessonEditorDraft(userId: number, lessonId: number, fields: LessonEditorFields, baseUpdatedAt: string) {
  const key = lessonEditorDraftKey(userId, lessonId);
  return enqueueDraftWrite(userId, key, async (generation) => {
    const draft: LessonEditorDraft = { ...fields, base_updated_at: baseUpdatedAt, saved_at: new Date().toISOString() };
    await AsyncStorage.setItem(key, JSON.stringify(draft));
    if (!userStorageGenerationIsCurrent(userId, generation)) await AsyncStorage.removeItem(key);
  });
}

export function clearLessonEditorDraft(userId: number, lessonId: number) {
  const key = lessonEditorDraftKey(userId, lessonId);
  return enqueueDraftWrite(userId, key, () => AsyncStorage.removeItem(key));
}

export async function clearUserLessonEditorDrafts(userId: number, cleanup: UserStorageCleanup = beginUserStorageCleanup(userId)) {
  const prefix = `csg.lesson-editor-draft.${userId}.`;
  const pending = Array.from(curriculumDraftWrites.entries()).filter(([key]) => key.startsWith(prefix)).map(([, write]) => write.catch(() => undefined));
  await Promise.all(pending);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (userStorageCleanupIsCurrent(cleanup) && keys.length) await AsyncStorage.multiRemove(keys);
}
