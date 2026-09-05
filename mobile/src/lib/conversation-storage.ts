import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationKind, Message } from './types';
import {
  activateUserStorage,
  beginUserStorageCleanup,
  userStorageCleanupIsCurrent,
  userStorageGeneration,
  userStorageGenerationIsCurrent,
} from './user-storage-lifecycle';

const authoredStorageWrites = new Map<string, Promise<void>>();

function enqueueStorageWrite(userId: number, key: string, operation: () => Promise<void>) {
  const generation = userStorageGeneration(userId);
  const previous = authoredStorageWrites.get(key) || Promise.resolve();
  const write = previous.catch(() => undefined).then(() => {
    if (!userStorageGenerationIsCurrent(userId, generation)) return;
    return operation();
  });
  authoredStorageWrites.set(key, write);
  return write.finally(() => {
    if (authoredStorageWrites.get(key) === write) authoredStorageWrites.delete(key);
  });
}

async function readAfterPendingWrites(userId: number, key: string) {
  const generation = userStorageGeneration(userId);
  while (true) {
    const pending = authoredStorageWrites.get(key);
    if (!pending) break;
    await pending.catch(() => undefined);
    if (authoredStorageWrites.get(key) === pending) break;
  }
  if (!userStorageGenerationIsCurrent(userId, generation)) return null;
  const value = await AsyncStorage.getItem(key);
  return userStorageGenerationIsCurrent(userId, generation) ? value : null;
}

export function activateUserConversationStorage(userId: number) {
  activateUserStorage(userId);
}

export function conversationDraftKey(userId: number, kind: ConversationKind, id: number) {
  return `csg.message-draft.${userId}.${kind}.${id}`;
}

export function failedMessagesKey(userId: number, kind: ConversationKind, id: number) {
  return `csg.failed-messages.${userId}.${kind}.${id}`;
}

export function threadDraftKey(userId: number, rootMessageId: number) {
  return `csg.thread-draft.${userId}.${rootMessageId}`;
}

export interface StoredThreadDraft {
  body: string;
  failedSend: { body: string; clientMessageId: string } | null;
}

export async function loadConversationDraft(userId: number, kind: ConversationKind, id: number) {
  return (await readAfterPendingWrites(userId, conversationDraftKey(userId, kind, id))) || '';
}

export function saveConversationDraft(userId: number, kind: ConversationKind, id: number, body: string) {
  const key = conversationDraftKey(userId, kind, id);
  return enqueueStorageWrite(userId, key, () => body.trim() ? AsyncStorage.setItem(key, body) : AsyncStorage.removeItem(key));
}

export async function clearConversationDraftAfterSend(
  userId: number,
  kind: ConversationKind,
  id: number,
  saveDraft = saveConversationDraft,
) {
  await saveDraft(userId, kind, id, '').catch(() => undefined);
}

export async function loadThreadDraft(userId: number, rootMessageId: number) {
  return (await loadStoredThreadDraft(userId, rootMessageId)).body;
}

export async function loadStoredThreadDraft(userId: number, rootMessageId: number): Promise<StoredThreadDraft> {
  const value = await readAfterPendingWrites(userId, threadDraftKey(userId, rootMessageId));
  if (!value) return { body: '', failedSend: null };
  try {
    const stored = JSON.parse(value) as { version?: unknown; body?: unknown; failedBody?: unknown; clientMessageId?: unknown };
    if (stored.version === 2 && typeof stored.body === 'string') {
      const failedSend = typeof stored.failedBody === 'string' && typeof stored.clientMessageId === 'string'
        ? { body: stored.failedBody, clientMessageId: stored.clientMessageId }
        : null;
      return { body: stored.body, failedSend };
    }
    if (stored.version === 1 && typeof stored.body === 'string') {
      const failedSend = typeof stored.clientMessageId === 'string'
        ? { body: stored.body.trim(), clientMessageId: stored.clientMessageId }
        : null;
      return { body: failedSend ? '' : stored.body, failedSend };
    }
  } catch {
    // Existing drafts were stored as plain text and remain valid.
  }
  return { body: value, failedSend: null };
}

export function saveThreadDraft(userId: number, rootMessageId: number, body: string, clientMessageId?: string | null) {
  return saveThreadDraftState(
    userId,
    rootMessageId,
    body,
    clientMessageId ? { body: body.trim(), clientMessageId } : null,
  );
}

export function saveThreadDraftState(
  userId: number,
  rootMessageId: number,
  body: string,
  failedSend: StoredThreadDraft['failedSend'],
) {
  const key = threadDraftKey(userId, rootMessageId);
  return enqueueStorageWrite(userId, key, () => {
    if (failedSend) return AsyncStorage.setItem(key, JSON.stringify({ version: 2, body, failedBody: failedSend.body, clientMessageId: failedSend.clientMessageId }));
    if (body.trim()) return AsyncStorage.setItem(key, body);
    return AsyncStorage.removeItem(key);
  });
}

export async function clearThreadDraftAfterSend(
  userId: number,
  rootMessageId: number,
  saveDraft = saveThreadDraft,
) {
  await saveDraft(userId, rootMessageId, '').catch(() => undefined);
}

export async function loadFailedMessages(userId: number, kind: ConversationKind, id: number) {
  const key = failedMessagesKey(userId, kind, id);
  const value = await readAfterPendingWrites(userId, key);
  if (!value) return [];
  try {
    const messages = JSON.parse(value) as Message[];
    return retryableMessagesForStorage(messages);
  } catch {
    await enqueueStorageWrite(userId, key, async () => {
      if (await AsyncStorage.getItem(key) === value) await AsyncStorage.removeItem(key);
    }).catch(() => undefined);
    return [];
  }
}

export function retryableMessagesForStorage(messages: Message[]) {
  return messages.flatMap((message) => {
    if (message.client_status === 'failed') return [message];
    if (message.client_status !== 'sending') return [];
    return [{
      ...message,
      client_status: 'failed' as const,
      client_error: message.client_error || 'Send interrupted. Try again.',
    }];
  });
}

export function saveFailedMessages(userId: number, kind: ConversationKind, id: number, messages: Message[]) {
  const failed = retryableMessagesForStorage(messages);
  const key = failedMessagesKey(userId, kind, id);
  return enqueueStorageWrite(userId, key, async () => {
    if (failed.length) await AsyncStorage.setItem(key, JSON.stringify(failed));
    else await AsyncStorage.removeItem(key);
  });
}

export async function saveFailedMessagesWithRetry(
  userId: number,
  kind: ConversationKind,
  id: number,
  messages: Message[],
  shouldContinue: () => boolean = () => true,
  waitForRetry: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await saveFailedMessages(userId, kind, id, messages);
      return true;
    } catch {
      if (attempt === maxAttempts || !shouldContinue()) return false;
      await waitForRetry(250 * (2 ** (attempt - 1)));
      if (!shouldContinue()) return false;
    }
  }
  return false;
}

export async function clearUserConversationStorage(userId: number, sharedCleanup = beginUserStorageCleanup(userId)) {
  const prefixes = [
    `csg.message-draft.${userId}.`,
    `csg.thread-draft.${userId}.`,
    `csg.failed-messages.${userId}.`,
  ];
  const pendingWrites = Array.from(authoredStorageWrites.entries())
    .filter(([key]) => prefixes.some((prefix) => key.startsWith(prefix)))
    .map(([, write]) => write.catch(() => undefined));
  await Promise.all(pendingWrites);
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
  if (!userStorageCleanupIsCurrent(sharedCleanup)) return;
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
