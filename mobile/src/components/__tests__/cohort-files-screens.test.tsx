import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { useSession } from '@/providers/session-provider';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { themedAlert } from '@/lib/alerts';

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? true : () => null }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ cohort_id: '4' }), usePathname: () => '/', useRouter: () => ({ canGoBack: () => false, back: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: jest.fn() }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openExternalPage: jest.fn(), openAuthenticatedWebPage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
// eslint-disable-next-line import/first
import ResourcesScreen from '../../app/(app)/resources';
// eslint-disable-next-line import/first
import StaffCohortFilesScreen from '../../app/(app)/staff/files';

const file = (overrides: Record<string, unknown>) => ({
  id: 1, cohort_id: 4, student_id: null, source_file_id: null, folder: 'Slides', visibility: 'students', title: 'Week 1 Ruby Slides',
  description: null, filename: 'week-1-ruby-slides.pdf', content_type: 'application/pdf', file_size: 2048, ready: true,
  ready_at: '2026-11-24T00:00:00Z', created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ina Instructor', uploaded_by_role: 'staff', can_manage: false, ...overrides,
});
const resume = file({ id: 5, student_id: 3, folder: 'Resumes & Portfolio', title: 'Resume Draft v1', filename: 'resume-draft-v1.pdf', uploaded_by_role: 'student', can_manage: true });
const plan = file({ id: 6, student_id: 3, folder: 'Job Search & Career', title: 'Job Search Plan', filename: 'student-one-job-search-plan.docx' });
const api = {
  resources: jest.fn(), cohortFiles: jest.fn(), downloadCohortFile: jest.fn(), deleteCohortFile: jest.fn(), createCohortFile: jest.fn(), completeCohortFile: jest.fn(),
  cohorts: jest.fn(),
};
let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  jest.mocked(useSession).mockReturnValue({ user: { id: 3, is_staff: false }, api } as unknown as ReturnType<typeof useSession>);
  jest.mocked(useCsgAuth).mockReturnValue({ demo: false } as ReturnType<typeof useCsgAuth>);
  jest.mocked(useCohort).mockReturnValue({ selectedCohortId: 4 } as ReturnType<typeof useCohort>);
  api.resources.mockResolvedValue({ resources: [] });
  api.cohortFiles.mockResolvedValue({ class_files: [file({})], my_files: [resume, plan], folders: [], storage_configured: true, can_upload_personal: true });
  jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
});
afterEach(() => { client.clear(); jest.restoreAllMocks(); });
const mount = (node: React.ReactElement) => render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);

test('learners see their private folder and class files instead of an empty library', async () => {
  const screen = mount(<ResourcesScreen />);
  await screen.findByText('Resume Draft v1');
  expect(screen.queryByText('No resources yet')).toBeNull();
  expect(screen.getByText('Your private folder — only you and your instructors can see files here.')).toBeTruthy();
  expect(screen.getByText('Week 1 Ruby Slides')).toBeTruthy();
  expect(screen.getByText('Slides')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Upload file' })).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Delete Resume Draft v1' })).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Delete Job Search Plan' })).toBeNull();
  api.downloadCohortFile.mockResolvedValue({ url: 'https://storage.test/resume.pdf', expires_in: 300, filename: 'resume-draft-v1.pdf' });
  fireEvent.press(screen.getByRole('button', { name: 'Download Resume Draft v1' }));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://storage.test/resume.pdf'));
  expect(api.downloadCohortFile).toHaveBeenCalledWith(4, 5);
});

test('paused learners keep downloads, lose upload, and deleting asks first', async () => {
  api.cohortFiles.mockResolvedValue({ class_files: [], my_files: [resume], folders: [], storage_configured: true, can_upload_personal: false });
  const alert = jest.spyOn(themedAlert, 'alert').mockImplementation(() => undefined);
  const screen = mount(<ResourcesScreen />);
  await screen.findByText('Resume Draft v1');
  expect(screen.queryByRole('button', { name: 'Upload file' })).toBeNull();
  expect(screen.getByText(/Uploads are paused/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Delete Resume Draft v1' }));
  expect(alert).toHaveBeenCalledWith('Delete Resume Draft v1?', expect.any(String), expect.any(Array));
  expect(api.deleteCohortFile).not.toHaveBeenCalled();
});

test('staff browse class files and open a student folder on the phone', async () => {
  jest.mocked(useSession).mockReturnValue({ user: { id: 2, is_staff: true }, api } as unknown as ReturnType<typeof useSession>);
  api.cohorts.mockResolvedValue({ cohorts: [{ id: 4, name: 'Prework Demo' }] });
  api.cohortFiles.mockResolvedValue({
    class_files: [file({}), file({ id: 2, title: 'Instructor Week 1 Notes', visibility: 'staff_only' })],
    student_folders: [{ student_id: 3, enrollment_id: 30, student_name: 'Student One', student_email: 'one@example.invalid', enrollment_status: 'active', file_count: 2, files: [resume, plan] }],
    folders: [], storage_configured: true, can_upload_personal: false,
  });
  const screen = mount(<StaffCohortFilesScreen />);
  await screen.findByText('Week 1 Ruby Slides');
  expect(screen.getByText(/Staff only/)).toBeTruthy();
  fireEvent.press(screen.getByRole('tab', { name: 'Student folders · 1' }));
  fireEvent.press(screen.getByRole('button', { name: "Open Student One's folder, 2 files" }));
  expect(screen.getByText('Resume Draft v1')).toBeTruthy();
  expect(screen.getByText(/Uploaded by student/)).toBeTruthy();
  expect(screen.getByText(/Shared by staff/)).toBeTruthy();
  expect(api.cohortFiles).toHaveBeenCalledWith(4, expect.anything());
  fireEvent.press(screen.getByRole('button', { name: 'All student folders' }));
  expect(screen.queryByText('Resume Draft v1')).toBeNull();
});

test('learners who reach the staff files screen see staff-only guidance', () => {
  const screen = mount(<StaffCohortFilesScreen />);
  expect(screen.getByText('Staff access only')).toBeTruthy();
  expect(api.cohorts).not.toHaveBeenCalled();
});
