import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearUserConversationStorage,
  loadThreadDraft,
  saveConversationDraft,
  saveFailedMessages,
  saveThreadDraft,
} from '../conversation-storage';
import {
  clearSubmissionDraft,
  clearUserSubmissionDrafts,
  loadSubmissionDraft,
  saveSubmissionDraft,
  submissionDraftKey,
} from '../submission-storage';
import type { Message } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('offline authored storage', () => {
  it('persists and clears a versioned text-submission draft', async () => {
    await saveSubmissionDraft(7, 42, 'My offline response', 12);

    expect(await loadSubmissionDraft(7, 42)).toEqual(expect.objectContaining({
      text: 'My offline response',
      base_submission_id: 12,
    }));

    await clearSubmissionDraft(7, 42);
    expect(await loadSubmissionDraft(7, 42)).toBeNull();
  });

  it('drops malformed submission storage instead of restoring unsafe data', async () => {
    await AsyncStorage.setItem(submissionDraftKey(7, 42), JSON.stringify({ text: 9 }));

    expect(await loadSubmissionDraft(7, 42)).toBeNull();
    expect(await AsyncStorage.getItem(submissionDraftKey(7, 42))).toBeNull();
  });

  it('persists thread drafts until the server-acknowledged send clears them', async () => {
    await saveThreadDraft(7, 88, 'A reply written offline');
    expect(await loadThreadDraft(7, 88)).toBe('A reply written offline');

    await saveThreadDraft(7, 88, '');
    expect(await loadThreadDraft(7, 88)).toBe('');
  });

  it('clears only the signed-out user authored drafts and retry copies', async () => {
    const failed = { client_status: 'failed' } as Message;
    await saveConversationDraft(7, 'channel', 3, 'student seven');
    await saveThreadDraft(7, 88, 'student seven thread');
    await saveFailedMessages(7, 'channel', 3, [failed]);
    await saveSubmissionDraft(7, 42, 'student seven work', null);
    await saveConversationDraft(8, 'channel', 3, 'student eight');
    await saveSubmissionDraft(8, 42, 'student eight work', null);

    await clearUserConversationStorage(7);
    await clearUserSubmissionDrafts(7);

    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some((key) => key.includes('.7.'))).toBe(false);
    expect(keys.some((key) => key.includes('.8.'))).toBe(true);
  });
});
