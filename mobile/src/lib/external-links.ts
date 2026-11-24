import { Appearance } from 'react-native';
import { themes } from '@/constants/csg-theme';
import * as WebBrowser from 'expo-web-browser';

import { safeExternalUrl } from './learning';
import { ApiError, type CsgApi } from './api';
import { brand } from './brand';

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

const handoffClosed = new Set<() => void>();
export function onWebHandoffClosed(listener: () => void) { handoffClosed.add(listener); return () => { handoffClosed.delete(listener); }; }

export async function openAuthenticatedWebPage(api: CsgApi, destination: string) {
  const result = await api.webHandoff(destination);
  await openExternalPage(result.url);
  handoffClosed.forEach(listener => listener());
}

export function githubIssueUrl(value: string | null | undefined) {
  return value && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/issues\/[1-9]\d*\/?$/.test(value) ? value : null;
}

export async function openWebTask(api: CsgApi, destination: string) {
  const url = new URL(destination, brand.appUrl);
  if (url.origin !== brand.appUrl || !destination.startsWith('/')) throw new Error('Invalid web task destination.');
  try {
    await openAuthenticatedWebPage(api, destination);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 422) throw error;
    await openExternalPage(url.href);
    handoffClosed.forEach(listener => listener());
  }
}
