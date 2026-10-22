import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { useSession } from '@/providers/session-provider';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { openExternalPage } from '@/lib/external-links';

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? true : () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn() }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: jest.fn() }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openExternalPage: jest.fn() }));
// eslint-disable-next-line import/first
import ResourcesScreen from '../../app/(app)/resources';

const download = jest.fn();
const resources = jest.fn();
const zip = { id: 'file-2', download_id: 2, curriculum_id: 6, title: 'Python starter', filename: 'python.zip', file_size: 2048, url: '', category: 'download', description: 'Course learner ZIP', cohort_id: 4 };
let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  jest.mocked(useSession).mockReturnValue({ user: { id: 1 }, api: { resources, downloadCurriculumResource: download } } as unknown as ReturnType<typeof useSession>);
  jest.mocked(useCsgAuth).mockReturnValue({ demo: false } as ReturnType<typeof useCsgAuth>);
  jest.mocked(useCohort).mockReturnValue({ selectedCohortId: 4 } as ReturnType<typeof useCohort>);
  jest.mocked(openExternalPage).mockResolvedValue(undefined);
  resources.mockResolvedValue({ resources: [zip, { id: 1, title: 'Reference', url: 'https://example.com/reference', category: 'links', cohort_id: 4 }, { ...zip, id: 'file-3', title: 'Other course', cohort_id: 9 }] });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => { client.clear(); jest.restoreAllMocks(); });
function mount() { return render(<QueryClientProvider client={client}><ResourcesScreen /></QueryClientProvider>); }

test('lists cohort ZIP files beside links and prepares a fresh signed URL on every tap', async () => {
  let resolve!: (value: { url: string }) => void;
  download.mockImplementationOnce(() => new Promise((done) => { resolve = done; })).mockResolvedValue({ url: 'https://example.com/fresh-second.zip' });
  const screen = mount();
  await screen.findByText('Python starter');
  expect(screen.getByText('Cohort links')).toBeTruthy();
  expect(screen.getByText('Course files')).toBeTruthy();
  expect(screen.getByText('Downloadable materials shared across cohorts using this curriculum.')).toBeTruthy();
  expect(screen.getByText('python.zip · 2.0 KB')).toBeTruthy();
  expect(screen.queryByText('Other course')).toBeNull();
  expect(download).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Download ZIP' }));
  expect(screen.getByText('Preparing download…')).toBeTruthy();
  expect(download).toHaveBeenCalledWith(6, 2);
  resolve({ url: 'https://example.com/fresh-first.zip' });
  await screen.findByRole('button', { name: 'Download ZIP' });
  expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/fresh-first.zip');
  fireEvent.press(screen.getByRole('button', { name: 'Download ZIP' }));
  await waitFor(() => expect(Linking.openURL).toHaveBeenLastCalledWith('https://example.com/fresh-second.zip'));
  expect(download).toHaveBeenCalledTimes(2);
  fireEvent.press(screen.getByRole('button', { name: 'Open Reference' }));
  expect(openExternalPage).toHaveBeenCalledWith('https://example.com/reference');
  expect(JSON.stringify(client.getQueryData(['learning', 1, 'resources']))).not.toContain('fresh-first');
});
test('shows failures and retries preparation without opening empty or unsafe links', async () => {
  download.mockRejectedValueOnce(new Error('Course file storage is unavailable')).mockResolvedValueOnce({ url: '' }).mockResolvedValue({ url: 'https://example.com/retry.zip' });
  const screen = mount();
  await screen.findByRole('button', { name: 'Download ZIP' });
  fireEvent.press(screen.getByRole('button', { name: 'Download ZIP' }));
  await screen.findByText('Course file storage is unavailable');
  expect(Linking.openURL).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Retry download' }));
  await screen.findByText('The download link is unavailable. Try again.');
  expect(Linking.openURL).not.toHaveBeenCalled();
  fireEvent.press(screen.getByRole('button', { name: 'Retry download' }));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://example.com/retry.zip'));
  expect(screen.queryByText('The download link is unavailable. Try again.')).toBeNull();
});
