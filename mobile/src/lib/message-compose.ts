export const MESSAGE_BODY_LIMIT = 5_000;

export function createClientMessageId() {
  const randomUuid = globalThis.crypto?.randomUUID;
  if (randomUuid) return randomUuid.call(globalThis.crypto);

  const random = Math.random().toString(36).slice(2);
  return `message-${Date.now().toString(36)}-${random}`;
}
