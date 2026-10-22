import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CourseSupportAction } from '../course-support-action';
import type { EnrollmentCapabilities } from '@/lib/types';

const mockPush = jest.fn();
const mockCreateDm = jest.fn().mockResolvedValue({ direct_conversation: { id: 72 } });
const mockLoadDraft = jest.fn().mockResolvedValue('Existing unsent work');
const mockSaveDraft = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: { createCohortDm: mockCreateDm }, user: { id: 4 } }) }));
jest.mock('@/lib/conversation-storage', () => ({ loadConversationDraft: (...args: unknown[]) => mockLoadDraft(...args), saveConversationDraft: (...args: unknown[]) => mockSaveDraft(...args) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
const capabilities: EnrollmentCapabilities = { can_submit: true, read_only: false, support_mode: 'course_question', support_instructor_id: 9, support_expires_at: '2026-12-01T00:00:00Z', access_expires_at: null };
beforeEach(() => jest.clearAllMocks());

it('opens the assigned instructor DM with context while preserving the existing draft', async () => {
  const screen = render(<CourseSupportAction cohortId={8} capabilities={capabilities} contextLabel="Loops exercise" contextPath="/lessons/42?cohort_id=8#block-9" />);
  fireEvent.press(screen.getByLabelText('Ask a course question'));
  await waitFor(() => expect(mockPush).toHaveBeenCalledWith('/conversation/dm/72'));
  expect(mockCreateDm).toHaveBeenCalledWith(8, [9]);
  expect(mockSaveDraft).toHaveBeenCalledWith(4, 'dm', 72, 'Existing unsent work\n\nCourse question: Loops exercise\n/lessons/42?cohort_id=8#block-9\n\n');
});

it('shows expired support dates and account support without offering a course question', () => {
  const screen = render(<CourseSupportAction cohortId={8} capabilities={{ ...capabilities, support_mode: 'none', support_expires_at: '2026-01-01T00:00:00Z' }} contextLabel="Loops" />);
  expect(screen.getByText(/Jan 1, 2026/)).toBeTruthy();
  expect(screen.getByText('Account support')).toBeTruthy();
  expect(screen.queryByLabelText('Ask a course question')).toBeNull();
  expect(mockCreateDm).not.toHaveBeenCalled();
});

it('leaves guided contextual help to its own form', () => {
  const screen = render(<CourseSupportAction cohortId={8} capabilities={{ ...capabilities, support_mode: 'guided_help' }} contextLabel="Loops" />);
  expect(screen.toJSON()).toBeNull();
});
