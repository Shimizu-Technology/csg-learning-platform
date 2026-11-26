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
const MAX_PENDING_WRITE_DRAINS = 10;
const draftChangeListeners = new Set<() => void>();

export function subscribeDraftChanges(listener: () => void) {
  draftChangeListeners.add(listener);
  return () => { draftChangeListeners.delete(listener); };
}

function notifyDraftChange() {
  draftChangeListeners.forEach((listener) => {
    try { listener(); } catch { /* ignore subscriber error */ }
  });
}

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
  let pending = authoredStorageWrites.get(key);
  for (let drain = 0; pending && drain < MAX_PENDING_WRITE_DRAINS; drain += 1) {
    await pending.catch(() => undefined);
    const newestPending = authoredStorageWrites.get(key);
    pending = newestPending === pending ? undefined : newestPending;
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

export async function loadConversationDrafts(
  userId: number,
  targets: { kind: ConversationKind; id: number }[],
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (!userId || targets.length === 0) return result;
  const generation = userStorageGeneration(userId);
  const keyToTarget = new Map<string, string>();
  const keys: string[] = [];
  for (const target of targets) {
    const key = conversationDraftKey(userId, target.kind, target.id);
    if (!keyToTarget.has(key)) {
      keyToTarget.set(key, `${target.kind}:${target.id}`);
      keys.push(key);
    }
  }
  try {
    const pairs = await AsyncStorage.multiGet(keys);
    if (!userStorageGenerationIsCurrent(userId, generation)) return new Map();
    for (const [key, value] of pairs) {
      const targetKey = keyToTarget.get(key);
      if (targetKey && value?.trim()) result.set(targetKey, value);
    }
  } catch {
    return new Map();
  }
  return result;
}

export function saveConversationDraft(userId: number, kind: ConversationKind, id: number, body: string) {
  const key = conversationDraftKey(userId, kind, id);
  return enqueueStorageWrite(userId, key, async () => {
    if (body.trim()) await AsyncStorage.setItem(key, body);
    else await AsyncStorage.removeItem(key);
    notifyDraftChange();
  });
}

export async function saveConversationDraftWithRetry(
  userId: number,
  kind: ConversationKind,
  id: number,
  body: string,
  shouldContinue: () => boolean = () => true,
  waitForRetry: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  const maxAttempts = 3;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await saveConversationDraft(userId, kind, id, body);
      return true;
    } catch {
      if (attempt === maxAttempts || !shouldContinue()) return false;
      await waitForRetry(250 * (2 ** (attempt - 1)));
      if (!shouldContinue()) return false;
    }
  }
  return false;
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
    if (!message || typeof message !== 'object' || !message.author || !Number.isInteger(message.author.id)) return [];
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
