import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { ContextualHelp } from '../contextual-help';
import type { EnrollmentCapabilities, HelpRequest } from '@/lib/types';

jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));

const mockHelpRequests = jest.fn();
const mockCreateHelp = jest.fn();
const mockUpdateHelp = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: () => ({ demo: false }) }));
jest.mock('@/providers/session-provider', () => ({ useSession: () => ({ api: { helpRequests: mockHelpRequests, createHelpRequest: mockCreateHelp, updateHelpRequest: mockUpdateHelp }, user: { id: 4 } }) }));
jest.mock('@/hooks/use-voice-draft', () => ({ useVoiceDraft: () => ({ state: 'idle', cancel: jest.fn() }) }));
jest.mock('@/components/voice-draft-controls', () => ({ VoiceDraftButton: () => null, VoiceDraftPanel: () => null }));
const capabilities: EnrollmentCapabilities = { can_submit: true, read_only: false, support_mode: 'guided_help', support_expires_at: null, access_expires_at: null, support_instructor_id: null };
const resolved = { id: 1, cohort: { id: 8, name: 'Pilot' }, context_type: 'lesson', context_source: 'primary', context_id: 42, status: 'resolved', staff_response: 'Start with the loop condition.' } as HelpRequest;
function show(caps = capabilities) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><ContextualHelp cohortId={8} contextType="lesson" contextId={42} contextLabel="Loops" capabilities={caps} /></QueryClientProvider>);
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
