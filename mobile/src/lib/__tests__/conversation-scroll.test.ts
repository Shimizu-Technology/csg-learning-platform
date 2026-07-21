import { formatConversationDay, isDifferentConversationDay, isNearConversationBottom } from '../conversation-scroll';

describe('conversation scrolling', () => {
  it('treats the final 96 points as the live conversation edge', () => {
    expect(isNearConversationBottom({ contentOffset: { y: 810 }, contentSize: { height: 1_400 }, layoutMeasurement: { height: 500 } })).toBe(true);
    expect(isNearConversationBottom({ contentOffset: { y: 700 }, contentSize: { height: 1_400 }, layoutMeasurement: { height: 500 } })).toBe(false);
    expect(isNearConversationBottom({ contentOffset: { y: 36 }, contentSize: { height: 1_400 }, layoutMeasurement: { height: 500 } }, 96, true)).toBe(true);
    expect(isNearConversationBottom({ contentOffset: { y: 180 }, contentSize: { height: 1_400 }, layoutMeasurement: { height: 500 } }, 96, true)).toBe(false);
  });

  it('formats premium day dividers and detects date boundaries', () => {
    const now = new Date('2026-07-21T15:00:00+10:00');
    expect(formatConversationDay('2026-07-21T09:00:00+10:00', now)).toBe('Today');
    expect(formatConversationDay('2026-07-20T09:00:00+10:00', now)).toBe('Yesterday');
    expect(isDifferentConversationDay('2026-07-21T01:00:00+10:00', '2026-07-20T23:00:00+10:00')).toBe(true);
    expect(isDifferentConversationDay('2026-07-21T03:00:00+10:00', '2026-07-21T01:00:00+10:00')).toBe(false);
  });
});
