import { descriptorFromPath, isAllowedNotificationPath } from './notification-path';
import { toNativeHref } from './record-destination';

export function nativeContentPath(path: string): string | null {
  if (path === '/messages' || path === '/profile') return path;
  const mapped = toNativeHref(descriptorFromPath(path));
  return mapped && isAllowedNotificationPath(mapped) ? mapped : isAllowedNotificationPath(path) ? path : null;
}
