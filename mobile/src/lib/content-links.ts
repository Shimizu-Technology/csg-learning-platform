import { Linking } from 'react-native';
import { router, type Href } from 'expo-router';
import { brand } from './brand';
import { nativeContentHref } from './native-content-href';
export { nativeContentHref } from './native-content-href';
import { openExternalPage } from './external-links';

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
