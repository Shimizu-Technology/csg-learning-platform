import { Appearance } from 'react-native';
import { themes } from '@/constants/csg-theme';
import * as WebBrowser from 'expo-web-browser';

import { safeExternalUrl } from './learning';
import type { CsgApi } from './api';

export async function openExternalPage(value: string | null | undefined) {
  const url = safeExternalUrl(value);
  if (!url) throw new Error('This link is not a valid web address.');
  await WebBrowser.openBrowserAsync(url, {
    presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
    controlsColor: themes[Appearance.getColorScheme() === 'dark' ? 'dark' : 'light'].colors.action.primary,
  });
}

export async function openAuthenticatedWebLesson(api: CsgApi, lessonId: number, cohortId?: number | null, blockId?: number) {
  await openAuthenticatedWebPage(api, `/lessons/${lessonId}${cohortId ? `?cohort_id=${cohortId}` : ''}${blockId ? `#block-${blockId}` : ''}`);
}

export async function openAuthenticatedWebPage(api: CsgApi, destination: string) {
  const result = await api.webHandoff(destination);
  await openExternalPage(result.url);
}
