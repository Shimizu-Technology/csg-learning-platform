import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { GithubReviewCards } from '../github-review-cards';
import { StudentTodayV2 } from '../student-today-v2';
import { SearchHeaderButton } from '../search-header-button';
import type { StudentDashboard, Submission } from '@/lib/types';

const mockPush = jest.fn();
const mockChoosePace = jest.fn();
const mockGithubBindings = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({
  user: { id: 12 }, enrollments: [{ id: 8, cohort: { id: 3 } }],
  api: { choosePace: mockChoosePace, githubBindings: mockGithubBindings },
}) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));

const clients: QueryClient[] = [];
afterEach(() => { clients.splice(0).forEach(client => client.clear()); });

function withQuery(component: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } });
  clients.push(client);
  return render(<QueryClientProvider client={client}>{component}</QueryClientProvider>);
}

test('Today shows welcome and GitHub setup before pace, and routes the redo and closed work', async () => {
  mockGithubBindings.mockResolvedValue({ bindings: [] });
  mockChoosePace.mockResolvedValue({});
  const refresh = jest.fn();
  const dashboard = {
    cohort: { id: 3 },
    modules: [{ lessons: [{ id: 19, title: 'Closed exercise', required: true, available: true, completed: false, submission_window: { submissions_closed: true, submissions_close_at: '2026-11-22T05:00:00Z' } }] }],
    student_today: {
      first_run: true, next_lesson: { id: 42, title: 'Your exercise', status: 'redo' }, contact: { id: 10, full_name: 'Teacher' },
      personal_pace: { enrollment_id: 8, available: true, status: 'not_chosen', choices: [{ weeks: 4, ends_on: '2026-12-22' }] },
      needs_you: { items: [], count: 0 }, waiting: { items: [], count: 0 },
    },
  } as unknown as StudentDashboard;
  const screen = withQuery(<StudentTodayV2 dashboard={dashboard} githubApp refresh={refresh} />);
  expect(screen.getByText('Welcome to your course')).toBeTruthy();
  expect(screen.getByText('Connect GitHub')).toBeTruthy();
  fireEvent.press(screen.getByText(/4 weeks/));
  await waitFor(() => expect(mockChoosePace).toHaveBeenCalledWith(8, 4));
  await waitFor(() => expect(refresh).toHaveBeenCalled());
  fireEvent.press(screen.getByText('Fix your redo'));
  expect(mockPush).toHaveBeenLastCalledWith({ pathname: '/lesson/[id]', params: { id: '42', cohort_id: '3' } });
  expect(screen.getByText('Catch up on closed work')).toBeTruthy();
  expect(screen.getByText('Ask for a catch-up plan')).toBeTruthy();
  expect(screen.queryByText(/caught up/i)).toBeNull();
});

test('grading shows plain status and lets staff retry a failed GitHub delivery', async () => {
  const retry = jest.fn().mockResolvedValue(undefined);
  const submission = { grade_suggestion: { outcome: 'stale_evidence' }, github_issue_delivery: { status: 'failed' } } as Submission;
  const screen = withQuery(<GithubReviewCards submission={submission} retry={retry} />);
  expect(screen.getByText('Out of date')).toBeTruthy();
  expect(screen.getByText('Could not post to GitHub')).toBeTruthy();
  fireEvent.press(screen.getByText('Retry GitHub delivery'));
  await waitFor(() => expect(retry).toHaveBeenCalled());
});

test('the header Search action opens global search', () => {
  const screen = render(<SearchHeaderButton />);
  fireEvent.press(screen.getByLabelText('Search'));
  expect(mockPush).toHaveBeenLastCalledWith('/search');
});
