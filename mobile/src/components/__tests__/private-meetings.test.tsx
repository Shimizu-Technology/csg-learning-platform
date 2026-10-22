import { act, fireEvent, render } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';
import { MeetingCohort, MeetingConfirmation } from '../private-meetings';
import { booking, cohort, now } from '@/lib/meeting-test-fixtures';
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => name === '__esModule' ? false : () => null }));
const select = jest.fn();
const message = jest.fn();
const join = jest.fn();
function show(c = cohort, disabled = false, time = now) { return render(<MeetingCohort cohort={c} now={time} disabled={disabled} onSelect={select} onMessage={message} onJoin={join} />); }
beforeEach(() => { jest.clearAllMocks(); jest.spyOn(AccessibilityInfo, 'isReduceMotionEnabled').mockResolvedValue(true); });
async function settle() { await act(async () => {}); }
it('orders weeks and hides past meetings until expanded; completed meetings never join', async () => {
  const screen = show({ ...cohort, bookings: [{ ...booking, week_number: 1, starts_at: '2026-12-05T02:00:00Z', ends_at: '2026-12-05T03:00:00Z' }] });
  await settle();
  expect(screen.queryByText('Week 1')).toBeNull();
  expect(screen.getAllByRole('header').map((h) => [h.props.children].flat().join(''))).toEqual(['Python Fundamentals', 'Week 2', 'Week 3']);
  fireEvent.press(screen.getByTestId('past-weeks-2'));
  expect(screen.getByText('Completed')).toBeTruthy();
  expect(screen.queryByText('Join on Zoom')).toBeNull();
});
it('selects a time without writing until the confirmation, with ChST labels', async () => {
  const screen = show(); await settle();
  fireEvent.press(screen.getByTestId('meeting-slot-2-0'));
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ kind: 'book', week: 2, slot: expect.objectContaining({ id: 11 }) }));
  expect(screen.getByLabelText(/Choose Week 2, Sat, Dec 12.*ChST/)).toBeTruthy();
});
it('disabled offline controls cannot select a slot or create a DM', async () => {
  const screen = show(cohort, true); await settle();
  fireEvent.press(screen.getByTestId('meeting-slot-2-0'));
  fireEvent.press(screen.getByLabelText('Message your instructor for Python Fundamentals'));
  expect(select).not.toHaveBeenCalled(); expect(message).not.toHaveBeenCalled();
});
it('offers one reschedule and keeps cancellation after the change is used', async () => {
  const screen = show({ ...cohort, bookings: [{ ...booking, reschedule_count: 1 }] }); await settle();
  expect(screen.queryByTestId('reschedule-week-2')).toBeNull();
  fireEvent.press(screen.getByTestId('cancel-week-2'));
  expect(select).toHaveBeenCalledWith(expect.objectContaining({ kind: 'cancel' }));
});
it('distinguishes empty openings from closed weeks and exhausted changes', async () => {
  const screen = show({ ...cohort, slots: [] }); await settle();
  expect(screen.getByText('No openings are available for Week 2 yet. Message your instructor if you need help.')).toBeTruthy();
  const closed = show({ ...cohort, slots: [] }, false, Date.parse('2026-12-13T14:00:00+10:00')); await settle();
  expect(closed.getByText('Booking for Week 2 has closed — message your instructor.')).toBeTruthy();
});
it('warns before moving and lets Keep meeting dismiss cancellation without saving', async () => {
  const dismiss = jest.fn(), confirm = jest.fn();
  const screen = render(<MeetingConfirmation action={{ kind: 'cancel', cohort, week: 2, booking }} busy={false} disabled={false} onDismiss={dismiss} onConfirm={confirm} />); await settle();
  expect(screen.getByText(/only schedule change/)).toBeTruthy();
  fireEvent.press(screen.getByText('Keep meeting')); expect(dismiss).toHaveBeenCalledTimes(1); expect(confirm).not.toHaveBeenCalled();
  screen.rerender(<MeetingConfirmation action={{ kind: 'reschedule', cohort, week: 2, booking, slot: cohort.slots[0] }} busy={false} disabled={false} onDismiss={dismiss} onConfirm={confirm} />); await settle();
  expect(screen.getByText(/only remaining schedule change/)).toBeTruthy();
});
it('prevents confirmation and dismissal during submission', async () => {
  const dismiss = jest.fn(), confirm = jest.fn();
  const screen = render(<MeetingConfirmation action={{ kind: 'book', cohort, week: 2, slot: cohort.slots[0] }} busy disabled={false} onDismiss={dismiss} onConfirm={confirm} />); await settle();
  fireEvent.press(screen.getByTestId('meeting-confirm-submit')); fireEvent.press(screen.getByTestId('meeting-confirm-dismiss'));
  expect(confirm).not.toHaveBeenCalled(); expect(dismiss).not.toHaveBeenCalled();
});
it('retains long instructor names, course titles, empty slots and scaled labels without truncation', async () => {
  const long = 'Aleksandra Wiśniewska-Kowalczyk';
  const screen = show({ ...cohort, instructor_name: long, name: 'Python Fundamentals — December invited beginner cohort with weekend private meetings', slots: [], bookings: [{ ...booking, instructor_name: long, zoom_url: null }] }); await settle();
  expect(screen.getByText(`60 minutes with ${long}`)).toBeTruthy();
  expect(screen.getByText(/Your Zoom link is being prepared/)).toBeTruthy();
  expect(screen.getByText(`60 minutes with ${long}`).props.numberOfLines).toBeUndefined();
});
it('keeps the cached Zoom join usable near the hour even while availability refresh is unavailable', async () => {
  const screen = show({ ...cohort, bookings: [booking] }, true, Date.parse(booking.starts_at)); await settle();
  fireEvent.press(screen.getByLabelText('Join Week 2 meeting on Zoom'));
  expect(join).toHaveBeenCalledWith(booking.zoom_url);
});

it('does not label or focus a current booking as the missing notification target', async () => {
  const onTargetLayout = jest.fn();
  const screen = render(<MeetingCohort cohort={{ ...cohort, bookings: [booking] }} targetBookingId={999} targetWeek={2} onTargetLayout={onTargetLayout} now={now} disabled={false} onSelect={select} onMessage={message} onJoin={join} />);
  await settle();
  expect(screen.getByText(/This booking is no longer available/)).toBeTruthy();
  expect(screen.queryByText(/Meeting from your update/)).toBeNull();
  expect(screen.getByText('Booked')).toBeTruthy();
  fireEvent(screen.getByTestId(`meeting-week-${cohort.id}-2`), 'layout', { target: { measureLayout: jest.fn() }, nativeEvent: { layout: { y: 300 } } });
  expect(onTargetLayout).not.toHaveBeenCalled();
});
it('runs the target layout callback using a native component ref and the booking’s actual week', async () => {
  const onTargetLayout = jest.fn();
  const node = { measureLayout: jest.fn() };
  const screen = render(<MeetingCohort cohort={{ ...cohort, bookings: [booking] }} targetBookingId={booking.id} targetWeek={3} onTargetLayout={onTargetLayout} now={now} disabled={false} onSelect={select} onMessage={message} onJoin={join} />, { createNodeMock: () => node });
  await settle();
  fireEvent(screen.getByTestId(`meeting-week-${cohort.id}-2`), 'layout', { nativeEvent: { layout: { x: 0, y: 200, width: 300, height: 100 } } });
  expect(onTargetLayout).toHaveBeenCalledTimes(1);
  expect(typeof onTargetLayout.mock.calls[0][0].measureLayout).toBe('function');
  expect(screen.getByText(`Meeting from your update · Booking ${booking.id}`)).toBeTruthy();
});
