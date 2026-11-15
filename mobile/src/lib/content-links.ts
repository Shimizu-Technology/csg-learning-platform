import { Linking } from 'react-native';
import { router, type Href } from 'expo-router';
import { brand } from './brand';
import { descriptorFromPath, isAllowedNotificationPath } from './notification-path';
import { toNativeHref } from './record-destination';
import { openExternalPage } from './external-links';

/** Only canonical, allowlisted app paths cross the navigation boundary. */
export function nativeContentHref(value: string, origins = [brand.appUrl, 'https://learn.codeschoolofguam.com']): string | null {
  if (/[\s\\]/.test(value) || value.startsWith('//')) return null;
  let path = value;
  if (!value.startsWith('/')) {
    try {
      const url = new URL(value);
      if (url.username || url.password || !origins.includes(url.origin)) return null;
      // Reject normalization (dot segments, encoded path delimiters) before parsing.
      path = value === url.origin ? '/' : value.slice(value.indexOf('/', value.indexOf('://') + 3));
      if (!path.startsWith('/') || path !== url.pathname + url.search + url.hash) return null;
    } catch { return null; }
  }
  const mapped = toNativeHref(descriptorFromPath(path));
  return mapped && isAllowedNotificationPath(mapped) ? mapped : isAllowedNotificationPath(path) ? path : null;
}

export async function openContentLink(value: string) {
  if (/^mailto:[^\s@]+@[^\s@]+$/i.test(value)) { await Linking.openURL(value); return; }
  const href = nativeContentHref(value);
  if (href) { router.push(href as Href); return; }
  // Relative paths without native destinations still open within the school origin.
  if (value.startsWith('/') && !value.startsWith('//') && !/[\s\\]/.test(value)) {
    await openExternalPage(`${brand.appUrl}${value}`);
    return;
  }
  await openExternalPage(value);
}
