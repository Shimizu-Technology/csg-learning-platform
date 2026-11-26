import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { learningKeys } from '@/lib/learning';
import { ContextualHelp } from '../contextual-help';
import type { EnrollmentCapabilities, HelpRequest } from '@/lib/types';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockHelpRequests = jest.fn();
const mockCreateHelp = jest.fn();
const mockUpdateHelp = jest.fn();
const mockReply = jest.fn();
const mockCreateDm = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: { helpRequests: mockHelpRequests, createHelpRequest: mockCreateHelp, updateHelpRequest: mockUpdateHelp, replyToHelpRequest: mockReply, createCohortDm: mockCreateDm }, user: { id: 4 } }) }));
jest.mock('@/hooks/use-voice-draft', () => ({ useVoiceDraft: () => ({ state: 'idle', cancel: jest.fn() }) }));
jest.mock('@/components/voice-draft-controls', () => ({ VoiceDraftButton: () => null, VoiceDraftPanel: () => null }));
const capabilities: EnrollmentCapabilities = { live_support: false, features: {}, can_submit: true, read_only: false, support_mode: 'guided_help', support_expires_at: null, access_expires_at: null, support_instructor_id: null };
const resolved = {context_label: '', context_path: '', category: "concept", urgency: "normal", message: '', acknowledged_at: null, resolved_at: null, canceled_at: null, created_at: '', updated_at: '', owner: null, destination: null, context_destination: null, id: 1, cohort: { id: 8, name: 'Pilot' }, context_type: 'lesson', context_source: 'primary', context_id: 42, status: 'resolved', staff_response: 'Start with the loop condition.' } as HelpRequest;
function show(caps = capabilities) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return { client, ...render(<QueryClientProvider client={client}><ContextualHelp cohortId={8} contextType="lesson" contextId={42} contextLabel="Loops" capabilities={caps} /></QueryClientProvider>) };
}
beforeEach(() => { jest.clearAllMocks(); mockHelpRequests.mockResolvedValue({ help_requests: [resolved] }); });

it('keeps guided help and its previous response accessible', async () => {
  const screen = show();
  fireEvent.press(screen.getByLabelText('Ask for help with Loops'));
  await waitFor(() => expect(screen.getByText('Start with the loop condition.')).toBeTruthy());
  expect(screen.getByLabelText('Describe where you are stuck')).toBeTruthy();
});

it('keeps previous responses readable after support expires without a write form', async () => {
  const screen = show({ ...capabilities, support_mode: 'none', support_expires_at: '2026-01-01T00:00:00Z' });
  await waitFor(() => expect(screen.getByLabelText('View previous help for Loops')).toBeTruthy());
  fireEvent.press(screen.getByLabelText('View previous help for Loops'));
  expect(screen.getByText('Start with the loop condition.')).toBeTruthy();
  expect(screen.queryByLabelText('Describe where you are stuck')).toBeNull();
  expect(mockCreateHelp).not.toHaveBeenCalled();
  expect(mockUpdateHelp).not.toHaveBeenCalled();
});

it('hides all contextual help when the resolved switch is off', async () => {
  const screen = show({ ...capabilities, features: { help_requests: false } });
  await waitFor(() => expect(screen.queryByLabelText('Ask for help with Loops')).toBeNull());
  expect(screen.queryByLabelText('View previous help for Loops')).toBeNull();
});

it('shows every reply on a resolved request, not only the last one (PR #282 fix round 1)', async () => {
  const replies = [
    { id: 1, body: 'Print the counter first.', resolved_request: false, author: { id: 9, full_name: 'Ina Teacher' }, created_at: '2026-10-01T01:00:00Z' },
    { id: 3, body: 'I tried that.', from_student: true, resolved_request: false, author: { id: 4, full_name: 'Student' }, created_at: '2026-10-01T01:30:00Z' },
    { id: 2, body: 'Then add one inside the loop.', resolved_request: true, author: { id: 9, full_name: 'Ina Teacher' }, created_at: '2026-10-01T02:00:00Z' },
  ];
  mockHelpRequests.mockResolvedValue({ help_requests: [{ ...resolved, staff_response: 'Then add one inside the loop.', replies }] });
  const screen = show();
  fireEvent.press(screen.getByLabelText('Ask for help with Loops'));
  await waitFor(() => expect(screen.getByText('Print the counter first.')).toBeTruthy());
  expect(screen.getByText('Then add one inside the loop.')).toBeTruthy();
  expect(screen.getByText('Previous replies')).toBeTruthy();
  expect(screen.getByText('You replied')).toBeTruthy();
  expect(screen.getAllByText('Ina Teacher replied')).toHaveLength(2);
});

const instructorReply = { id: 1, body: 'Print the counter first.', from_student: false, resolved_request: false, author: { id: 9, full_name: 'Ina Teacher' }, created_at: '' };
const studentReply = { id: 2, body: 'It prints zero.', from_student: true, resolved_request: false, author: { id: 4, full_name: 'Student' }, created_at: '' };
const active: HelpRequest = { ...resolved, status: 'acknowledged', replies: [instructorReply] };

it('labels the active thread and opens a DM with the instructor after a student follow-up', async () => {
  mockHelpRequests.mockResolvedValue({ help_requests: [{ ...active, replies: [instructorReply, studentReply] }] });
  mockCreateDm.mockResolvedValue({ direct_conversation: { id: 12 } });
  const screen = show();
  fireEvent.press(await screen.findByLabelText('Help request status: Waiting for your instructor'));
  expect(screen.getByText('You replied')).toBeTruthy();
  expect(screen.getByText('Ina Teacher replied')).toBeTruthy();
  await act(async () => {
    fireEvent.press(screen.getByRole('button', { name: 'Message your instructor about this' }));
  });
  expect(mockCreateDm).toHaveBeenCalledWith(8, [9]);
});

it('sends the inline reply, locks the composer while pending, and updates the cached thread', async () => {
  mockHelpRequests.mockResolvedValue({ help_requests: [active] });
  const updated = { ...active, replies: [instructorReply, studentReply] };
  let finish!: (result: { help_request: HelpRequest }) => void;
  mockReply.mockReturnValueOnce(new Promise(resolve => { finish = resolve; }));
  const screen = show();
  fireEvent.press(await screen.findByLabelText('Help request status: Your instructor replied'));
  const input = () => screen.getByLabelText('Reply to your instructor');
  const send = () => screen.getByRole('button', { name: 'Send reply' });
  fireEvent.changeText(input(), ' It prints zero. ');
  fireEvent.press(send());
  expect(mockReply).toHaveBeenCalledWith(active.id, {
    body: 'It prints zero.',
    resolve: false,
    client_request_id: expect.stringMatching(/^[A-Za-z0-9_-]{8,64}$/),
  });
  expect(input().props.editable).toBe(false);
  expect(send()).toBeDisabled();

  await act(async () => finish({ help_request: updated }));
  expect(screen.client.getQueryData(learningKeys.helpRequests(4, 8, 'lesson'))).toEqual({ help_requests: [updated] });
  expect(screen.getByText('It prints zero.')).toBeTruthy();
  expect(input().props.value).toBe('');
  expect(input().props.editable).toBe(true);
});

it('keeps a legacy staff_response visible when only student follow-up replies exist', async () => {
  const legacyWithStudentReply: HelpRequest = { ...resolved, status: 'acknowledged', staff_response: 'Start with the loop condition.', replies: [studentReply] };
  mockHelpRequests.mockResolvedValue({ help_requests: [legacyWithStudentReply] });
  const screen = show();
  fireEvent.press(await screen.findByLabelText('Help request status: Waiting for your instructor'));
  expect(screen.getByText('Your instructor replied')).toBeTruthy();
  expect(screen.getByText('Start with the loop condition.')).toBeTruthy();
  expect(screen.getByText('You replied')).toBeTruthy();
  expect(screen.getByText('It prints zero.')).toBeTruthy();
});

it('reuses client_request_id only for unchanged retries and generates a new id after editing', async () => {
  mockHelpRequests.mockResolvedValue({ help_requests: [active] });
  mockReply
    .mockRejectedValueOnce(new Error('network lost'))
    .mockRejectedValueOnce(new Error('still offline'))
    .mockResolvedValueOnce({ help_request: { ...active, replies: [instructorReply, { ...studentReply, body: 'Updated draft' }] } });
  const screen = show();
  fireEvent.press(await screen.findByLabelText('Help request status: Your instructor replied'));
  const input = () => screen.getByLabelText('Reply to your instructor');
  const send = () => screen.getByRole('button', { name: 'Send reply' });

  fireEvent.changeText(input(), 'Draft A');
  await act(async () => { fireEvent.press(send()); });
  const firstId = mockReply.mock.calls[0][1].client_request_id;

  // Retry unchanged body (even with surrounding whitespace) -> same idempotency key
  fireEvent.changeText(input(), ' Draft A ');
  await act(async () => { fireEvent.press(send()); });
  expect(mockReply.mock.calls[1][1].client_request_id).toBe(firstId);

  // Edit draft after lost response -> fresh idempotency key
  fireEvent.changeText(input(), 'Updated draft');
  await act(async () => { fireEvent.press(send()); });
  expect(mockReply.mock.calls[2][1].client_request_id).not.toBe(firstId);
  expect(mockReply.mock.calls[2][1].body).toBe('Updated draft');
  expect(input().props.value).toBe('');
});

it('lets the learner add details to an open request before any instructor reply', async () => {
  const waiting: HelpRequest = { ...resolved, id: 5, status: 'open', staff_response: null, replies: [] };
  const note = { id: 3, body: 'TypeError: undefined', from_student: true, resolved_request: false, author: { id: 4, full_name: 'Student' }, created_at: '' };
  mockHelpRequests.mockResolvedValue({ help_requests: [waiting] });
  mockReply.mockResolvedValue({ help_request: { ...waiting, replies: [note] } });
  const screen = show();
  fireEvent.press(await screen.findByLabelText('Help request status: Sent to your instructor'));
  expect(screen.getByText('Add more details or paste an error message while you wait')).toBeTruthy();
  expect(screen.queryByText('Answer their question or share what happened when you tried it')).toBeNull();
  fireEvent.changeText(screen.getByLabelText('Add to your question'), 'TypeError: undefined');
  await act(async () => { fireEvent.press(screen.getByRole('button', { name: 'Add details' })); });
  expect(mockReply).toHaveBeenCalledWith(5, expect.objectContaining({ body: 'TypeError: undefined', resolve: false }));
});
