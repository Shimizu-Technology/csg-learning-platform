import { fireEvent, render } from '@testing-library/react-native';
import type { SupportQueueStudent } from '@/lib/types';
const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
// eslint-disable-next-line import/first
import { StaffAttention } from '../staff-attention';

const row = (id: number): SupportQueueStudent => ({ enrollment_id: id, user_id: 18, cohort_id: id, full_name: `Learner ${id}`, email: 'learner@example.com', cohort_name: `Cohort ${id}`, progress_percentage: 4, completed_blocks: 1, total_blocks: 25, released_unfinished_blocks: 2, last_activity_at: null, help_request_count: 1, urgent_help_count: 0, redo_count: 0, ungraded_count: 0, inactive: false, active_intervention_id: null, intervention_status: null, follow_up_due: false, recovery_plan_id: null, recovery_check_in_due: false, priority: 0, needs_attention: true, next_action: { label: 'Respond to help', web_path: `/admin/help-requests/${id}?enrollment_id=${id}`, native_path: `/staff/support/${id}?cohort_id=${id}&enrollment_id=${id}`, enrollment_id: id }, reasons: [{ code: 'help_response', label: 'Staff response needed', source_type: 'HelpRequest', source_ids: [id], since: '2026-10-20', action: { label: 'Respond to help', web_path: '', native_path: '', enrollment_id: id } }] });

describe('StaffAttention', () => {
  it('previews eight server-ordered enrollments and links to the complete queue', () => {
    const screen = render(<StaffAttention students={Array.from({ length: 10 }, (_, index) => row(index + 1))} limit={8} cohortId={4} />);
    expect(screen.getAllByText('Staff response needed')).toHaveLength(8);
    expect(screen.queryByText('Learner 9')).toBeNull();
    fireEvent.press(screen.getByText('View all 10'));
    expect(mockPush).toHaveBeenLastCalledWith('/staff/support?cohort_id=4');
    fireEvent.press(screen.getByLabelText('Respond to help · Learner 2 · Cohort 2'));
    expect(mockPush).toHaveBeenLastCalledWith('/staff/support/2?cohort_id=2&enrollment_id=2');
  });
  it('explains the healthy empty state without progress thresholds', () => {
    const screen = render(<StaffAttention students={[]} limit={8} />);
    expect(screen.getByText('Everyone’s on track')).toBeTruthy();
    expect(screen.getByText(/Checked help requests/)).toBeTruthy();
    expect(screen.queryByText(/View all/)).toBeNull();
  });
});
