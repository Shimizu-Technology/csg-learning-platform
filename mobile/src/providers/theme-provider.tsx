import { createContext, useContext, useEffect, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { themes, type CsgTheme } from '@/constants/csg-theme';

const ThemeContext = createContext<CsgTheme | null>(null);
export function ThemeProvider({ children }: PropsWithChildren) {
  const scheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const theme = themes[scheme];
  useEffect(() => { void SystemUI.setBackgroundColorAsync(theme.colors.surface.page); }, [theme]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}
/** Falls back to the phone appearance in isolated tests and native error fallbacks. */
export function useTheme() {
  const provided = useContext(ThemeContext);
  const scheme = useColorScheme();
  return provided ?? themes[scheme === 'dark' ? 'dark' : 'light'];
}
/** Styles are built at most once per scheme, never per render. */
export function makeStyles<T>(factory: (theme: CsgTheme) => T) {
  const cache = new Map<CsgTheme, T>();
  return function useStyles() {
    const theme = useTheme();
    if (!cache.has(theme)) cache.set(theme, factory(theme));
    return cache.get(theme)!;
  };
}
