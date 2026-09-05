import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  clearUserConversationStorage,
  loadFailedMessages,
  loadStoredThreadDraft,
  loadThreadDraft,
  saveConversationDraft,
  saveFailedMessages,
  saveThreadDraft,
} from '../conversation-storage';
import { clientMessageIdForSend } from '../message-compose';
import {
  clearSubmissionDraft,
  clearUserSubmissionDrafts,
  loadSubmissionDraft,
  saveSubmissionDraft,
  submissionDraftMatches,
  submissionDraftKey,
} from '../submission-storage';
import type { Message } from '../types';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe('offline authored storage', () => {
  it('persists and clears a versioned text-submission draft', async () => {
    await saveSubmissionDraft(7, 42, 'My offline response', 12, '2026-08-01T00:00:00Z');

    const draft = await loadSubmissionDraft(7, 42);
    expect(draft).toEqual(expect.objectContaining({
      text: 'My offline response',
      base_submission_id: 12,
      base_submission_updated_at: '2026-08-01T00:00:00Z',
    }));
    expect(submissionDraftMatches(draft!, 12, '2026-08-01T00:00:00Z')).toBe(true);
    expect(submissionDraftMatches(draft!, 12, '2026-08-01T01:00:00Z')).toBe(false);

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

  it('restores a failed thread send identifier after the screen unmounts', async () => {
    await saveThreadDraft(7, 88, 'Possibly delivered', 'thread-send-1');

    const restored = await loadStoredThreadDraft(7, 88);
    expect(restored).toEqual({ body: 'Possibly delivered', clientMessageId: 'thread-send-1' });
    const retryIntent = restored.clientMessageId
      ? { body: restored.body, clientMessageId: restored.clientMessageId }
      : null;
    expect(clientMessageIdForSend(restored.body, retryIntent)).toBe('thread-send-1');
  });

  it('persists failed conversation retry identifiers', async () => {
    const failed = { client_status: 'failed', client_message_id: 'conversation-send-1' } as Message;
    await saveFailedMessages(7, 'channel', 3, [failed]);

    expect((await loadFailedMessages(7, 'channel', 3))[0].client_message_id).toBe('conversation-send-1');
  });

  it('clears only the signed-out user authored drafts and retry copies', async () => {
    const failed = { client_status: 'failed' } as Message;
    await saveConversationDraft(7, 'channel', 3, 'student seven');
    await saveThreadDraft(7, 88, 'student seven thread');
    await saveFailedMessages(7, 'channel', 3, [failed]);
    await saveSubmissionDraft(7, 42, 'student seven work', null, null);
    await saveConversationDraft(8, 'channel', 3, 'student eight');
    await saveSubmissionDraft(8, 42, 'student eight work', null, null);

    await clearUserConversationStorage(7);
    await clearUserSubmissionDrafts(7);

    const keys = await AsyncStorage.getAllKeys();
    expect(keys.some((key) => key.includes('.7.'))).toBe(false);
    expect(keys.some((key) => key.includes('.8.'))).toBe(true);
  });
});
