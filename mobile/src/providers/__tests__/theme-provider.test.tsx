import { render } from '@testing-library/react-native';
import { Text } from 'react-native';
import { ThemeProvider, makeStyles, useTheme } from '../theme-provider';
let mockScheme: 'light' | 'dark' | null = null;
jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({ __esModule: true, default: () => mockScheme }));
jest.mock('expo-system-ui', () => ({ setBackgroundColorAsync: jest.fn().mockResolvedValue(undefined) }));
it('defaults light, switches live, and reuses scheme style objects', () => {
  const factory = jest.fn((theme) => ({ foreground: theme.colors.text.strong }));
  const useStyles = makeStyles(factory);
  const seen: unknown[] = [];
  function Probe() { const theme = useTheme(); const styles = useStyles(); seen.push(styles); return <Text>{theme.scheme}</Text>; }
  const ui = render(<ThemeProvider><Probe /></ThemeProvider>);
  expect(ui.getByText('light')).toBeTruthy();
  mockScheme = 'dark'; ui.rerender(<ThemeProvider><Probe /></ThemeProvider>); expect(ui.getByText('dark')).toBeTruthy();
  mockScheme = 'light'; ui.rerender(<ThemeProvider><Probe /></ThemeProvider>);
  expect(factory).toHaveBeenCalledTimes(2); expect(seen[0]).toBe(seen[seen.length-1]);
});
