jest.mock('@/components/ui/pressable-scale', () => ({ PressableScale: jest.requireActual('react-native').Pressable }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, waitFor } from '@testing-library/react-native';
import { renderRouter, screen } from 'expo-router/testing-library';
import { router, Stack, Tabs, useLocalSearchParams } from 'expo-router';
import { Text } from 'react-native';
import { themedAlert } from '@/lib/alerts';
import { gradingQueueKey } from '@/lib/grading-queue';
import { demoStaffSubmissions } from '@/lib/demo-staff';
import CohortHomeScreen from '../../app/(app)/cohort/[id]';
import StaffSubmissionScreen from '../../app/(app)/staff/submission/[id]';
import { openContentLink } from '@/lib/content-links';

let mockDemo = true;
const mockSubmission = jest.fn();
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: mockDemo }) }));
let mockStaff = true;
jest.mock('@/providers/cohort-provider', () => ({ useCohort: () => ({ cohorts: [{ id: 1 }], selectedCohortId: 1, selectCohort: jest.fn() }) }));
jest.mock('@/providers/workspace-provider', () => ({ useWorkspace: () => ({ workspaces: [], selectWorkspace: jest.fn() }) }));
jest.mock('@/components/cohort-switcher', () => ({ CohortSwitcher: () => null }));
jest.mock('@/components/staff-attention', () => ({ StaffAttention: () => null }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: { submission: mockSubmission, feedbackSnippets: async () => ({ feedback_snippets: [] }) }, user: { id: 7, is_staff: mockStaff } }) }));
jest.mock('@/lib/haptics', () => ({ haptic: jest.fn() }));
jest.mock('@/lib/analytics', () => ({ captureProductEvent: jest.fn() }));
jest.mock('@/lib/alerts', () => ({ themedAlert: { alert: jest.fn() } }));
jest.mock('@/lib/submission-storage', () => ({ loadGradingDraft: jest.fn().mockResolvedValue(null), saveGradingDraft: jest.fn().mockResolvedValue(undefined), clearGradingDraft: jest.fn().mockResolvedValue(undefined), gradingDraftMatches: jest.fn() }));
jest.mock('@/hooks/use-voice-draft', () => ({ useVoiceDraft: () => ({ state: 'idle', markSent: jest.fn() }) }));
jest.mock('@/components/voice-draft-controls', () => ({ VoiceDraftButton: () => null, VoiceDraftPanel: () => null }));
jest.mock('@/components/message-code-block', () => ({ MessageCodeBlock: () => null }));
jest.mock('@/components/authored-content', () => ({ AuthoredContent: () => null }));
let client: QueryClient;
afterEach(() => { client.clear(); mockDemo = true; });
function LessonTarget() { return <Text>Lesson {useLocalSearchParams().id}</Text>; }
function mount(initialUrl: string) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  client.setQueryData(gradingQueueKey(7, 'test'), { submissions: demoStaffSubmissions.slice(0, 3) });
  return renderRouter({
    _layout: () => <QueryClientProvider client={client}><Stack /></QueryClientProvider>,
    '(app)/_layout': () => <Stack />,
    '(app)/(tabs)/_layout': () => <Tabs />,
    '(app)/(tabs)/index': () => <Text>Today</Text>,
    '(app)/(tabs)/learn': () => <Text>Learn</Text>,
    '(app)/(tabs)/messages': () => <Text>Messages</Text>,
    '(app)/(tabs)/profile': () => <Text>Profile</Text>,
    '(app)/conversation/dm/[id]': () => <Text>Conversation</Text>,
    '(app)/(tabs)/updates': () => <Text>Updates</Text>,
    '(app)/cohort/[id]': CohortHomeScreen,
    '(app)/staff/submission/[id]': StaffSubmissionScreen,
    '(app)/lesson/[id]': LessonTarget,
  }, { initialUrl });
}
it('opens an in-content school link as a native lesson', async () => {
  const result = mount('/'); await act(async () => openContentLink('/lessons/42?cohort_id=2#block-8'));
  expect(result.getPathname()).toBe('/lesson/42');
  expect(result.getSearchParams()).toEqual({ id: '42', cohort_id: '2', block_id: '8' });
});
it('guards feedback before replacing and refreshes an already-graded queue item', async () => {
  const [first, second] = demoStaffSubmissions;
  const result = mount(`/staff/submission/${first.id}?queue=test`);
  await screen.findByText('1 of 2');
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  fireEvent.changeText(screen.getByLabelText('Feedback for student'), 'Please explain the loop');
  fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await waitFor(() => expect(themedAlert.alert).toHaveBeenCalledWith('Leave this review?', expect.any(String), expect.any(Array)));
  expect(result.getPathname()).toBe(`/staff/submission/${first.id}`);
  const choices = jest.mocked(themedAlert.alert).mock.calls.at(-1)![2]!;
  await act(async () => choices.find(choice => choice.text === 'Leave review')!.onPress!());
  await screen.findByText('Not in queue · 1 left');
  expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
  expect(result.getPathname()).toBe(`/staff/submission/${second.id}`);
  fireEvent.press(screen.getByRole('button', { name: 'Next' }));
  await screen.findByText('1 of 1');
});
it('does not expose queue navigation on direct record entry', async () => {
  mount(`/staff/submission/${demoStaffSubmissions[0].id}`);
  await screen.findByLabelText('Feedback for student');
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
});

it.each([['Continue learning', '/learn'], ['Class messages', '/messages'], ['Updates', '/updates']])('switches %s from cohort home without stacking tabs', async (label, destination) => {
  mockStaff = false;
  const result = mount('/');
  await act(async () => router.push('/cohort/1'));
  fireEvent.press(await screen.findByRole('button', { name: label }));
  await waitFor(() => expect(result.getPathname()).toBe(destination));
  const state = JSON.stringify(result.getRouterState());
  expect(state.match(/"name":"\(tabs\)"/g)).toHaveLength(1);
  expect(state).not.toContain('"name":"cohort/[id]"');
  mockStaff = true;
});

it.each(['/', '/learn', '/messages', '/updates', '/profile', '/updates?announcement_id=4'].flatMap(path => [path, `https://learn.codeschoolofguam.com${path}`]))('opens tab content link %s from a conversation with one tab navigator', async href => {
  const result = mount('/');
  await act(async () => router.push('/conversation/dm/5'));
  await act(async () => openContentLink(href));
  const expected = new URL(href, 'https://learn.codeschoolofguam.com');
  await waitFor(() => expect(result.getPathname()).toBe(expected.pathname));
  expect(JSON.stringify(result.getRouterState()).match(/"name":"\(tabs\)"/g)).toHaveLength(1);
  if (expected.search) expect(result.getSearchParams()).toEqual({ announcement_id: '4' });
});

it('keeps Previous/Next available when a queue record fails to load', async () => {
  mockDemo = false;
  mockSubmission.mockRejectedValue(new Error('Record unavailable'));
  const result = mount(`/staff/submission/${demoStaffSubmissions[1].id}?queue=test`);
  await screen.findByText('Record unavailable');
  expect(screen.getByRole('button', { name: 'Previous' })).not.toBeDisabled();
  fireEvent.press(screen.getByRole('button', { name: 'Previous' }));
  await waitFor(() => expect(result.getPathname()).toBe(`/staff/submission/${demoStaffSubmissions[0].id}`));
});
it('does not use a queue cached for another user', async () => {
  mount(`/staff/submission/${demoStaffSubmissions[0].id}?queue=other-user`);
  await act(async () => { client.setQueryData(gradingQueueKey(8, 'other-user'), { submissions: demoStaffSubmissions }); });
  await screen.findByLabelText('Feedback for student');
  expect(screen.queryByRole('button', { name: 'Next' })).toBeNull();
});
