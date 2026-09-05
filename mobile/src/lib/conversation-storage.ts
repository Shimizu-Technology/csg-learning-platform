import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationKind, Message } from './types';

const authoredStorageWrites = new Map<string, Promise<void>>();

function enqueueStorageWrite(key: string, operation: () => Promise<void>) {
  const previous = authoredStorageWrites.get(key) || Promise.resolve();
  const write = previous.catch(() => undefined).then(operation);
  authoredStorageWrites.set(key, write);
  return write.finally(() => {
    if (authoredStorageWrites.get(key) === write) authoredStorageWrites.delete(key);
  });
}

async function readAfterPendingWrites(key: string) {
  await authoredStorageWrites.get(key)?.catch(() => undefined);
  return AsyncStorage.getItem(key);
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
  clientMessageId: string | null;
}

export async function loadConversationDraft(userId: number, kind: ConversationKind, id: number) {
  return (await readAfterPendingWrites(conversationDraftKey(userId, kind, id))) || '';
}

export function saveConversationDraft(userId: number, kind: ConversationKind, id: number, body: string) {
  const key = conversationDraftKey(userId, kind, id);
  return enqueueStorageWrite(key, () => body.trim() ? AsyncStorage.setItem(key, body) : AsyncStorage.removeItem(key));
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
  const value = await readAfterPendingWrites(threadDraftKey(userId, rootMessageId));
  if (!value) return { body: '', clientMessageId: null };
  try {
    const stored = JSON.parse(value) as { version?: unknown; body?: unknown; clientMessageId?: unknown };
    if (stored.version === 1 && typeof stored.body === 'string') {
      return { body: stored.body, clientMessageId: typeof stored.clientMessageId === 'string' ? stored.clientMessageId : null };
    }
  } catch {
    // Existing drafts were stored as plain text and remain valid.
  }
  return { body: value, clientMessageId: null };
}

export function saveThreadDraft(userId: number, rootMessageId: number, body: string, clientMessageId?: string | null) {
  const key = threadDraftKey(userId, rootMessageId);
  return enqueueStorageWrite(key, () => {
    if (body.trim() && clientMessageId) return AsyncStorage.setItem(key, JSON.stringify({ version: 1, body, clientMessageId }));
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
  const value = await readAfterPendingWrites(key);
  if (!value) return [];
  try {
    const messages = JSON.parse(value) as Message[];
    return messages.filter((message) => message.client_status === 'failed');
  } catch {
    await AsyncStorage.removeItem(key);
    return [];
  }
}

export function saveFailedMessages(userId: number, kind: ConversationKind, id: number, messages: Message[]) {
  const failed = messages.filter((message) => message.client_status === 'failed');
  const key = failedMessagesKey(userId, kind, id);
  return enqueueStorageWrite(key, async () => {
    if (failed.length) await AsyncStorage.setItem(key, JSON.stringify(failed));
    else await AsyncStorage.removeItem(key);
  });
}

export async function clearUserConversationStorage(userId: number) {
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
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
