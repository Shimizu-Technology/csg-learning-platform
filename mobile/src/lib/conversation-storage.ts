import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ConversationKind, Message } from './types';

export function conversationDraftKey(userId: number, kind: ConversationKind, id: number) {
  return `csg.message-draft.${userId}.${kind}.${id}`;
}

export function failedMessagesKey(userId: number, kind: ConversationKind, id: number) {
  return `csg.failed-messages.${userId}.${kind}.${id}`;
}

export function threadDraftKey(userId: number, rootMessageId: number) {
  return `csg.thread-draft.${userId}.${rootMessageId}`;
}

export async function loadConversationDraft(userId: number, kind: ConversationKind, id: number) {
  return (await AsyncStorage.getItem(conversationDraftKey(userId, kind, id))) || '';
}

export async function saveConversationDraft(userId: number, kind: ConversationKind, id: number, body: string) {
  const key = conversationDraftKey(userId, kind, id);
  if (body.trim()) await AsyncStorage.setItem(key, body);
  else await AsyncStorage.removeItem(key);
}

export async function loadThreadDraft(userId: number, rootMessageId: number) {
  return (await AsyncStorage.getItem(threadDraftKey(userId, rootMessageId))) || '';
}

export async function saveThreadDraft(userId: number, rootMessageId: number, body: string) {
  const key = threadDraftKey(userId, rootMessageId);
  if (body.trim()) await AsyncStorage.setItem(key, body);
  else await AsyncStorage.removeItem(key);
}

export async function loadFailedMessages(userId: number, kind: ConversationKind, id: number) {
  const value = await AsyncStorage.getItem(failedMessagesKey(userId, kind, id));
  if (!value) return [];
  try {
    const messages = JSON.parse(value) as Message[];
    return messages.filter((message) => message.client_status === 'failed');
  } catch {
    await AsyncStorage.removeItem(failedMessagesKey(userId, kind, id));
    return [];
  }
}

export async function saveFailedMessages(userId: number, kind: ConversationKind, id: number, messages: Message[]) {
  const failed = messages.filter((message) => message.client_status === 'failed');
  const key = failedMessagesKey(userId, kind, id);
  if (failed.length) await AsyncStorage.setItem(key, JSON.stringify(failed));
  else await AsyncStorage.removeItem(key);
}

export async function clearUserConversationStorage(userId: number) {
  const prefixes = [
    `csg.message-draft.${userId}.`,
    `csg.thread-draft.${userId}.`,
    `csg.failed-messages.${userId}.`,
  ];
  const keys = (await AsyncStorage.getAllKeys()).filter((key) => prefixes.some((prefix) => key.startsWith(prefix)));
  if (keys.length) await AsyncStorage.multiRemove(keys);
}
