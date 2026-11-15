import { brand } from './brand';
import { nativeContentPath } from './native-content-path';

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
  return nativeContentPath(path);
}

