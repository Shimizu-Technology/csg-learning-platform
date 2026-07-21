const CONVERSATION_PATH = /^\/conversation\/(channel|dm)\/\d+$/;

export function isAllowedNotificationPath(value: unknown): value is string {
  return value === '/updates' || (typeof value === 'string' && CONVERSATION_PATH.test(value));
}
