import { descriptorFromPath, isAllowedNotificationPath } from './notification-path';
import { toNativeHref } from './record-destination';

export function nativeContentPath(path: string): string | null {
  const mapped = toNativeHref(descriptorFromPath(path));
  return mapped && isAllowedNotificationPath(mapped) ? mapped : isAllowedNotificationPath(path) ? path : null;
}
