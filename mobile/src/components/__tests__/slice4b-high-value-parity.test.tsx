import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { getNetworkStateAsync } from 'expo-network';
import type { ReactElement } from 'react';

import { StaffPrivateMeetings } from '@/components/staff-private-meetings';
import { sendsAboutLabel } from '@/lib/scheduled-updates';
import { videoVersions } from '@/lib/video-versions';
import { useCsgAuth } from '@/providers/auth-provider';
import { useSession } from '@/providers/session-provider';

const mockPush = jest.fn();
jest.mock('expo-network', () => ({ getNetworkStateAsync: jest.fn().mockResolvedValue({ isConnected: true, isInternetReachable: true }) }));
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (name === '__esModule' ? false : () => null) }));
jest.mock('expo-router', () => ({
  usePathname: () => '/staff/intervention/42',
  useRouter: () => ({ push: mockPush, back: jest.fn(), canGoBack: () => true, replace: jest.fn() }),
  useLocalSearchParams: () => ({ id: '42' }),
}));
jest.mock('@/providers/auth-provider', () => ({ useCsgAuth: jest.fn() }));
jest.mock('@/providers/session-provider', () => ({ useSession: jest.fn() }));
jest.mock('@/lib/external-links', () => ({ openAuthenticatedWebPage: jest.fn(), openExternalPage: jest.fn() }));

// eslint-disable-next-line import/first
import StaffInterventionScreen from '../../app/(app)/staff/intervention/[id]';

describe('Slice 4B high-value parity', () => {
  let client: QueryClient;

  beforeEach(() => {
    jest.clearAllMocks();
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
    jest.mocked(useCsgAuth).mockReturnValue({ demo: false } as ReturnType<typeof useCsgAuth>);
  });

  afterEach(() => client.clear());

  function mount(ui: ReactElement) {
    return render(<QueryClientProvider client={client}>{ui}</QueryClientProvider>);
  }

  it('parses valid lesson video versions and ignores malformed entries', () => {
    expect(
      videoVersions({
        video_versions: [
          null,
          { id: 'bad' },
          { id: 'v1', label: 'Original', s3_video_key: 'videos/v1.mp4' },
          { id: 'v2', label: 'Studio 2026', s3_video_key: 'videos/v2.mp4' },
        ],
      }),
    ).toEqual([
      { id: 'v1', label: 'Original', s3_video_key: 'videos/v1.mp4' },
      { id: 'v2', label: 'Studio 2026', s3_video_key: 'videos/v2.mp4' },
    ]);
    expect(videoVersions(null)).toEqual([]);
  });

  it('renders native staff private meetings and updates a booking Zoom link', async () => {
    const staffPrivateMeetings = jest.fn().mockResolvedValue({
      cohorts: [
        {
          id: 5,
          name: 'Fall Bootcamp',
          start_date: '2026-10-01',
          end_date: '2026-12-20',
          instructor_id: 1,
          instructor_name: 'Leon Shimizu',
          weeks: 12,
          timezone: 'Pacific/Guam',
          reschedule_cutoff_hours: 24,
          max_student_changes: 1,
          slots: [{ id: 10, starts_at: '2026-12-02T00:00:00Z', ends_at: '2026-12-02T01:00:00Z', instructor_id: 1, instructor_name: 'Leon Shimizu', available: true }],
          bookings: [
            {
              id: 77,
              cohort_id: 5,
              instructor_name: 'Leon Shimizu',
              starts_at: '2026-12-01T00:00:00Z',
              ends_at: '2026-12-01T01:00:00Z',
              zoom_url: 'https://zoom.us/j/111',
              status: 'confirmed',
              week_number: 4,
              reschedule_count: 0,
              student_name: 'Maya Cruz',
              student_id: 21,
            },
          ],
        },
      ],
      other_cohorts: [],
      admin_contacts: [],
    });
    const updateStaffPrivateMeeting = jest.fn().mockResolvedValue({
      booking: {
        id: 77,
        cohort_id: 5,
        instructor_name: 'Leon Shimizu',
        starts_at: '2026-12-01T00:00:00Z',
        ends_at: '2026-12-01T01:00:00Z',
        zoom_url: 'https://zoom.us/j/999',
        status: 'confirmed',
        week_number: 4,
        reschedule_count: 0,
        student_name: 'Maya Cruz',
        student_id: 21,
      },
    });
    const createCohortDm = jest.fn().mockResolvedValue({ direct_conversation: { id: 88 } });

    jest.mocked(useSession).mockReturnValue({
      user: { id: 1, is_staff: true, full_name: 'Leon Shimizu' },
      api: { staffPrivateMeetings, updateStaffPrivateMeeting, createCohortDm },
    } as unknown as ReturnType<typeof useSession>);

    const screen = mount(
      <StaffPrivateMeetings
        cohortId={null}
        targetBookingId={77}
        targetWeek={4}
        connected
        busy={false}
        onOpenWeb={jest.fn()}
        writeError={null}
      />,
    );

    expect(await screen.findByText('Maya Cruz')).toBeTruthy();
    expect(screen.getByText('Meeting from your update')).toBeTruthy();

    fireEvent.press(screen.getByRole('button', { name: 'Edit link for Maya Cruz' }));
    const meetingUrlInput = await screen.findByLabelText('Meeting URL');
    fireEvent.changeText(meetingUrlInput, 'https://zoom.us/j/999');
    fireEvent.press(screen.getByRole('button', { name: 'Save link' }));

    await waitFor(() =>
      expect(updateStaffPrivateMeeting).toHaveBeenCalledWith(77, { zoom_url: 'https://zoom.us/j/999' }),
    );

    fireEvent.press(screen.getByRole('button', { name: 'Message Maya Cruz' }));
    await waitFor(() => expect(createCohortDm).toHaveBeenCalledWith(5, [21]));
    expect(mockPush).toHaveBeenCalledWith('/conversation/dm/88');
  });

  it('blocks Edit link when the live network check reports offline and formats scheduled preview in target zone', async () => {
    expect(sendsAboutLabel('2030-01-15T17:00:00Z', 'America/Los_Angeles')).toContain('9:00 AM');
    expect(sendsAboutLabel('2030-01-15T17:00:00Z', 'Pacific/Guam')).toContain('3:00 AM ChST');

    const staffPrivateMeetings = jest.fn().mockResolvedValue({
      cohorts: [
        {
          id: 5,
          name: 'Fall Bootcamp',
          start_date: '2026-10-01',
          end_date: '2026-12-20',
          instructor_id: 1,
          instructor_name: 'Leon Shimizu',
          weeks: 12,
          timezone: 'Pacific/Guam',
          reschedule_cutoff_hours: 24,
          max_student_changes: 1,
          slots: [],
          bookings: [
            {
              id: 77,
              cohort_id: 5,
              instructor_name: 'Leon Shimizu',
              starts_at: '2026-12-01T00:00:00Z',
              ends_at: '2026-12-01T01:00:00Z',
              zoom_url: 'https://zoom.us/j/111',
              status: 'confirmed',
              week_number: 4,
              reschedule_count: 0,
              student_name: 'Maya Cruz',
              student_id: 21,
            },
          ],
        },
      ],
      other_cohorts: [],
      admin_contacts: [],
    });

    jest.mocked(useSession).mockReturnValue({
      user: { id: 1, is_staff: true, full_name: 'Leon Shimizu' },
      api: { staffPrivateMeetings, updateStaffPrivateMeeting: jest.fn(), createCohortDm: jest.fn() },
    } as unknown as ReturnType<typeof useSession>);
    jest.mocked(getNetworkStateAsync).mockResolvedValueOnce({ isConnected: false, isInternetReachable: false } as never);

    const screen = mount(
      <StaffPrivateMeetings
        cohortId={null}
        targetBookingId={null}
        targetWeek={null}
        connected
        busy={false}
        onOpenWeb={jest.fn()}
        writeError={null}
      />,
    );

    expect(await screen.findByText('Maya Cruz')).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Edit link for Maya Cruz' }));
    await waitFor(() => expect(getNetworkStateAsync).toHaveBeenCalledTimes(1));
    expect(screen.queryByLabelText('Meeting URL')).toBeNull();
  });

  it('displays and creates private staff notes on an intervention', async () => {
    const intervention = jest.fn().mockResolvedValue({
      intervention: {
        id: 42,
        trigger_type: 'inactive',
        severity: 'normal',
        status: 'open',
        evidence_snapshot: { days_inactive: 6 },
        action_summary: 'Check in before lab',
        next_follow_up_at: '2026-12-03T00:00:00Z',
        follow_up_due: false,
        outcome: null,
        resolution_summary: null,
        resolved_at: null,
        created_at: '2026-11-26T00:00:00Z',
        updated_at: '2026-11-26T00:00:00Z',
        enrollment: { id: 9, status: 'active', student: { id: 21, full_name: 'Maya Cruz', email: 'maya@example.com' }, cohort: { id: 5, name: 'Fall Bootcamp' } },
        owner_valid: true,
        owner: { id: 1, full_name: 'Leon Shimizu' },
        created_by: { id: 1, full_name: 'Leon Shimizu' },
        help_request_id: null,
        recovery_plan_id: null,
        notes: [
          { id: 101, body: 'Called on Tuesday.', author: { id: 1, full_name: 'Leon Shimizu' }, created_at: '2026-11-26T10:00:00Z', updated_at: '2026-11-26T10:00:00Z' },
        ],
      },
    });
    const createInterventionNote = jest.fn().mockResolvedValue({
      note: {
        id: 102,
        body: 'Student confirmed attendance for Thursday.',
        author: { id: 1, full_name: 'Leon Shimizu' },
        created_at: '2026-11-27T10:00:00Z',
        updated_at: '2026-11-27T10:00:00Z',
      },
    });

    jest.mocked(useSession).mockReturnValue({
      user: { id: 1, is_staff: true, full_name: 'Leon Shimizu' },
      api: { intervention, createInterventionNote },
    } as unknown as ReturnType<typeof useSession>);

    const screen = mount(<StaffInterventionScreen />);
    expect(await screen.findByText('Called on Tuesday.')).toBeTruthy();

    fireEvent.changeText(screen.getByLabelText('Add private staff note'), 'Student confirmed attendance for Thursday.');
    fireEvent.press(screen.getByRole('button', { name: 'Save private note' }));

    await waitFor(() =>
      expect(createInterventionNote).toHaveBeenCalledWith(42, 'Student confirmed attendance for Thursday.'),
    );
    expect(await screen.findByText('Student confirmed attendance for Thursday.')).toBeTruthy();
  });
});
