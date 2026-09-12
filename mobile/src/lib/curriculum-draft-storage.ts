import AsyncStorage from '@react-native-async-storage/async-storage';
import type { LessonEditorFields } from './lesson-editor';
import { beginUserStorageCleanup, userStorageCleanupIsCurrent, userStorageGeneration, userStorageGenerationIsCurrent, userStorageIsActive, type UserStorageCleanup } from './user-storage-lifecycle';

const curriculumDraftWrites = new Map<string, Promise<void>>();
const submissionTypes = new Set(['manual_complete', 'text_submission', 'prework_github_sync', 'repo_url_submission', 'repo_and_live_url_submission']);

export interface LessonEditorDraft extends LessonEditorFields {
  base_updated_at: string;
  saved_at: string;
}

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
