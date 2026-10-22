import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import SearchScreen from '../../app/(app)/search';
import { MessageAuthorContext } from '../message-author-context';
import type { UserSummary } from '@/lib/types';

const mockRouter = { push: jest.fn(), replace: jest.fn() };
const mockApi = { users: jest.fn(), availableUsers: jest.fn(), search: jest.fn(), createDm: jest.fn(), studentContext: jest.fn() };
let mockStaff = true;
const mockWorkspaces = [{ id: 1, name: 'Python' }, { id: 2, name: 'Community' }];
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: mockApi, user: { id: 9, is_staff: mockStaff } }) }));
jest.mock('@/providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: mockWorkspaces }) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
const learner: UserSummary = { id: 7, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', is_staff: false, is_admin: false, avatar_url: null };
const enrollments = [{ id: 11, cohort_id: 1, cohort_name: 'Python', status: 'active' }, { id: 12, cohort_id: 2, cohort_name: 'Web', status: 'completed' }];
beforeEach(() => {
  jest.clearAllMocks(); mockStaff = true;
  mockApi.studentContext.mockResolvedValue({ user: learner, enrollments });
  mockApi.users.mockResolvedValue({ users: [{ ...learner, enrollments }, { ...learner, id: 8, full_name: 'Maya without enrollment', enrollments: [] }] });
  mockApi.availableUsers.mockResolvedValue({ users: [learner] });
  mockApi.search.mockResolvedValue({ results: [{ id: 150, channel_id: 4, direct_conversation_id: null, body: 'Maya asked a question', author: learner, context: { label: 'General', type: 'channel', id: 4, workspace_id: 1 } }] });
  mockApi.createDm.mockResolvedValue({ direct_conversation: { id: 44 } });
});
it('requires an explicit enrollment choice for a multi-enrollment community author', async () => {
  const close = jest.fn();
  const screen = render(<MessageAuthorContext author={learner} onClose={close} />);
  await screen.findByText('Choose an enrollment');
  expect(mockRouter.push).not.toHaveBeenCalled();
  fireEvent.press(screen.getByText('Web · completed'));
  expect(close).toHaveBeenCalledTimes(1);
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/staff/student/[id]', params: { id: '7', cohort_id: '2' } });
});
it('pushes the exact cohort context and offers retry for unavailable records', async () => {
  mockApi.studentContext.mockRejectedValueOnce(new Error('Offline'));
  const screen = render(<MessageAuthorContext author={learner} cohortId={1} onClose={jest.fn()} />);
  await screen.findByText('Offline');
  fireEvent.press(screen.getByText('Try again'));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/staff/student/[id]', params: { id: '7', cohort_id: '1' } }));
});
it('never requests staff context for a student viewer or staff author', async () => {
  mockStaff = false;
  const screen = render(<MessageAuthorContext author={learner} onClose={jest.fn()} />);
  expect(screen.getByText('Maya Santos')).toBeTruthy();
  expect(mockApi.studentContext).not.toHaveBeenCalled();
  screen.unmount(); mockStaff = true;
  render(<MessageAuthorContext author={{ ...learner, role: 'instructor' }} onClose={jest.fn()} />);
  expect(mockApi.studentContext).not.toHaveBeenCalled();
});
it('searches authorized learners and messages in sections and PUSHes a match without losing search state', async () => {
  const screen = render(<SearchScreen />);
  fireEvent.changeText(screen.getByLabelText('Search people and messages'), 'Maya');
  fireEvent.press(screen.getByLabelText('Search'));
  await screen.findByText('Maya asked a question');
  expect(screen.getByText('People')).toBeTruthy(); expect(screen.getByText('Messages')).toBeTruthy();
  expect(mockApi.users).toHaveBeenCalledWith({ role: 'student', include_enrollments: true, people_search: true });
  expect(mockApi.availableUsers).not.toHaveBeenCalled();
  expect(screen.queryByText('Maya without enrollment')).toBeNull();
  fireEvent.press(screen.getByLabelText('Open General at this message'));
  expect(mockRouter.replace).not.toHaveBeenCalled();
  expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/conversation/[kind]/[id]', params: { kind: 'channel', id: '4', messageId: '150' } });
  expect(screen.getByDisplayValue('Maya')).toBeTruthy();
  expect(screen.getByText('Maya asked a question')).toBeTruthy();
});
it('searches students’ authorized DM members, deduplicates people, and chooses a workspace before pushing a DM', async () => {
  mockStaff = false;
  const screen = render(<SearchScreen />);
  fireEvent.changeText(screen.getByLabelText('Search people and messages'), 'Maya');
  fireEvent.press(screen.getByLabelText('Search'));
  await screen.findByLabelText('Open Maya Santos');
  expect(mockApi.users).not.toHaveBeenCalled();
  expect(mockApi.availableUsers.mock.calls).toEqual([[1], [2]]);
  expect(screen.getAllByLabelText('Open Maya Santos')).toHaveLength(1);
  fireEvent.press(screen.getByLabelText('Open Maya Santos'));
  fireEvent.press(screen.getByText('Community'));
  await waitFor(() => expect(mockRouter.push).toHaveBeenCalledWith({ pathname: '/conversation/[kind]/[id]', params: { kind: 'dm', id: '44' } }));
  expect(mockApi.createDm).toHaveBeenCalledWith(2, [7]);
  expect(screen.getByDisplayValue('Maya')).toBeTruthy();
});
it('keeps working people results when message search fails', async () => {
  mockApi.search.mockRejectedValueOnce(new Error('Offline'));
  const screen = render(<SearchScreen />);
  fireEvent.changeText(screen.getByLabelText('Search people and messages'), 'Maya'); fireEvent.press(screen.getByLabelText('Search'));
  await screen.findByText('Messages are unavailable. Try again.');
  expect(screen.getByLabelText('Open Maya Santos')).toBeTruthy();
  fireEvent.press(screen.getByText('Retry messages'));
  await screen.findByText('Maya asked a question');
});
it('discards stale search responses after changing the query', async () => {
  let finish!: (value: { results: never[] }) => void;
  mockApi.search.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const screen = render(<SearchScreen />);
  fireEvent.changeText(screen.getByLabelText('Search people and messages'), 'Maya'); fireEvent.press(screen.getByLabelText('Search'));
  fireEvent.changeText(screen.getByLabelText('Search people and messages'), 'Kai');
  await act(async () => finish({ results: [] }));
  expect(screen.getByText('Search across CSG')).toBeTruthy();
  expect(screen.queryByText('Maya Santos')).toBeNull();
});

it.each([true, false])('keeps server-filtered blocked people out of results (staff=%s)', async (staff) => {
  mockStaff = staff;
  mockApi.users.mockResolvedValue({ users: [] });
  mockApi.availableUsers.mockResolvedValue({ users: [] });
  const screen = render(<SearchScreen />);
  fireEvent.changeText(screen.getByLabelText('Search people and messages'), 'Maya');
  fireEvent.press(screen.getByLabelText('Search'));
  await screen.findByText('No matching people you can access.');
  expect(screen.queryByLabelText('Open Maya Santos')).toBeNull();
  if (staff) expect(mockApi.users).toHaveBeenCalledWith({ role: 'student', include_enrollments: true, people_search: true });
  else expect(mockApi.users).not.toHaveBeenCalled();
});

it('owns the sheet header above its search form so native headers cannot obscure the input', () => {
  const screen = render(<SearchScreen />);
  expect(screen.getByRole('header', { name: 'Search messages' })).toBeTruthy();
  expect(screen.getByLabelText('Close search')).toBeTruthy();
  expect(screen.getByLabelText('Search people and messages')).toBeTruthy();
});
