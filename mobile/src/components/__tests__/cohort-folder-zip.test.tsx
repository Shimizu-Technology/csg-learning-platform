import { Platform } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';
import { useSession } from '@/providers/session-provider';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { ApiError } from '@/lib/api';

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? true : () => null }));
jest.mock('expo-router', () => ({ useLocalSearchParams: () => ({ cohort_id: '4' }), usePathname: () => '/', useRouter: () => ({ canGoBack: () => false, back: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: jest.fn() }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openExternalPage: jest.fn(), openAuthenticatedWebPage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: jest.fn().mockResolvedValue(undefined) }));
// eslint-disable-next-line import/first
import ResourcesScreen from '../../app/(app)/resources';
// eslint-disable-next-line import/first
import StaffCohortFilesScreen from '../../app/(app)/staff/files';

const file = (overrides: Record<string, unknown>) => ({
  id: 1, cohort_id: 4, student_id: null, source_file_id: null, source_curriculum_file_id: null, source_cohort_file_id: null, auto_copy_to_students: false,
  folder: 'Career & Job Search', visibility: 'students', title: 'Job Search Plan', description: null, filename: null, content_type: null, file_size: null, ready: true,
  ready_at: '2026-11-24T00:00:00Z', created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ina Instructor', uploaded_by_role: 'staff', can_manage: false,
  kind: 'doc', external_url: null, link_provider: null, version_number: 1, previewable: false, preview_mode: null, review_status: 'none', comment_count: 0,
  doc_version: 1, doc_updated_at: '2026-11-24T00:00:00.000000Z', doc_updated_by_name: null, can_edit_doc: false, ...overrides,
});
const api = { resources: jest.fn(), cohortFiles: jest.fn(), cohorts: jest.fn(), exportCohortFilesZip: jest.fn(), discardCohortFilesZip: jest.fn().mockResolvedValue(undefined) };
let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  jest.mocked(useCsgAuth).mockReturnValue({ demo: false } as ReturnType<typeof useCsgAuth>);
  jest.mocked(useCohort).mockReturnValue({ selectedCohortId: 4 } as ReturnType<typeof useCohort>);
  api.resources.mockResolvedValue({ resources: [] });
  api.cohorts.mockResolvedValue({ cohorts: [{ id: 4, name: 'Prework Demo' }] });
  api.exportCohortFilesZip.mockResolvedValue({ uri: 'file:///cache/cohort-zip-exports/1-a/prework-demo-my-files.zip', filename: 'prework-demo-my-files.zip', directory: 'file:///cache/cohort-zip-exports/1-a/' });
});
afterEach(() => client.clear());
const mount = (node: React.ReactElement) => render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
const asLearner = () => jest.mocked(useSession).mockReturnValue({ user: { id: 3, is_staff: false }, api } as unknown as ReturnType<typeof useSession>);
const asStaff = () => jest.mocked(useSession).mockReturnValue({ user: { id: 2, is_staff: true }, api } as unknown as ReturnType<typeof useSession>);

test('learners export My files as a ZIP through the share sheet, and see failures', async () => {
  asLearner();
  api.cohortFiles.mockResolvedValue({ class_files: [file({ id: 9, auto_copy_to_students: true })], my_files: [file({ id: 5, student_id: 3, title: 'Resume Draft' })], folders: [], storage_configured: false, can_upload_personal: true });
  const screen = mount(<ResourcesScreen />);
  await screen.findByText('Resume Draft');
  expect(screen.queryByText('Auto-copy')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: 'Export all my files as a ZIP' }));
  await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledWith('file:///cache/cohort-zip-exports/1-a/prework-demo-my-files.zip', expect.objectContaining({ mimeType: 'application/zip' })));
  expect(api.exportCohortFilesZip).toHaveBeenCalledWith(4, expect.objectContaining({ scope: 'my_files', studentId: undefined }));
  await waitFor(() => expect(api.discardCohortFilesZip).toHaveBeenCalledWith('file:///cache/cohort-zip-exports/1-a/'));

  jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error('Share sheet failed'));
  fireEvent.press(screen.getByRole('button', { name: 'Export all my files as a ZIP' }));
  expect(await screen.findByText('Share sheet failed')).toBeTruthy();
  expect(api.discardCohortFilesZip).toHaveBeenCalledTimes(2);

  api.exportCohortFilesZip.mockRejectedValueOnce(new ApiError('Too many requests', 429));
  fireEvent.press(screen.getByRole('button', { name: 'Export all my files as a ZIP' }));
  expect(await screen.findByText('Too many requests')).toBeTruthy();
});

test('learners with an empty folder get no export', async () => {
  asLearner();
  api.cohortFiles.mockResolvedValue({ class_files: [], my_files: [], folders: [], storage_configured: true, can_upload_personal: true });
  const screen = mount(<ResourcesScreen />);
  await screen.findByText('No files in your folder yet.');
  expect(screen.queryByRole('button', { name: 'Export all my files as a ZIP' })).toBeNull();
});

test('staff see the auto-copy badge on class items and export class files and a student folder', async () => {
  asStaff();
  api.cohortFiles.mockResolvedValue({
    class_files: [file({ can_manage: true, auto_copy_to_students: true }), file({ id: 2, title: 'Facilitation Guide', visibility: 'staff_only', can_manage: true })],
    student_folders: [
      { student_id: 3, enrollment_id: 30, student_name: 'Student One', student_email: 'one@example.invalid', enrollment_status: 'active', file_count: 1, needs_review_count: 0, files: [file({ id: 10, student_id: 3, source_file_id: 1, can_manage: true })] },
      { student_id: 5, enrollment_id: 50, student_name: 'Empty Student', student_email: 'empty@example.invalid', enrollment_status: 'active', file_count: 0, needs_review_count: 0, files: [] },
    ],
    folders: [], storage_configured: true, can_upload_personal: false,
  });
  const screen = mount(<StaffCohortFilesScreen />);
  await screen.findByText('Facilitation Guide');
  expect(screen.getAllByLabelText('Auto-copy: every student gets their own copy')).toHaveLength(1);
  fireEvent.press(screen.getByRole('button', { name: 'Export all class files as a ZIP' }));
  await waitFor(() => expect(api.exportCohortFilesZip).toHaveBeenCalledWith(4, expect.objectContaining({ scope: 'class', studentId: undefined })));

  fireEvent.press(screen.getByRole('tab', { name: 'Student folders · 2' }));
  fireEvent.press(screen.getByRole('button', { name: "Open Student One's folder, 1 file" }));
  expect(screen.queryByLabelText('Auto-copy: every student gets their own copy')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: "Export Student One's folder as a ZIP" }));
  await waitFor(() => expect(api.exportCohortFilesZip).toHaveBeenLastCalledWith(4, expect.objectContaining({ scope: 'student', studentId: 3 })));
  fireEvent.press(screen.getByRole('button', { name: 'All student folders' }));
  fireEvent.press(screen.getByRole('button', { name: "Open Empty Student's folder, 0 files" }));
  expect(screen.getByRole('button', { name: "Export Empty Student's folder as a ZIP" }).props.accessibilityState.disabled).toBe(true);
});

test('on Android, successful shares stay cached for the recipient app while failed shares clean up immediately', async () => {
  const originalOs = Platform.OS;
  Object.defineProperty(Platform, 'OS', { value: 'android', configurable: true });
  try {
    asLearner();
    api.cohortFiles.mockResolvedValue({ class_files: [], my_files: [file({ id: 5, student_id: 3, title: 'Resume Draft' })], folders: [], storage_configured: false, can_upload_personal: true });
    const screen = mount(<ResourcesScreen />);
    await screen.findByText('Resume Draft');
    fireEvent.press(screen.getByRole('button', { name: 'Export all my files as a ZIP' }));
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalledTimes(1));
    expect(api.discardCohortFilesZip).not.toHaveBeenCalled();

    jest.mocked(Sharing.shareAsync).mockRejectedValueOnce(new Error('Chooser failed'));
    fireEvent.press(screen.getByRole('button', { name: 'Export all my files as a ZIP' }));
    expect(await screen.findByText('Chooser failed')).toBeTruthy();
    expect(api.discardCohortFilesZip).toHaveBeenCalledWith('file:///cache/cohort-zip-exports/1-a/');
  } finally {
    Object.defineProperty(Platform, 'OS', { value: originalOs, configurable: true });
  }
});
