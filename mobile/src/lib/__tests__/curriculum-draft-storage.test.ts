import AsyncStorage from '@react-native-async-storage/async-storage';

import { clearLessonEditorDraft, clearUserLessonEditorDrafts, lessonEditorDraftKey, loadLessonEditorDraft, saveLessonEditorDraft } from '../curriculum-draft-storage';
import { emptyRetrievalCheck, type LessonEditorFields } from '../lesson-editor';
import { activateUserStorage } from '../user-storage-lifecycle';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const fields: LessonEditorFields = { title: 'Grid systems', required: true, video_url: '', s3_video_key: 'content_videos/example/grid.mp4', s3_video_content_type: 'video/mp4', s3_video_size: 1234, filename: 'styles.css', instructions: 'Build it.', solution: 'Use Grid.', submission_type: 'text_submission', objective_alignments: [{ learning_objective_id: 9, content_block_id: 203 }], rubric_id: 12, retrieval_check: emptyRetrievalCheck() };

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

  it('keeps pre-learning-design drafts readable without inventing advanced changes', async () => {
    const key = lessonEditorDraftKey(7, 101);
    const { objective_alignments: _objectives, rubric_id: _rubric, retrieval_check: _check, s3_video_key: _videoKey, s3_video_content_type: _videoType, s3_video_size: _videoSize, ...legacyFields } = fields;
    await AsyncStorage.setItem(key, JSON.stringify({ ...legacyFields, base_updated_at: 'v1', saved_at: new Date().toISOString() }));

    const restored = await loadLessonEditorDraft(7, 101);
    expect(restored).toEqual(expect.objectContaining({ title: fields.title }));
    expect(restored).not.toHaveProperty('objective_alignments');
    expect(restored).not.toHaveProperty('rubric_id');
    expect(restored).not.toHaveProperty('retrieval_check');
    expect(restored).not.toHaveProperty('s3_video_key');
  });

  it('clears only the signed-out staff member’s lesson drafts', async () => {
    await saveLessonEditorDraft(7, 101, fields, 'v1');
    await saveLessonEditorDraft(8, 101, fields, 'v1');
    await clearUserLessonEditorDrafts(7);
    expect(await AsyncStorage.getItem(lessonEditorDraftKey(7, 101))).toBeNull();
    expect(await AsyncStorage.getItem(lessonEditorDraftKey(8, 101))).not.toBeNull();
  });
});
