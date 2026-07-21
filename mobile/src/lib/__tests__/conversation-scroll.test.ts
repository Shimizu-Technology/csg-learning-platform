import { formatConversationDay, isDifferentConversationDay, isNearConversationBottom } from '../conversation-scroll';

describe('conversation scrolling', () => {
  it('treats the final 96 points as the live conversation edge', () => {
    expect(isNearConversationBottom({ contentOffset: { y: 810 }, contentSize: { height: 1_400 }, layoutMeasurement: { height: 500 } })).toBe(true);
    expect(isNearConversationBottom({ contentOffset: { y: 700 }, contentSize: { height: 1_400 }, layoutMeasurement: { height: 500 } })).toBe(false);
    expect(isNearConversationBottom({ contentOffset: { y: 36 }, contentSize: { height: 1_400 }, layoutMeasurement: { height: 500 } }, 96, true)).toBe(true);
    expect(isNearConversationBottom({ contentOffset: { y: 180 }, contentSize: { height: 1_400 }, layoutMeasurement: { height: 500 } }, 96, true)).toBe(false);
  });

  it('formats premium day dividers and detects date boundaries', () => {
    const localTime = (day: number, hour: number) => new Date(2026, 6, day, hour).toISOString();
    const now = new Date(2026, 6, 21, 15);

    expect(formatConversationDay(localTime(21, 9), now)).toBe('Today');
    expect(formatConversationDay(localTime(20, 9), now)).toBe('Yesterday');
    expect(isDifferentConversationDay(localTime(21, 1), localTime(20, 23))).toBe(true);
    expect(isDifferentConversationDay(localTime(21, 3), localTime(21, 1))).toBe(false);
  });
});
