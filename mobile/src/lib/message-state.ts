import type { Message, MessageEvent } from './types';

export function sortMessages(messages: Message[]) {
  return [...messages].sort((left, right) => {
    const time = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    return time || left.id - right.id;
  });
}

export function mergeMessageEvent(messages: Message[], payload: MessageEvent) {
  if (payload.event === 'created') {
    return messages.some((message) => message.id === payload.message.id)
      ? messages.map((message) => message.id === payload.message.id ? { ...message, ...payload.message } : message)
      : sortMessages([...messages, payload.message]);
  }

  if (payload.event === 'deleted') {
    return messages.filter((message) => message.id !== payload.message.id);
  }

  return messages.map((message) => message.id === payload.message.id ? { ...message, ...payload.message } : message);
}

export function mergePinnedMessageEvent(messages: Message[], payload: MessageEvent) {
  const withoutMessage = messages.filter((message) => message.id !== payload.message.id);
  return payload.event !== 'deleted' && payload.message.pinned_at
    ? [payload.message, ...withoutMessage]
    : withoutMessage;
}

export function reconcileOptimistic(messages: Message[], optimisticId: number, canonical: Message) {
  return sortMessages([...messages.filter((message) => message.id !== optimisticId && message.id !== canonical.id), canonical]);
}

export function prependOlderMessages(current: Message[], older: Message[]) {
  const ids = new Set(current.map((message) => message.id));
  return sortMessages([...older.filter((message) => !ids.has(message.id)), ...current]);
}
