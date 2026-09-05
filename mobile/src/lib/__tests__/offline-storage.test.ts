import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  activateUserConversationStorage,
  clearConversationDraftAfterSend,
  clearThreadDraftAfterSend,
  clearUserConversationStorage,
  failedMessagesKey,
  loadConversationDraft,
  loadFailedMessages,
  loadStoredThreadDraft,
  loadThreadDraft,
  saveConversationDraft,
  saveFailedMessages,
  saveFailedMessagesWithRetry,
  saveThreadDraft,
  saveThreadDraftState,
} from '../conversation-storage';
import { clientMessageIdForSend } from '../message-compose';
import { mergeMessageEvent, mergeServerAndFailedMessages } from '../message-state';
import {
  clearSubmissionDraft,
  clearUserSubmissionDrafts,
  loadSubmissionDraft,
  saveSubmissionDraft,
  submissionDraftMatches,
  submissionDraftKey,
} from '../submission-storage';
import { beginUserStorageCleanup } from '../user-storage-lifecycle';
import type { Message } from '../types';

const storedAuthor = { id: 7, full_name: 'Student', email: 'student@example.com', role: 'student', avatar_url: null } as const;

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

beforeEach(async () => {
  activateUserConversationStorage(7);
  activateUserConversationStorage(8);
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
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

  it('does not remove a valid submission draft saved while a malformed value is being read', async () => {
    const key = submissionDraftKey(7, 42);
    const malformed = JSON.stringify({ text: 9 });
    await AsyncStorage.setItem(key, malformed);
    let releaseRead = () => {};
    let markReadStarted = () => {};
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(async () => {
      markReadStarted();
      await readGate;
      return malformed;
    });

    const staleLoad = loadSubmissionDraft(7, 42);
    await readStarted;
    await saveSubmissionDraft(7, 42, 'New valid draft', null, null);
    releaseRead();

    await expect(staleLoad).resolves.toBeNull();
    await expect(loadSubmissionDraft(7, 42)).resolves.toEqual(expect.objectContaining({ text: 'New valid draft' }));
  });

  it('persists thread drafts until the server-acknowledged send clears them', async () => {
    await saveThreadDraft(7, 88, 'A reply written offline');
    expect(await loadThreadDraft(7, 88)).toBe('A reply written offline');

    await saveThreadDraft(7, 88, '');
    expect(await loadThreadDraft(7, 88)).toBe('');
  });

  it('does not turn successful sends into failures when local draft cleanup rejects', async () => {
    const conversationCleanup = jest.fn().mockRejectedValue(new Error('storage unavailable'));
    await expect(clearConversationDraftAfterSend(7, 'channel', 3, conversationCleanup)).resolves.toBeUndefined();

    const threadCleanup = jest.fn().mockRejectedValue(new Error('storage unavailable'));
    await expect(clearThreadDraftAfterSend(7, 88, threadCleanup)).resolves.toBeUndefined();
  });

  it.each([
    {
      surface: 'conversation',
      save: (body: string) => saveConversationDraft(7, 'channel', 3, body),
      clear: () => clearConversationDraftAfterSend(7, 'channel', 3),
    },
    {
      surface: 'thread',
      save: (body: string) => saveThreadDraft(7, 88, body, 'thread-send-race'),
      clear: () => clearThreadDraftAfterSend(7, 88),
    },
  ])('serializes an in-flight $surface draft save before its post-send clear', async ({ save, clear }) => {
    const order: string[] = [];
    let releaseSave = () => {};
    let markSaveStarted = () => {};
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async () => {
      order.push('set-start');
      markSaveStarted();
      await saveGate;
      order.push('set-finish');
    });
    jest.spyOn(AsyncStorage, 'removeItem').mockImplementationOnce(async () => {
      order.push('remove');
    });

    const staleSave = save('Still typing');
    await saveStarted;
    const acknowledgedClear = clear();
    await Promise.resolve();
    expect(order).toEqual(['set-start']);

    releaseSave();
    await Promise.all([staleSave, acknowledgedClear]);

    expect(order).toEqual(['set-start', 'set-finish', 'remove']);
    jest.restoreAllMocks();
  });

  it('loads the newest draft when another write queues behind the one already being awaited', async () => {
    const originalSetItem = AsyncStorage.setItem.bind(AsyncStorage);
    let releaseFirstWrite = () => {};
    let markFirstWriteStarted = () => {};
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const firstWriteStarted = new Promise<void>((resolve) => { markFirstWriteStarted = resolve; });
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
      markFirstWriteStarted();
      await firstWriteGate;
      await originalSetItem(key, value);
    });

    const firstSave = saveConversationDraft(7, 'channel', 3, 'Older draft');
    await firstWriteStarted;
    const load = loadConversationDraft(7, 'channel', 3);
    const newestSave = saveConversationDraft(7, 'channel', 3, 'Newest draft');

    releaseFirstWrite();
    await Promise.all([firstSave, newestSave]);
    await expect(load).resolves.toBe('Newest draft');
  });

  it('keeps queued writes when an already-active user is activated again', async () => {
    const originalSetItem = AsyncStorage.setItem.bind(AsyncStorage);
    let releaseFirstWrite = () => {};
    let markFirstWriteStarted = () => {};
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const firstWriteStarted = new Promise<void>((resolve) => { markFirstWriteStarted = resolve; });
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
      markFirstWriteStarted();
      await firstWriteGate;
      await originalSetItem(key, value);
    });

    const firstSave = saveConversationDraft(7, 'channel', 3, 'Older draft');
    await firstWriteStarted;
    const newestSave = saveConversationDraft(7, 'channel', 3, 'Newest draft');
    activateUserConversationStorage(7);

    releaseFirstWrite();
    await Promise.all([firstSave, newestSave]);
    expect(await loadConversationDraft(7, 'channel', 3)).toBe('Newest draft');
  });

  it('restores a failed thread send identifier after the screen unmounts', async () => {
    await saveThreadDraft(7, 88, 'Possibly delivered   ', 'thread-send-1');

    const restored = await loadStoredThreadDraft(7, 88);
    expect(restored).toEqual({
      body: 'Possibly delivered   ',
      failedSend: { body: 'Possibly delivered', clientMessageId: 'thread-send-1' },
    });
    const retryIntent = restored.failedSend;
    expect(clientMessageIdForSend(retryIntent!.body, retryIntent)).toBe('thread-send-1');
  });

  it('stores a failed thread reply separately from a replacement draft', async () => {
    await saveThreadDraftState(7, 88, 'A newer reply', { body: 'Failed reply', clientMessageId: 'thread-send-2' });

    expect(await loadStoredThreadDraft(7, 88)).toEqual({
      body: 'A newer reply',
      failedSend: { body: 'Failed reply', clientMessageId: 'thread-send-2' },
    });
  });

  it('persists failed conversation retry identifiers', async () => {
    const failed = { author: storedAuthor, client_status: 'failed', client_message_id: 'conversation-send-1' } as Message;
    await saveFailedMessages(7, 'channel', 3, [failed]);

    expect((await loadFailedMessages(7, 'channel', 3))[0].client_message_id).toBe('conversation-send-1');
  });

  it('discards malformed retry records before message reconciliation', async () => {
    await AsyncStorage.setItem(failedMessagesKey(7, 'channel', 3), JSON.stringify([{
      id: -1,
      client_status: 'failed',
      client_message_id: 'missing-author',
    }]));

    expect(await loadFailedMessages(7, 'channel', 3)).toEqual([]);
  });

  it('restores an interrupted conversation retry until server history confirms it', async () => {
    const author = { id: 7, full_name: 'Student', email: 'student@example.com', role: 'student', avatar_url: null } as const;
    const sending = {
      id: -1,
      author,
      body: 'Retry after restart',
      client_status: 'sending',
      client_message_id: 'conversation-retry-1',
    } as Message;
    await saveFailedMessages(7, 'channel', 3, [sending]);

    const restored = await loadFailedMessages(7, 'channel', 3);
    expect(restored).toEqual([expect.objectContaining({
      body: 'Retry after restart',
      client_status: 'failed',
      client_message_id: 'conversation-retry-1',
    })]);

    const canonical = { ...sending, id: 81, client_status: undefined };
    expect(mergeServerAndFailedMessages([canonical], restored)).toEqual([canonical]);
  });

  it('removes a persisted failure after realtime delivers its canonical message', async () => {
    const author = { id: 7, full_name: 'Student', email: 'student@example.com', role: 'student', avatar_url: null } as const;
    const failed = { id: -1, author, client_status: 'failed', client_message_id: 'conversation-send-2' } as Message;
    const canonical = { ...failed, id: 81, client_status: undefined };
    await saveFailedMessages(7, 'channel', 3, [failed]);

    const restored = await loadFailedMessages(7, 'channel', 3);
    const merged = mergeMessageEvent(restored, { event: 'created', channel_id: 3, direct_conversation_id: null, message: canonical });
    expect(merged).toEqual([canonical]);
    await saveFailedMessages(7, 'channel', 3, merged);

    expect(await loadFailedMessages(7, 'channel', 3)).toEqual([]);
  });

  it('serializes failed-message writes so an older save cannot beat realtime cleanup', async () => {
    const failed = { id: -1, author: storedAuthor, client_status: 'failed', client_message_id: 'conversation-send-3' } as Message;
    const order: string[] = [];
    let releaseFirstWrite = () => {};
    let markFirstWriteStarted = () => {};
    const firstWriteGate = new Promise<void>((resolve) => { releaseFirstWrite = resolve; });
    const firstWriteStarted = new Promise<void>((resolve) => { markFirstWriteStarted = resolve; });
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async () => {
      order.push('set-start');
      markFirstWriteStarted();
      await firstWriteGate;
      order.push('set-finish');
    });
    jest.spyOn(AsyncStorage, 'removeItem').mockImplementation(async () => {
      order.push('remove');
    });

    const staleSave = saveFailedMessages(7, 'channel', 3, [failed]);
    await firstWriteStarted;
    const realtimeCleanup = saveFailedMessages(7, 'channel', 3, []);
    await Promise.resolve();
    expect(order).toEqual(['set-start']);

    releaseFirstWrite();
    await Promise.all([staleSave, realtimeCleanup]);

    expect(order).toEqual(['set-start', 'set-finish', 'remove']);
  });

  it('retries transient failed-message persistence errors with a bound', async () => {
    const failed = { id: -1, author: storedAuthor, client_status: 'failed', client_message_id: 'retry-persistence' } as Message;
    const setItem = jest.spyOn(AsyncStorage, 'setItem');
    setItem.mockClear();
    setItem.mockRejectedValueOnce(new Error('Storage unavailable'));
    const waits: number[] = [];

    const saved = await saveFailedMessagesWithRetry(
      7,
      'channel',
      3,
      [failed],
      () => true,
      async (milliseconds) => { waits.push(milliseconds); },
    );

    expect(saved).toBe(true);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(waits).toEqual([250]);
    expect(await loadFailedMessages(7, 'channel', 3)).toEqual([failed]);
  });

  it('does not let malformed-data cleanup delete a newer valid failed message', async () => {
    const key = failedMessagesKey(7, 'channel', 3);
    await AsyncStorage.setItem(key, '{malformed');
    let releaseRead = () => {};
    let markReadStarted = () => {};
    const readGate = new Promise<void>((resolve) => { releaseRead = resolve; });
    const readStarted = new Promise<void>((resolve) => { markReadStarted = resolve; });
    jest.spyOn(AsyncStorage, 'getItem').mockImplementationOnce(async () => {
      markReadStarted();
      await readGate;
      return '{malformed';
    });

    const malformedLoad = loadFailedMessages(7, 'channel', 3);
    await readStarted;
    const valid = { id: -1, author: storedAuthor, client_status: 'failed', client_message_id: 'newer-send' } as Message;
    await saveFailedMessages(7, 'channel', 3, [valid]);
    releaseRead();
    expect(await malformedLoad).toEqual([]);

    expect(await loadFailedMessages(7, 'channel', 3)).toEqual([valid]);
  });

  it('blocks stale session writes during cleanup and reopens storage for a new session', async () => {
    let releaseSave = () => {};
    let markSaveStarted = () => {};
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const saveStarted = new Promise<void>((resolve) => { markSaveStarted = resolve; });
    const setItem = jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async () => {
      markSaveStarted();
      await saveGate;
    });
    setItem.mockClear();

    const inFlightSave = saveConversationDraft(7, 'channel', 3, 'Old session draft');
    await saveStarted;
    const cleanup = clearUserConversationStorage(7);
    const staleLateSave = saveThreadDraft(7, 88, 'Late old session draft');
    releaseSave();
    await Promise.all([inFlightSave, cleanup, staleLateSave]);

    expect(setItem).toHaveBeenCalledTimes(1);
    expect(await loadConversationDraft(7, 'channel', 3)).toBe('');
    expect(await loadThreadDraft(7, 88)).toBe('');

    jest.restoreAllMocks();
    activateUserConversationStorage(7);
    await saveConversationDraft(7, 'channel', 3, 'New session draft');
    expect(await loadConversationDraft(7, 'channel', 3)).toBe('New session draft');
  });

  it('does not let prior-session cleanup remove a reactivated session draft', async () => {
    await saveConversationDraft(7, 'channel', 3, 'Old session draft');
    let releaseKeyRead = () => {};
    let markKeyReadStarted = () => {};
    const keyReadGate = new Promise<void>((resolve) => { releaseKeyRead = resolve; });
    const keyReadStarted = new Promise<void>((resolve) => { markKeyReadStarted = resolve; });
    const originalGetAllKeys = AsyncStorage.getAllKeys.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'getAllKeys').mockImplementationOnce(async () => {
      markKeyReadStarted();
      await keyReadGate;
      return originalGetAllKeys();
    });

    const priorCleanup = clearUserConversationStorage(7);
    await keyReadStarted;
    activateUserConversationStorage(7);
    await saveConversationDraft(7, 'channel', 3, 'New session draft');
    releaseKeyRead();
    await priorCleanup;

    expect(await loadConversationDraft(7, 'channel', 3)).toBe('New session draft');
  });

  it('does not let stale cleanup remove a submission draft saved after reactivation', async () => {
    await saveSubmissionDraft(7, 42, 'Old draft', null, null);
    let releaseKeyRead = () => {};
    let markKeyReadStarted = () => {};
    const keyReadGate = new Promise<void>((resolve) => { releaseKeyRead = resolve; });
    const keyReadStarted = new Promise<void>((resolve) => { markKeyReadStarted = resolve; });
    const originalGetAllKeys = AsyncStorage.getAllKeys.bind(AsyncStorage);
    jest.spyOn(AsyncStorage, 'getAllKeys').mockImplementationOnce(async () => {
      markKeyReadStarted();
      await keyReadGate;
      return originalGetAllKeys();
    });

    const cleanup = beginUserStorageCleanup(7);
    const staleCleanup = clearUserSubmissionDrafts(7, cleanup);
    await keyReadStarted;
    activateUserConversationStorage(7);
    await saveSubmissionDraft(7, 42, 'Recovered session draft', null, null);
    releaseKeyRead();
    await staleCleanup;

    expect((await loadSubmissionDraft(7, 42))?.text).toBe('Recovered session draft');
  });

  it('does not let an old in-flight submission save overwrite a reactivated session', async () => {
    const originalSetItem = AsyncStorage.setItem.bind(AsyncStorage);
    let releaseOldSave = () => {};
    let markOldSaveStarted = () => {};
    const oldSaveGate = new Promise<void>((resolve) => { releaseOldSave = resolve; });
    const oldSaveStarted = new Promise<void>((resolve) => { markOldSaveStarted = resolve; });
    jest.spyOn(AsyncStorage, 'setItem').mockImplementationOnce(async (key, value) => {
      markOldSaveStarted();
      await oldSaveGate;
      await originalSetItem(key, value);
    });

    const oldSave = saveSubmissionDraft(7, 42, 'Old session draft', null, null);
    await oldSaveStarted;
    const cleanup = clearUserSubmissionDrafts(7);
    activateUserConversationStorage(7);
    const currentSave = saveSubmissionDraft(7, 42, 'Current session draft', null, null);
    releaseOldSave();
    await Promise.all([oldSave, cleanup, currentSave]);

    expect((await loadSubmissionDraft(7, 42))?.text).toBe('Current session draft');
  });

  it('clears only the signed-out user authored drafts and retry copies', async () => {
    const failed = { author: storedAuthor, client_status: 'failed' } as Message;
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
