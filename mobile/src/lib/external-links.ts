import * as WebBrowser from 'expo-web-browser';

import { safeExternalUrl } from './learning';
import type { CsgApi } from './api';

export async function openExternalPage(value: string | null | undefined) {
  const url = safeExternalUrl(value);
  if (!url) throw new Error('This link is not a valid web address.');
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    controlsColor: '#C51D34',
  });
}

export async function openAuthenticatedWebLesson(api: CsgApi, lessonId: number) {
  const result = await api.webHandoff(`/lessons/${lessonId}`);
  await openExternalPage(result.url);
}
