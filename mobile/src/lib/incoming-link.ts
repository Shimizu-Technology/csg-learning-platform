import { brand } from './brand';
import { mobileNotificationPath } from './notification-path';
let pending: string | null = null;
const listeners = new Set<() => void>();
export function peekIncomingLink() { return pending; }
export function takeIncomingLink() { const path = pending; pending = null; return path; }
export function subscribeIncomingLink(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
export function incomingPath(path: string) {
  try {
    let value = path;
    if (!path.startsWith('/')) {
      const url = new URL(path);
      if (url.protocol === 'https:' && url.origin === new URL(brand.appUrl).origin) value = url.pathname + url.search + url.hash;
      else if (['csglearn:', 'csgconnect:'].includes(url.protocol)) value = (url.host ? '/' + url.host : '') + url.pathname + url.search + url.hash;
      else return '/link-unavailable';
    }
    return mobileNotificationPath(value);
  } catch { return '/link-unavailable'; }
}
export function queueIncomingLink(path: string) { pending = incomingPath(path); listeners.forEach(listener => listener()); }

export function clearIncomingLink() { pending = null; listeners.forEach(listener => listener()); }
