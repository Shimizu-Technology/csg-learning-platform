export const MESSAGE_BODY_LIMIT = 5_000;

export interface FailedSendIntent {
  body: string;
  clientMessageId: string;
}

export function createClientMessageId() {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (randomUuid) return randomUuid.call(globalThis.crypto);

  const random = Math.random().toString(36).slice(2);
  return `message-${Date.now().toString(36)}-${random}`;
}

export function clientMessageIdForSend(body: string, failedIntent?: FailedSendIntent | null) {
  return failedIntent?.body.trim() === body.trim() ? failedIntent.clientMessageId : createClientMessageId();
}

export function messageBodyWithinLimit(value: string) {
  return messageBodyLength(value) <= MESSAGE_BODY_LIMIT;
}

export function messageBodyLength(value: string) {
  return Array.from(value).length;
}

export function messageBodyChangeAllowed(currentValue: string, nextValue: string) {
  return messageBodyWithinLimit(nextValue) || messageBodyLength(nextValue) < messageBodyLength(currentValue);
}

export function messageInsertionWithinLimit(nextValue: string, nextCursor: number) {
  if (!messageBodyWithinLimit(nextValue)) return null;
  return { value: nextValue, cursor: Math.min(nextCursor, nextValue.length) };
}
