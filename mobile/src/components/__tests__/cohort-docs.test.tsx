import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSession } from '@/providers/session-provider';
import { useCsgAuth } from '@/providers/auth-provider';
import { useCohort } from '@/providers/cohort-provider';
import { ApiError } from '@/lib/api';
import { themedAlert } from '@/lib/alerts';

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? true : () => null }));
jest.mock('expo-router', () => ({ useLocalSearchParams: jest.fn(), usePathname: () => '/', useRouter: () => ({ canGoBack: () => false, back: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: jest.fn() }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openExternalPage: jest.fn(), openAuthenticatedWebPage: jest.fn().mockResolvedValue(undefined) }));
jest.mock('expo-document-picker', () => ({ getDocumentAsync: jest.fn() }));
// eslint-disable-next-line import/first
import ResourcesScreen from '../../app/(app)/resources';
// eslint-disable-next-line import/first
import StaffCohortFilesScreen from '../../app/(app)/staff/files';

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: 31, cohort_id: 4, student_id: 3, source_file_id: 40, folder: 'Career', visibility: 'students', title: 'My Job Search Plan', description: null,
  filename: null, content_type: null, file_size: null, ready: true, ready_at: null, created_at: '2026-11-24T00:00:00Z', uploaded_by_name: 'Ina Instructor',
  uploaded_by_role: 'staff', can_manage: false, kind: 'doc', external_url: null, link_provider: null, version_number: 1, previewable: false, preview_mode: null,
  review_status: 'needs_review', reviewed_by_name: null, reviewed_at: null, comment_count: 2,
  doc_version: 1, doc_updated_at: '2026-11-24T01:00:00.000001Z', doc_updated_by_name: 'Student One', can_edit_doc: true, ...overrides,
});
const docResponse = (content: string, overrides: Record<string, unknown> = {}) => ({ file: doc(overrides), doc_content: content, doc_version: (overrides.doc_version as number) || 1, doc_updated_at: '2026-11-24T01:00:00.000001Z', doc_updated_by_name: 'Student One', can_edit_doc: overrides.can_edit_doc !== false, revision_count: 2 });
const api = {
  resources: jest.fn(), cohortFiles: jest.fn(), cohorts: jest.fn(), createCohortDoc: jest.fn(), cohortDoc: jest.fn(), saveCohortDoc: jest.fn(),
  setCohortFileReview: jest.fn(), cohortFileComments: jest.fn(), createCohortFileComment: jest.fn(), deleteCohortFileComment: jest.fn(),
};
let client: QueryClient;
beforeEach(() => {
  jest.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  jest.mocked(useLocalSearchParams).mockReturnValue({});
  jest.mocked(useSession).mockReturnValue({ user: { id: 3, is_staff: false }, api } as unknown as ReturnType<typeof useSession>);
  jest.mocked(useCsgAuth).mockReturnValue({ demo: false } as ReturnType<typeof useCsgAuth>);
  jest.mocked(useCohort).mockReturnValue({ selectedCohortId: 4 } as ReturnType<typeof useCohort>);
  api.resources.mockResolvedValue({ resources: [] });
  api.cohortFiles.mockResolvedValue({ class_files: [], my_files: [doc()], folders: ['Career'], storage_configured: false, can_upload_personal: true });
  api.cohortFileComments.mockResolvedValue({ comments: [{ id: 1, cohort_file_id: 31, body: 'Ready when you are', created_at: '2026-11-24T00:00:00Z', author_id: 3, author_name: 'Student One', author_role: 'student', can_delete: true }], can_comment: true });
  api.cohortDoc.mockResolvedValue(docResponse('# Plan\n\n- [ ] Apply to 3 roles'));
});
afterEach(() => { client.clear(); });
const mount = (node: React.ReactElement) => render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);

test('learners see a Learn Doc with its review state and can start a doc without file storage', async () => {
  const created = doc({ id: 32, title: 'Interview notes', review_status: 'none', comment_count: 0, source_file_id: null, uploaded_by_role: 'student', can_manage: true });
  api.createCohortDoc.mockResolvedValue({ file: created });
  const screen = mount(<ResourcesScreen />);
  await screen.findByText('My Job Search Plan');
  expect(screen.getByText('Learn Doc')).toBeTruthy();
  expect(screen.getByText('Needs review')).toBeTruthy();
  expect(screen.getByText(/Learn Doc · Career · Shared by your instructor · 2 comments/)).toBeTruthy();
  expect(screen.getByText(/You can still add links and docs/)).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'New doc' }));
  fireEvent.changeText(screen.getByLabelText('Doc title'), 'Interview notes');
  fireEvent.press(screen.getByRole('button', { name: 'Create doc' }));
  await waitFor(() => expect(api.createCohortDoc).toHaveBeenCalledWith(4, { title: 'Interview notes', folder: 'Job Search & Career', doc_content: '' }));
  await waitFor(() => expect(api.cohortFiles).toHaveBeenCalledTimes(2));
});

test('the doc sheet reads, edits and saves from the loaded version, and a 409 offers the latest', async () => {
  api.saveCohortDoc.mockResolvedValueOnce(docResponse('# Plan\n\nDone', { doc_version: 2, can_manage: true }))
    .mockRejectedValueOnce(new ApiError('This document was updated by someone else.', 409));
  const screen = mount(<ResourcesScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'Open My Job Search Plan' }));
  await screen.findByText('Learn Doc · Saved');
  expect(screen.getByText('Ready when you are')).toBeTruthy();
  fireEvent.press(screen.getByRole('tab', { name: 'Edit' }));
  fireEvent.changeText(screen.getByLabelText('Doc content'), '# Plan\n\nDone');
  expect(screen.getByText('Learn Doc · Unsaved changes')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  // A copy staff made keeps its title, so none is sent.
  await waitFor(() => expect(api.saveCohortDoc).toHaveBeenCalledWith(4, 31, { doc_content: '# Plan\n\nDone', base_doc_version: 1, save_revision: true }));
  await screen.findByText('Learn Doc · Saved');
  fireEvent.changeText(screen.getByLabelText('Doc content'), '# Plan\n\nOverwrite');
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText(/Someone else updated this doc/);
  expect(api.saveCohortDoc).toHaveBeenLastCalledWith(4, 31, expect.objectContaining({ base_doc_version: 2, title: 'My Job Search Plan' }));
  fireEvent.press(screen.getByRole('button', { name: 'Load latest' }));
  await waitFor(() => expect(api.cohortDoc).toHaveBeenCalledTimes(2));
})

test('a learner takes an item back from review from the doc sheet', async () => {
  api.setCohortFileReview.mockResolvedValue({ file: doc({ review_status: 'none' }) });
  const screen = mount(<ResourcesScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'Open My Job Search Plan' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Ready for review · On' }));
  await waitFor(() => expect(api.setCohortFileReview).toHaveBeenCalledWith(4, 31, 'none'));
  expect(screen.queryByRole('button', { name: 'Mark reviewed' })).toBeNull();
});

test('staff filter folders waiting for review and open the linked item from a notification', async () => {
  jest.mocked(useSession).mockReturnValue({ user: { id: 2, is_staff: true }, api } as unknown as ReturnType<typeof useSession>);
  jest.mocked(useLocalSearchParams).mockReturnValue({ cohort_id: '4', student: '3', file: '31' });
  api.cohorts.mockResolvedValue({ cohorts: [{ id: 4, name: 'Prework Demo' }] });
  api.cohortFiles.mockResolvedValue({ class_files: [], folders: [], storage_configured: false, can_upload_personal: false, student_folders: [
    { student_id: 3, enrollment_id: 30, student_name: 'Student One', student_email: 'one@example.invalid', enrollment_status: 'active', file_count: 1, needs_review_count: 1, files: [doc()] },
    { student_id: 5, enrollment_id: 50, student_name: 'Quiet Student', student_email: 'quiet@example.invalid', enrollment_status: 'active', file_count: 0, needs_review_count: 0, files: [] },
  ] });
  api.setCohortFileReview.mockResolvedValue({ file: doc({ review_status: 'reviewed', reviewed_by_name: 'Ina Instructor' }) });
  const screen = mount(<StaffCohortFilesScreen />);
  await waitFor(() => expect(api.cohortDoc).toHaveBeenCalledWith(4, 31));
  await screen.findByRole('button', { name: 'Mark reviewed' });
  fireEvent.press(screen.getByRole('button', { name: 'Close My Job Search Plan' }));
  fireEvent.press(screen.getByRole('button', { name: 'All student folders' }));
  expect(screen.getByText('Quiet Student')).toBeTruthy();
  fireEvent.press(screen.getByRole('button', { name: 'Needs review (1)' }));
  expect(screen.queryByText('Quiet Student')).toBeNull();
  fireEvent.press(screen.getByRole('button', { name: /Open Student One's folder, 1 file, 1 waiting for review/ }));
  fireEvent.press(screen.getByRole('button', { name: 'Open My Job Search Plan' }));
  fireEvent.press(await screen.findByRole('button', { name: 'Mark reviewed' }));
  await waitFor(() => expect(api.setCohortFileReview).toHaveBeenCalledWith(4, 31, 'reviewed'));
  fireEvent.press(screen.getByRole('button', { name: 'Close My Job Search Plan' }));
  fireEvent.press(screen.getByRole('button', { name: 'All student folders' }));
  // The count follows the review just made.
  expect(screen.getByRole('button', { name: 'Needs review (0)' })).toBeTruthy();
  expect(screen.getByText('Nothing is waiting for review.')).toBeTruthy();
});

test('a copy staff made keeps its title read only, and a doc that is gone refreshes the list', async () => {
  const screen = mount(<ResourcesScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'Open My Job Search Plan' }));
  fireEvent.press(await screen.findByRole('tab', { name: 'Edit' }));
  expect(screen.getByLabelText('Title').props.editable).toBe(false);
  expect(screen.getByText('Your instructor named this doc, so its title stays the same.')).toBeTruthy();
  api.saveCohortDoc.mockRejectedValueOnce(new ApiError('Changes to your folder are paused', 403));
  fireEvent.changeText(screen.getByLabelText('Doc content'), 'Late edit');
  fireEvent.press(screen.getByRole('button', { name: 'Save' }));
  await screen.findByText('Changes to your folder are paused');
  await waitFor(() => expect(api.cohortFiles).toHaveBeenCalledTimes(2));
});

test('reopening the doc sheet shows nothing from the last opening until the doc loads again', async () => {
  const screen = mount(<ResourcesScreen />);
  fireEvent.press(await screen.findByRole('button', { name: 'Open My Job Search Plan' }));
  fireEvent.press(await screen.findByRole('tab', { name: 'Edit' }));
  fireEvent.changeText(screen.getByLabelText('Doc content'), 'Unsaved local text');
  jest.spyOn(themedAlert, 'alert').mockImplementation((_title, _body, buttons) => { buttons?.find((button) => button.style === 'destructive')?.onPress?.(); });
  fireEvent.press(screen.getByRole('button', { name: 'Close My Job Search Plan' }));
  let finish: (value: unknown) => void = () => undefined;
  api.cohortDoc.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
  fireEvent.press(screen.getByRole('button', { name: 'Open My Job Search Plan' }));
  expect(await screen.findByText('Opening My Job Search Plan…')).toBeTruthy();
  expect(screen.queryByText('Unsaved local text')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  finish(docResponse('Fresh from the server', { can_edit_doc: false }));
  await screen.findByText('Learn Doc · Read only');
}, 15_000);
