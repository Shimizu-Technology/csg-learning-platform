import { typingIndicatorLabel } from '../typing';

const user = (id: number, full_name: string) => ({ id, full_name, avatar_url: null });

describe('typingIndicatorLabel', () => {
  it('summarizes one, two, and several people', () => {
    expect(typingIndicatorLabel([])).toBe('');
    expect(typingIndicatorLabel([user(1, 'Ada')])).toBe('Ada is typing…');
    expect(typingIndicatorLabel([user(1, 'Ada'), user(2, 'Grace')])).toBe('Ada and Grace are typing…');
    expect(typingIndicatorLabel([user(1, 'Ada'), user(2, 'Grace'), user(3, 'Linus')])).toBe('Ada, Grace, and 1 more are typing…');
  });
});
