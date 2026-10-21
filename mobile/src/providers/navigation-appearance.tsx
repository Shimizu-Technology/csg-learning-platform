import { DarkTheme, DefaultTheme, ThemeProvider as NavigationThemeProvider } from 'expo-router';
import type { PropsWithChildren } from 'react';
import { themes } from '@/constants/csg-theme';
import { useTheme } from './theme-provider';
const navigationThemes = Object.fromEntries(Object.values(themes).map((theme) => [theme.scheme, {
  ...(theme.dark ? DarkTheme : DefaultTheme),
  colors: { ...(theme.dark ? DarkTheme : DefaultTheme).colors, primary: theme.colors.action.primary,
    background: theme.colors.surface.page, card: theme.colors.surface.raised, text: theme.colors.text.strong,
    border: theme.colors.border.subtle, notification: theme.colors.status.info.fg },
}]));
export function NavigationAppearance({ children }: PropsWithChildren) {
  const { scheme } = useTheme();
  return <NavigationThemeProvider value={navigationThemes[scheme]}>{children}</NavigationThemeProvider>;
}
