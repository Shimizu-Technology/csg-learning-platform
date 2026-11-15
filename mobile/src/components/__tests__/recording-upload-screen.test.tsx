import { Alert } from 'react-native';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import UploadScreen from '../../app/(app)/recordings/upload';

const mockPick = jest.fn();
const mockCohorts = jest.fn().mockResolvedValue({ cohorts: [] });
jest.mock('expo-document-picker', () => ({ getDocumentAsync: () => mockPick() }));
jest.mock('expo-file-system', () => ({ File: class { size = 100; type = 'application/octet-stream'; } }));
jest.mock('expo-router', () => ({ usePathname: () => '/', useRouter: () => ({ back: jest.fn() }) }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ user: { id: 1, is_staff: true }, api: { cohorts: mockCohorts } }) }));
jest.mock('@/lib/recording-upload', () => ({ MAX_RECORDING_SIZE: 5 * 1024 ** 3, uploadRecording: jest.fn() }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));

it.each(['mov', 'mp4'])('selects an octet-stream %s recording through the upload screen', async extension => {
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: `file:///class.${extension}`, name: `class.${extension}`, mimeType: 'application/octet-stream', size: 100 }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><UploadScreen /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Choose from Files or Photos')).toBeTruthy());
  await waitFor(() => expect(screen.getByText('Choose from Files or Photos')).toBeTruthy());
  fireEvent.press(screen.getByText('Choose from Files or Photos'));
  await waitFor(() => expect(screen.getByText(`class.${extension}`)).toBeTruthy());
  screen.unmount();
  client.clear();
});

it('rejects an unknown video with actionable format guidance', async () => {
  const alert = jest.spyOn(Alert, 'alert');
  mockPick.mockResolvedValue({ canceled: false, assets: [{ uri: 'file:///unknown', name: 'unknown', size: 100 }] });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const screen = render(<QueryClientProvider client={client}><UploadScreen /></QueryClientProvider>);
  await waitFor(() => expect(screen.getByText('Choose from Files or Photos')).toBeTruthy());
  fireEvent.press(screen.getByText('Choose from Files or Photos'));
  await waitFor(() => expect(alert).toHaveBeenCalledWith('Choose a video', 'Choose an .mp4 or .mov video.', undefined, expect.any(Object)));
  expect(screen.queryByText('unknown')).toBeNull();
  screen.unmount();
  client.clear();
  alert.mockRestore();
});
