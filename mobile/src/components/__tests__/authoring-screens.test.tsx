import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { useQuery } from '@tanstack/react-query';
import { demoStaffCurriculum } from '@/lib/demo-staff';
import { demoLesson } from '@/lib/demo-learning';
import { demoUser, demoWorkspaces } from '@/lib/demo-data';
import type { WorkspaceDetail } from '@/lib/types';
import { useSession } from '@/providers/session-provider';
import { useWorkspace } from '@/providers/workspace-provider';
import { useCohort } from '@/providers/cohort-provider';

jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('expo-router', () => ({ useRouter: () => ({ back: jest.fn(), replace: jest.fn() }), useLocalSearchParams: () => ({ id: '101' }) }));
jest.mock('@tanstack/react-query', () => ({ useQuery: jest.fn(), useQueryClient: () => ({ setQueryData: jest.fn(), invalidateQueries: jest.fn() }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/providers/workspace-provider', () => ({ useWorkspace: jest.fn() }));
jest.mock('@/providers/cohort-provider', () => ({ useCohort: jest.fn() }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/lib/content-video-cleanup', () => ({ queueContentVideoCleanup: jest.fn(), retryContentVideoCleanups: jest.fn().mockResolvedValue(undefined) }));
jest.mock('@/lib/video-upload', () => ({ uploadVideoToStorage: jest.fn() }));
jest.mock('react-native-webview', () => ({ WebView: () => null }));
jest.mock('../lesson-content-block', () => ({ LessonContentBlockCard: () => null }));
jest.mock('../contextual-help', () => ({ ContextualHelp: () => null }));
jest.mock('@/lib/analytics', () => ({ captureProductEvent: jest.fn() }));
jest.mock('../staff-lesson-editor', () => {
  const React = jest.requireActual('react');
  const { Text } = jest.requireActual('react-native');
  return {
    StaffLessonEditor: () => React.createElement(Text, null, 'Writable editor'),
    StaffLessonReadOnlyPreview: ({ lesson }: { lesson: typeof demoLesson }) => React.createElement(Text, null, `Only admins can change the shared course library. ${lesson.title} ${lesson.content_blocks.map((block) => block.solution || '').join(' ')}`),
  };
});

// eslint-disable-next-line import/first
import StaffLessonEditorScreen from '../../app/(app)/staff/lesson/[id]/edit';
// eslint-disable-next-line import/first
import ManageCommunicationsScreen from '../../app/(app)/manage-communications';
// eslint-disable-next-line import/first
import LessonScreen from '../../app/(app)/lesson/[id]';

const community: WorkspaceDetail = { ...demoWorkspaces[0], id: 9, workspace_type: 'community', can_manage: true, members: [{ ...demoUser, id: 99, membership_role: 'member' }] };
const channel = { id: 12, workspace_id: 9, name: 'teaching', visibility: 'cohort' };
let workspace = community;
const api = {
  workspace: jest.fn(async () => ({ workspace })),
  channels: jest.fn(async () => ({ channels: [channel] })),
  users: jest.fn(async () => ({ users: [] })),
  archiveChannel: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  workspace = community;
  jest.mocked(useSession).mockReturnValue({ user: { ...demoUser, is_staff: true, is_admin: false, role: 'instructor' }, api } as unknown as ReturnType<typeof useSession>);
  jest.mocked(useWorkspace).mockReturnValue({ activeWorkspaceId: 9, activeWorkspace: community, workspaces: [community], selectWorkspace: jest.fn(), refresh: jest.fn() } as unknown as ReturnType<typeof useWorkspace>);
  jest.mocked(useCohort).mockReturnValue({ cohorts: [{ id: 4 }] } as ReturnType<typeof useCohort>);
  jest.mocked(useQuery).mockReturnValue({ data: { lesson: demoLesson }, isPending: false } as unknown as ReturnType<typeof useQuery>);
});

it('opens a direct instructor editor link as a preview with solutions and no authoring catalog requests', () => {
  const screen = render(<StaffLessonEditorScreen />);
  expect(screen.getByText(/Only admins can change the shared course library/)).toBeTruthy();
  expect(screen.getByText(/auto-fit/)).toBeTruthy();
  expect(screen.queryByText('Writable editor')).toBeNull();
  expect(jest.mocked(useQuery).mock.calls.slice(1).every(([options]) => !options.enabled)).toBe(true);
});

it('opens the writable editor for an admin direct link', () => {
  jest.mocked(useSession).mockReturnValue({ user: { ...demoUser, is_staff: true, is_admin: true, role: 'admin' }, api } as unknown as ReturnType<typeof useSession>);
  expect(render(<StaffLessonEditorScreen />).getByText('Writable editor')).toBeTruthy();
});

it('ignores stale community can_manage for instructors and preserves reading', async () => {
  const screen = render(<ManageCommunicationsScreen />);
  await waitFor(() => expect(screen.getByText('teaching')).toBeTruthy());
  expect(screen.getByText(demoUser.email)).toBeTruthy();
  for (const label of ['New community', 'New channel', 'Add', 'Edit this community workspace']) expect(screen.queryByText(label)).toBeNull();
  expect(screen.queryByLabelText(`Remove ${demoUser.full_name}`)).toBeNull();
  fireEvent(screen.getByLabelText('Channel teaching'), 'longPress');
  expect(api.archiveChannel).not.toHaveBeenCalled();
});

it('preserves assigned instructor cohort channels with workspace can_manage false', async () => {
  workspace = { ...community, workspace_type: 'cohort', cohort_id: 4, can_manage: false };
  const screen = render(<ManageCommunicationsScreen />);
  await waitFor(() => expect(screen.getByText('New channel')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('Edit teaching'));
  expect(screen.getByText('Save channel')).toBeTruthy();
  expect(screen.getByText('Archive channel')).toBeTruthy();
  expect(screen.queryByText('New community')).toBeNull();
  expect(screen.queryByText('Add')).toBeNull();
});

it('hides cohort writes for an unassigned instructor', async () => {
  workspace = { ...community, workspace_type: 'cohort', cohort_id: 44 };
  const screen = render(<ManageCommunicationsScreen />);
  await waitFor(() => expect(screen.getByText('teaching')).toBeTruthy());
  expect(screen.queryByText('New channel')).toBeNull();
  expect(screen.queryByLabelText('Edit teaching')).toBeNull();
});

it('preserves admin community management controls', async () => {
  jest.mocked(useSession).mockReturnValue({ user: { ...demoUser, is_staff: true, is_admin: true, role: 'admin' }, api } as unknown as ReturnType<typeof useSession>);
  const screen = render(<ManageCommunicationsScreen />);
  await waitFor(() => expect(screen.getByText('teaching')).toBeTruthy());
  for (const label of ['New community', 'New channel', 'Add', 'Edit this community workspace']) expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getByLabelText(`Remove ${demoUser.full_name}`)).toBeTruthy();
});

it.each([false, true])('gates reader edit and schedule controls by admin session (%s)', (admin) => {
  jest.mocked(useSession).mockReturnValue({ user: { ...demoUser, is_staff: true, is_admin: admin, role: admin ? 'admin' : 'instructor' }, api } as unknown as ReturnType<typeof useSession>);
  jest.mocked(useQuery).mockReturnValue({ data: { lesson: { ...demoLesson, cohort_id: undefined, module_id: demoStaffCurriculum.modules[0].id }, curriculum: demoStaffCurriculum }, isPending: false } as unknown as ReturnType<typeof useQuery>);
  const screen = render(<LessonScreen />);
  expect(Boolean(screen.queryByLabelText('Edit lesson'))).toBe(admin);
  expect(Boolean(screen.queryByLabelText('Open lesson schedule and status'))).toBe(admin);
  expect(screen.getByText('CURRICULUM PREVIEW')).toBeTruthy();
});
