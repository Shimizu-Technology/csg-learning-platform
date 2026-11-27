import AsyncStorage from '@react-native-async-storage/async-storage';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import { ThemeProvider, makeStyles, useTheme, useThemePreference } from '../theme-provider';

let mockScheme: 'light' | 'dark' | null = null;
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
  },
}));
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn().mockResolvedValue(undefined) }));

beforeEach(() => {
  mockScheme = null;
  jest.clearAllMocks();
});

it('defaults light, switches live, and reuses scheme style objects', () => {
  const factory = jest.fn((theme) => ({ foreground: theme.colors.text.strong }));
  const useStyles = makeStyles(factory);
  const seen: unknown[] = [];
  function Probe() {
    const theme = useTheme();
    const styles = useStyles();
    seen.push(styles);
    return <Text>{theme.scheme}</Text>;
  }
  const ui = render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(ui.getByText('light')).toBeTruthy();
  mockScheme = 'dark';
  ui.rerender(<ThemeProvider><Probe /></ThemeProvider>);
  expect(ui.getByText('dark')).toBeTruthy();
  mockScheme = 'light';
  ui.rerender(<ThemeProvider><Probe /></ThemeProvider>);
  expect(factory).toHaveBeenCalledTimes(2);
  expect(seen[0]).toBe(seen[seen.length - 1]);
});

it('persists and applies in-app light/dark/system theme overrides', async () => {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce('dark');

  function Probe() {
    const theme = useTheme();
    const { preference, setPreference } = useThemePreference();
    return (
      <>
        <Text testID="scheme">{`${preference}:${theme.scheme}`}</Text>
        <Pressable accessibilityRole="button" onPress={() => setPreference('light')}>
          <Text>Use light</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={() => setPreference('system')}>
          <Text>Use system</Text>
        </Pressable>
      </>
    );
  }

  const ui = render(<ThemeProvider><Probe /></ThemeProvider>);
  await waitFor(() => expect(ui.getByTestId('scheme').props.children).toBe('dark:dark'));

  act(() => { fireEvent.press(ui.getByText('Use light')); });
  expect(ui.getByTestId('scheme').props.children).toBe('light:light');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('@csg/theme-preference', 'light');

  mockScheme = 'dark';
  act(() => { fireEvent.press(ui.getByText('Use system')); });
  expect(ui.getByTestId('scheme').props.children).toBe('system:dark');
  expect(AsyncStorage.setItem).toHaveBeenCalledWith('@csg/theme-preference', 'system');
});

it('ignores late AsyncStorage hydration after an explicit preference selection', async () => {
  let resolveStored!: (value: string | null) => void;
  (AsyncStorage.getItem as jest.Mock).mockImplementationOnce(
    () => new Promise<string | null>((resolve) => { resolveStored = resolve; }),
  );

  function Probe() {
    const theme = useTheme();
    const { preference, setPreference } = useThemePreference();
    return (
      <>
        <Text testID="scheme">{`${preference}:${theme.scheme}`}</Text>
        <Pressable accessibilityRole="button" onPress={() => setPreference('light')}>
          <Text>Pick light</Text>
        </Pressable>
      </>
    );
  }

  const ui = render(<ThemeProvider><Probe /></ThemeProvider>);
  act(() => { fireEvent.press(ui.getByText('Pick light')); });
  expect(ui.getByTestId('scheme').props.children).toBe('light:light');

  await act(async () => { resolveStored('dark'); });
  expect(ui.getByTestId('scheme').props.children).toBe('light:light');
});
