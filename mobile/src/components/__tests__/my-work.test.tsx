import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import MyWork from '@/app/(app)/my-work';

const mockPush = jest.fn();
const mockMyWork = jest.fn();
const mockCreateCohortDm = jest.fn();

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: mockPush }),
  useLocalSearchParams: () => ({ cohort_id: '4' }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    const { useEffect } = jest.requireActual('react');
    useEffect(() => cb(), [cb]);
  },
}));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: jest.requireActual('react-native').View }));
jest.mock('@/components/back-button', () => ({ BackButton: () => null }));
jest.mock('@/components/authored-content', () => ({
  AuthoredContent: ({ body }: { body: string }) => {
    const { Text } = jest.requireActual('react-native');
    return <Text>{body}</Text>;
  },
}));
jest.mock('@/providers/session-provider', () => ({
  useSession: () => ({
    user: { id: 12, is_staff: false },
    api: { myWork: mockMyWork, createCohortDm: mockCreateCohortDm },
  }),
}));

describe('MyWork screen', () => {
  let client: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    mockMyWork.mockResolvedValue({
      my_work: {
        cohort: { id: 4, name: 'Cohort 3' },
        read_only: false,
        review_response_time: 'usually within 1 business day',
        reviewer: { id: 2, full_name: 'Leon Shimizu' },
        contact: { id: 2, full_name: 'Leon Shimizu' },
        counts: { needs_you: 1, waiting: 1, graded: 0 },
        needs_you: [
          {
            submission_id: 101,
            status: 'redo',
            cohort_id: 4,
            lesson_id: 22,
            content_block_id: 88,
            lesson_title: 'Loops Exercise',
            block_title: 'FizzBuzz',
            module_name: 'Week 2',
            week: 2,
            attempt: 1,
            grade: 'R',
            feedback: 'Check your boundary condition.',
            submitted_at: '2026-11-20T00:00:00Z',
            graded_at: '2026-11-21T00:00:00Z',
            grader: { id: 2, full_name: 'Leon Shimizu' },
            submission_type: 'text',
            submissions_closed: false,
            can_resubmit: true,
            ask_to: { id: 2, full_name: 'Leon Shimizu' },
          },
        ],
        waiting: [
          {
            submission_id: 102,
            status: 'waiting',
            cohort_id: 4,
            lesson_id: 23,
            content_block_id: 89,
            lesson_title: 'Arrays Exercise',
            block_title: 'Map and Filter',
            module_name: 'Week 2',
            week: 2,
            attempt: 1,
            grade: null,
            feedback: null,
            submitted_at: '2026-11-22T00:00:00Z',
            graded_at: null,
            grader: null,
            submission_type: 'text',
            submissions_closed: false,
            can_resubmit: false,
            ask_to: null,
            expected_review_on: '2026-11-24',
          },
        ],
        graded: [],
      },
    });
    mockCreateCohortDm.mockResolvedValue({ direct_conversation: { id: 55 } });
  });

  afterEach(() => client.clear());

  it('auto-selects Needs you, supports switching tabs, and opens DM from Ask about this feedback', async () => {
    const view = render(
      <QueryClientProvider client={client}>
        <MyWork />
      </QueryClientProvider>,
    );

    expect(await view.findByText('Loops Exercise · FizzBuzz')).toBeTruthy();
    expect(view.getByText('Check your boundary condition.')).toBeTruthy();

    fireEvent.press(view.getByText('Ask about this feedback'));
    await waitFor(() => expect(mockCreateCohortDm).toHaveBeenCalledWith(4, [2]));
    expect(mockPush).toHaveBeenCalledWith('/conversation/dm/55');

    fireEvent.press(view.getByRole('tab', { name: /Waiting/ }));
    expect(await view.findByText('Arrays Exercise · Map and Filter')).toBeTruthy();

    fireEvent.press(view.getByRole('tab', { name: /Reviewed/ }));
    expect(await view.findByText('No reviewed work yet')).toBeTruthy();
  });

  it('guards against duplicate DM requests and ignores resolution after unmount', async () => {
    let resolveDm: ((value: { direct_conversation: { id: number } }) => void) | undefined;
    mockCreateCohortDm.mockImplementation(
      () => new Promise((resolve) => { resolveDm = resolve; }),
    );
    const view = render(
      <QueryClientProvider client={client}>
        <MyWork />
      </QueryClientProvider>,
    );

    const askBtn = await view.findByText('Ask about this feedback');
    fireEvent.press(askBtn);
    fireEvent.press(askBtn);
    expect(mockCreateCohortDm).toHaveBeenCalledTimes(1);

    view.unmount();
    resolveDm?.({ direct_conversation: { id: 99 } });
    await Promise.resolve();
    expect(mockPush).not.toHaveBeenCalled();
  });
});
