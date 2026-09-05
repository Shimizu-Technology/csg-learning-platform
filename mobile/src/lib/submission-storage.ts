import AsyncStorage from '@react-native-async-storage/async-storage';
import { beginUserStorageCleanup, userStorageCleanupIsCurrent, userStorageGeneration, userStorageGenerationIsCurrent, userStorageIsActive, type UserStorageCleanup } from './user-storage-lifecycle';

const submissionStorageWrites = new Map<string, Promise<void>>();

function enqueueSubmissionWrite(userId: number, key: string, operation: (generation: number) => Promise<void>) {
  const generation = userStorageGeneration(userId);
  const previous = submissionStorageWrites.get(key) || Promise.resolve();
  const write = previous.catch(() => undefined).then(async () => {
    if (!userStorageGenerationIsCurrent(userId, generation)) return;
    await operation(generation);
  });
  submissionStorageWrites.set(key, write);
  return write.finally(() => {
    if (submissionStorageWrites.get(key) === write) submissionStorageWrites.delete(key);
  });
}

export interface SubmissionDraft {
  text: string;
  base_submission_id: number | null;
  base_submission_updated_at: string | null;
  saved_at: string;
}

export function submissionDraftKey(userId: number, contentBlockId: number) {
  return `csg.submission-draft.${userId}.${contentBlockId}`;
}

export function submissionDraftMatches(draft: SubmissionDraft, submissionId: number | null, submissionUpdatedAt: string | null) {
  return draft.base_submission_id === submissionId && draft.base_submission_updated_at === submissionUpdatedAt;
}

export async function loadSubmissionDraft(userId: number, contentBlockId: number): Promise<SubmissionDraft | null> {
  if (!userStorageIsActive(userId)) return null;
  const storageGeneration = userStorageGeneration(userId);
  const key = submissionDraftKey(userId, contentBlockId);
  const pending = submissionStorageWrites.get(key);
  if (pending) await pending.catch(() => undefined);
  const value = await AsyncStorage.getItem(key);
  if (!userStorageGenerationIsCurrent(userId, storageGeneration)) return null;
  if (!value) return null;

  try {
    const draft = JSON.parse(value) as Partial<SubmissionDraft>;
    if (typeof draft.text !== 'string' || (draft.base_submission_id !== null && typeof draft.base_submission_id !== 'number') || typeof draft.saved_at !== 'string') throw new Error('Invalid draft');
    if (draft.base_submission_updated_at !== undefined && draft.base_submission_updated_at !== null && typeof draft.base_submission_updated_at !== 'string') throw new Error('Invalid draft version');
    return { ...draft, base_submission_updated_at: draft.base_submission_updated_at ?? null } as SubmissionDraft;
  } catch {
    if (userStorageGenerationIsCurrent(userId, storageGeneration)) await AsyncStorage.removeItem(key);
    return null;
  }
}

export async function saveSubmissionDraft(userId: number, contentBlockId: number, text: string, baseSubmissionId: number | null, baseSubmissionUpdatedAt: string | null) {
  const key = submissionDraftKey(userId, contentBlockId);
  return enqueueSubmissionWrite(userId, key, async (storageGeneration) => {
    if (!text.trim()) {
      await AsyncStorage.removeItem(key);
      return;
    }
    const draft: SubmissionDraft = { text, base_submission_id: baseSubmissionId, base_submission_updated_at: baseSubmissionUpdatedAt, saved_at: new Date().toISOString() };
    await AsyncStorage.setItem(key, JSON.stringify(draft));
    if (!userStorageGenerationIsCurrent(userId, storageGeneration)) await AsyncStorage.removeItem(key);
  });
}

export function clearSubmissionDraft(userId: number, contentBlockId: number) {
  const key = submissionDraftKey(userId, contentBlockId);
  return enqueueSubmissionWrite(userId, key, () => AsyncStorage.removeItem(key));
}

export async function clearUserSubmissionDrafts(userId: number, cleanup: UserStorageCleanup = beginUserStorageCleanup(userId)) {
  const prefix = `csg.submission-draft.${userId}.`;
  const pendingWrites = Array.from(submissionStorageWrites.entries())
    .filter(([key]) => key.startsWith(prefix))
    .map(([, write]) => write.catch(() => undefined));
  await Promise.all(pendingWrites);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (!userStorageCleanupIsCurrent(cleanup)) return;
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
