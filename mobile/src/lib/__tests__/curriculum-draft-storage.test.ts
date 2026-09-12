import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearLessonEditorDraft, clearUserLessonEditorDrafts, lessonEditorDraftKey, loadLessonEditorDraft, saveLessonEditorDraft } from '../curriculum-draft-storage';
import type { LessonEditorFields } from '../lesson-editor';
import { activateUserStorage } from '../user-storage-lifecycle';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const fields: LessonEditorFields = { title: 'Grid systems', required: true, video_url: '', filename: 'styles.css', instructions: 'Build it.', solution: 'Use Grid.', submission_type: 'text_submission' };

beforeEach(async () => {
  activateUserStorage(7);
  activateUserStorage(8);
  await AsyncStorage.clear();
});

describe('curriculum editor draft storage', () => {
  it('persists one versioned lesson draft and clears it after save', async () => {
    await saveLessonEditorDraft(7, 101, fields, '2026-09-12T01:02:03.123456Z');
    await expect(loadLessonEditorDraft(7, 101)).resolves.toMatchObject({ ...fields, base_updated_at: '2026-09-12T01:02:03.123456Z' });
    await clearLessonEditorDraft(7, 101);
    await expect(loadLessonEditorDraft(7, 101)).resolves.toBeNull();
  });

  it('removes malformed drafts instead of restoring unsafe state', async () => {
    const key = lessonEditorDraftKey(7, 101);
    await AsyncStorage.setItem(key, JSON.stringify({ ...fields, submission_type: 'unknown', base_updated_at: 'v1', saved_at: new Date().toISOString() }));
    await expect(loadLessonEditorDraft(7, 101)).resolves.toBeNull();
    await expect(AsyncStorage.getItem(key)).resolves.toBeNull();
  });

  it('clears only the signed-out staff member’s lesson drafts', async () => {
    await saveLessonEditorDraft(7, 101, fields, 'v1');
    await saveLessonEditorDraft(8, 101, fields, 'v1');
    await clearUserLessonEditorDrafts(7);
    expect(await AsyncStorage.getItem(lessonEditorDraftKey(7, 101))).toBeNull();
    expect(await AsyncStorage.getItem(lessonEditorDraftKey(8, 101))).not.toBeNull();
  });
});
