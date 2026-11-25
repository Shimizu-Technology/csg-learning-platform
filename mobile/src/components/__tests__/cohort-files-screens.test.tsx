import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import { useSession } from '@/providers/session-provider';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { themedAlert } from '@/lib/alerts';
import { ApiError } from '@/lib/api';
import { uploadToMyFolder } from '@/lib/cohort-files';
import { openExternalPage } from '@/lib/external-links';

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
  ready_at: '2026-11-24T00:00:00Z', created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ina Instructor', uploaded_by_role: 'staff', can_manage: false,
  kind: 'file', external_url: null, link_provider: null, version_number: 1, previewable: true, preview_mode: 'pdf', ...overrides,
});
const resume = file({ id: 5, student_id: 3, folder: 'Resumes & Portfolio', title: 'Resume Draft v1', filename: 'resume-draft-v1.pdf', uploaded_by_role: 'student', can_manage: true });
const plan = file({ id: 6, student_id: 3, folder: 'Job Search & Career', title: 'Job Search Plan', filename: 'student-one-job-search-plan.docx' });
const api = {
  resources: jest.fn(), cohortFiles: jest.fn(), downloadCohortFile: jest.fn(), deleteCohortFile: jest.fn(), createCohortFile: jest.fn(), completeCohortFile: jest.fn(),
  cohorts: jest.fn(), createCohortLink: jest.fn(), previewCohortFile: jest.fn(),
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
  expect(screen.getByText(/Added by student/)).toBeTruthy();
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

test('private folder queries stay out of offline storage and vanish once access is revoked', async () => {
  const screen = mount(<ResourcesScreen />);
  await screen.findByText('Resume Draft v1');
  const cached = client.getQueryCache().findAll({ queryKey: ['learning', 3, 'cohort-files', 4] });
  expect(cached).toHaveLength(1);
  expect(cached[0].meta).toEqual({ persist: false });
  api.cohortFiles.mockRejectedValue(new ApiError('Not enrolled in this cohort', 403));
  await cached[0].fetch();
  await waitFor(() => expect(screen.queryByText('Resume Draft v1')).toBeNull());
  expect(client.getQueryData(['learning', 3, 'cohort-files', 4])).toBeNull();
  expect(screen.queryByText(/could not load/)).toBeNull();
});

test('staff who lose a cohort stop seeing its student folders', async () => {
  jest.mocked(useSession).mockReturnValue({ user: { id: 2, is_staff: true }, api } as unknown as ReturnType<typeof useSession>);
  api.cohorts.mockResolvedValue({ cohorts: [{ id: 4, name: 'Prework Demo' }] });
  api.cohortFiles.mockRejectedValue(new ApiError('Cannot access this cohort', 403));
  const screen = mount(<StaffCohortFilesScreen />);
  await screen.findByText('No access to these files');
  expect(client.getQueryCache().findAll({ queryKey: ['staff-cohort-files', 4] })[0].meta).toEqual({ persist: false });
});

test('a failed files request shows a retry banner, and downloads wait for storage', async () => {
  api.cohortFiles.mockRejectedValueOnce(new ApiError('The request timed out.', 504))
    .mockResolvedValue({ class_files: [file({})], my_files: [], folders: [], storage_configured: false, can_upload_personal: true });
  const screen = mount(<ResourcesScreen />);
  await screen.findByText(/Your files and class files could not load/);
  expect(screen.queryByText('No resources yet')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Retry' }));
  await screen.findByText('Week 1 Ruby Slides');
  expect(screen.getByRole('button', { name: 'Download Week 1 Ruby Slides' }).props.accessibilityState.disabled).toBe(true);
  expect(screen.getByText('Downloads are unavailable until file storage is set up.')).toBeTruthy();
});

test('a failed native upload abandons only the still-pending file', async () => {
  api.createCohortFile.mockResolvedValue({ file: { id: 41, content_type: 'application/pdf' }, upload_url: 'https://storage.test/upload', fields: { 'Content-Type': 'application/pdf' } });
  api.completeCohortFile.mockRejectedValue(new ApiError('Network lost'));
  api.deleteCohortFile.mockResolvedValue(undefined);
  const send = jest.fn(function (this: { status: number; onload: () => void }) { this.status = 204; this.onload(); });
  const original = global.XMLHttpRequest;
  global.XMLHttpRequest = jest.fn(() => ({ open: jest.fn(), send, upload: {}, status: 0 })) as unknown as typeof XMLHttpRequest;
  try {
    await expect(uploadToMyFolder(api as never, 4, { uri: 'file:///resume.pdf', name: 'resume.pdf', size: 10, mimeType: 'application/pdf' }, 'General', jest.fn())).rejects.toThrow('Network lost');
  } finally {
    global.XMLHttpRequest = original;
  }
  expect(api.deleteCohortFile).toHaveBeenCalledWith(4, 41, { pendingOnly: true });
});


test('links open with their provider badge, and learners add links to their folder', async () => {
  const link = file({ id: 7, student_id: 3, kind: 'link', title: 'Portfolio repo', filename: null, content_type: null, file_size: null, previewable: false, preview_mode: null,
    external_url: 'https://github.com/student/portfolio', link_provider: 'github', folder: 'Resumes & Portfolio', can_manage: true, uploaded_by_role: 'student' });
  api.cohortFiles.mockResolvedValue({ class_files: [], my_files: [link], folders: [], storage_configured: false, can_upload_personal: true });
  api.createCohortLink.mockResolvedValue({ file: link });
  const screen = mount(<ResourcesScreen />);
  await screen.findByText('Portfolio repo');
  expect(screen.getByText('GitHub')).toBeTruthy();
  expect(screen.getByText(/github.com · Resumes & Portfolio/)).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Download Portfolio repo' })).toBeNull();
  fireEvent.press(screen.getByRole('link', { name: 'Open Portfolio repo' }));
  await waitFor(() => expect(Linking.openURL).toHaveBeenCalledWith('https://github.com/student/portfolio'));

  fireEvent.press(screen.getByRole('button', { name: 'Add a link' }));
  fireEvent.changeText(screen.getByLabelText('Link'), 'http://example.com');
  fireEvent.press(screen.getByRole('button', { name: 'Save link' }));
  expect(screen.getByText('Links must start with https://')).toBeTruthy();
  expect(api.createCohortLink).not.toHaveBeenCalled();
  fireEvent.changeText(screen.getByLabelText('Link'), 'https://docs.google.com/document/d/x');
  fireEvent.press(screen.getByRole('button', { name: 'Save to Resumes & Portfolio' }));
  fireEvent.press(screen.getByRole('button', { name: 'Save link' }));
  await waitFor(() => expect(api.createCohortLink).toHaveBeenCalledWith(4, { external_url: 'https://docs.google.com/document/d/x', folder: 'Resumes & Portfolio' }));
});

test('files show their version and preview text in the app or open media in the browser', async () => {
  const notes = file({ id: 8, title: 'Week 1 notes', filename: 'notes.csv', preview_mode: 'csv', version_number: 2 });
  api.cohortFiles.mockResolvedValue({ class_files: [notes, file({})], my_files: [], folders: [], storage_configured: true, can_upload_personal: true });
  api.previewCohortFile.mockImplementation(async (_cohort: number, fileId: number) => fileId === 8
    ? { preview_mode: 'csv', filename: 'notes.csv', content_type: 'text/csv', file_size: 20, version_number: 2, version_id: null, url: null, expires_in: null, text: 'name,score\nAda,98', truncated: false }
    : { preview_mode: 'pdf', filename: 'week-1-ruby-slides.pdf', content_type: 'application/pdf', file_size: 2048, version_number: 1, version_id: null, url: 'https://storage.test/inline.pdf', expires_in: 300, text: null, truncated: false });
  const screen = mount(<ResourcesScreen />);
  await screen.findByText('Week 1 notes');
  expect(screen.getByText('v2')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Preview Week 1 notes' }));
  await screen.findByText('Ada');
  expect(screen.getByText('score')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Close Week 1 notes' }));
  fireEvent.press(screen.getByRole('button', { name: 'Preview Week 1 Ruby Slides' }));
  await waitFor(() => expect(openExternalPage).toHaveBeenCalledWith('https://storage.test/inline.pdf'));
});

test('staff add a class link from the phone', async () => {
  jest.mocked(useSession).mockReturnValue({ user: { id: 2, is_staff: true }, api } as unknown as ReturnType<typeof useSession>);
  api.cohorts.mockResolvedValue({ cohorts: [{ id: 4, name: 'Prework Demo' }] });
  api.cohortFiles.mockResolvedValue({ class_files: [file({})], student_folders: [], folders: ['Slides'], storage_configured: false, can_upload_personal: false });
  api.createCohortLink.mockResolvedValue({ file: file({ id: 9, kind: 'link' }) });
  const screen = mount(<StaffCohortFilesScreen />);
  await screen.findByText('Week 1 Ruby Slides');
  fireEvent.press(screen.getByRole('button', { name: 'Add a class link' }));
  fireEvent.changeText(screen.getByLabelText('Link'), 'https://www.figma.com/design/x');
  fireEvent.changeText(screen.getByLabelText('Title (optional)'), 'Capstone board');
  fireEvent.press(screen.getByRole('button', { name: 'Save link' }));
  await waitFor(() => expect(api.createCohortLink).toHaveBeenCalledWith(4, { external_url: 'https://www.figma.com/design/x', folder: 'Slides', title: 'Capstone board' }));
  await waitFor(() => expect(api.cohortFiles).toHaveBeenCalledTimes(2));
});
