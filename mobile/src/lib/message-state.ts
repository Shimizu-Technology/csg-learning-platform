import type { Message, MessageEvent } from './types';

function clientMessageKey(message: Message) {
  return message.client_message_id && message.author ? `${message.author.id}:${message.client_message_id}` : null;
}

function sameClientMessage(left: Message, right: Message) {
  const leftKey = clientMessageKey(left);
  return Boolean(leftKey && leftKey === clientMessageKey(right));
}

function clientMessageKeys(messages: Message[]) {
  return new Set(messages.map(clientMessageKey).filter((key): key is string => key !== null));
}

export function sortMessages(messages: Message[]) {
  return [...messages].sort((left, right) => {
    const time = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
    return time || left.id - right.id;
  });
}

export function mergeMessageEvent(messages: Message[], payload: MessageEvent) {
  if (payload.event === 'created') {
    const matchingClientId = payload.message.client_message_id
      ? messages.find((message) => sameClientMessage(message, payload.message))?.id
      : undefined;
    const matchingId = matchingClientId ?? payload.message.id;
    return messages.some((message) => message.id === matchingId)
      ? sortMessages(messages
          .filter((message) => message.id === matchingId || message.id !== payload.message.id)
          .map((message) => message.id === matchingId ? { ...message, ...payload.message, client_status: undefined, client_error: undefined } : message))
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
  return sortMessages([
    ...messages.filter((message) => message.id !== optimisticId && message.id !== canonical.id && !sameClientMessage(message, canonical)),
    canonical,
  ]);
}

export function mergeServerAndFailedMessages(serverMessages: Message[], failedMessages: Message[]) {
  const deliveredClientIds = clientMessageKeys(serverMessages);
  return sortMessages([
    ...serverMessages,
    ...failedMessages.filter((message) => {
      const key = clientMessageKey(message);
      return !key || !deliveredClientIds.has(key);
    }),
  ]);
}

export function markOptimisticFailed(messages: Message[], optimistic: Message, error: string) {
  const alreadyDelivered = optimistic.client_message_id && messages.some((message) =>
    message.id !== optimistic.id &&
    sameClientMessage(message, optimistic) &&
    message.id > 0 &&
    message.client_status !== 'failed'
  );
  if (alreadyDelivered) return sortMessages(messages.filter((message) => message.id !== optimistic.id));

  const failed: Message = { ...optimistic, client_status: 'failed', client_error: error };
  return sortMessages([...messages.filter((message) => message.id !== failed.id), failed]);
}

export function prependOlderMessages(current: Message[], older: Message[]) {
  const ids = new Set(current.map((message) => message.id));
  return sortMessages([...older.filter((message) => !ids.has(message.id)), ...current]);
}

export function mergeOlderMessages(current: Message[], older: Message[]) {
  const deliveredClientIds = clientMessageKeys(older);
  const withoutDeliveredFailures = current.filter((message) => {
    const key = clientMessageKey(message);
    return message.client_status !== 'failed' || !key || !deliveredClientIds.has(key);
  });
  return prependOlderMessages(withoutDeliveredFailures, older);
}

export function toggleOwnReaction(message: Message, emoji: string, user: Message['author']): Message {
  const selected = message.reactions.find((reaction) => reaction.emoji === emoji);

  if (!selected) {
    return {
      ...message,
      reactions: [...message.reactions, { emoji, count: 1, reacted: true, users: [user] }],
    };
  }

  if (selected.reacted) {
    const count = Math.max(0, selected.count - 1);
    return {
      ...message,
      reactions: count === 0
        ? message.reactions.filter((reaction) => reaction.emoji !== emoji)
        : message.reactions.map((reaction) => reaction.emoji === emoji
          ? { ...reaction, count, reacted: false, users: reaction.users.filter((person) => person.id !== user.id) }
          : reaction),
    };
  }

  return {
    ...message,
    reactions: message.reactions.map((reaction) => reaction.emoji === emoji
      ? {
          ...reaction,
          count: reaction.count + 1,
          reacted: true,
          users: reaction.users.some((person) => person.id === user.id) ? reaction.users : [...reaction.users, user],
        }
      : reaction),
  };
}
