import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useColorScheme } from 'react-native';
import * as SystemUI from 'expo-system-ui';
import { themes, type CsgTheme } from '@/constants/csg-theme';

export type ThemePreference = 'system' | 'light' | 'dark';

const STORAGE_KEY = '@csg/theme-preference';

type StorageLike = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
};

function getAsyncStorage(): StorageLike | null {
  try {
    // Lazy require avoids crashing Jest suites that do not mock the native AsyncStorage module.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@react-native-async-storage/async-storage');
    const storage = (mod?.default ?? mod) as StorageLike | undefined;
    if (storage && typeof storage.getItem === 'function' && typeof storage.setItem === 'function') return storage;
    return null;
  } catch {
    return null;
  }
}

const ThemeContext = createContext<CsgTheme | null>(null);
const ThemePreferenceContext = createContext<{
  preference: ThemePreference;
  setPreference: (next: ThemePreference) => void;
}>({
  preference: 'system',
  setPreference: () => undefined,
});

function isThemePreference(value: string | null): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const osScheme = useColorScheme() === 'dark' ? 'dark' : 'light';
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const explicitSelectionRef = useRef(false);

  useEffect(() => {
    const storage = getAsyncStorage();
    if (!storage) return;
    let mounted = true;
    void storage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (mounted && !explicitSelectionRef.current && isThemePreference(stored)) setPreferenceState(stored);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const setPreference = useCallback((next: ThemePreference) => {
    explicitSelectionRef.current = true;
    setPreferenceState(next);
    const storage = getAsyncStorage();
    if (storage) void storage.setItem(STORAGE_KEY, next).catch(() => undefined);
  }, []);

  const resolvedScheme = preference === 'system' ? osScheme : preference;
  const theme = themes[resolvedScheme];
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(theme.colors.surface.page);
  }, [theme]);

  const prefValue = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);

  return (
    <ThemePreferenceContext.Provider value={prefValue}>
      <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>
    </ThemePreferenceContext.Provider>
  );
}

/** Falls back to the phone appearance in isolated tests and native error fallbacks. */
export function useTheme() {
  const provided = useContext(ThemeContext);
  const scheme = useColorScheme();
  return provided ?? themes[scheme === 'dark' ? 'dark' : 'light'];
}

export function useThemePreference() {
  return useContext(ThemePreferenceContext);
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
