import AsyncStorage from '@react-native-async-storage/async-storage';

export interface SubmissionDraft {
  text: string;
  base_submission_id: number | null;
  saved_at: string;
}

export function submissionDraftKey(userId: number, contentBlockId: number) {
  return `csg.submission-draft.${userId}.${contentBlockId}`;
}

export async function loadSubmissionDraft(userId: number, contentBlockId: number): Promise<SubmissionDraft | null> {
  const key = submissionDraftKey(userId, contentBlockId);
  const value = await AsyncStorage.getItem(key);
  if (!value) return null;

  try {
    const draft = JSON.parse(value) as Partial<SubmissionDraft>;
    if (typeof draft.text !== 'string' || (draft.base_submission_id !== null && typeof draft.base_submission_id !== 'number') || typeof draft.saved_at !== 'string') throw new Error('Invalid draft');
    return draft as SubmissionDraft;
  } catch {
    await AsyncStorage.removeItem(key);
    return null;
  }
}

export async function saveSubmissionDraft(userId: number, contentBlockId: number, text: string, baseSubmissionId: number | null) {
  const key = submissionDraftKey(userId, contentBlockId);
  if (!text.trim()) {
    await AsyncStorage.removeItem(key);
    return;
  }
  const draft: SubmissionDraft = { text, base_submission_id: baseSubmissionId, saved_at: new Date().toISOString() };
  await AsyncStorage.setItem(key, JSON.stringify(draft));
}

export async function clearSubmissionDraft(userId: number, contentBlockId: number) {
  await AsyncStorage.removeItem(submissionDraftKey(userId, contentBlockId));
}

export async function clearUserSubmissionDrafts(userId: number) {
  const prefix = `csg.submission-draft.${userId}.`;
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(prefix));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
