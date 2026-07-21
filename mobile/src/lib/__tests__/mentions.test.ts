import { insertMention, mentionSuggestions, mentionTriggerAt, messageSegments, resolveMentionUserIds } from '../mentions';
import type { UserSummary } from '../types';

const users: UserSummary[] = [
  { id: 1, full_name: 'Maya Santos', email: 'maya@example.com', role: 'student', avatar_url: null, is_admin: false, is_staff: false },
  { id: 2, full_name: 'Noah Cruz', email: 'noah@example.com', role: 'student', avatar_url: null, is_admin: false, is_staff: false },
];

describe('mentions', () => {
  it('detects and inserts a mention at the cursor', () => {
    const trigger = mentionTriggerAt('Please ask @may', 15)!;
    expect(trigger.query).toBe('may');
    expect(insertMention('Please ask @may', trigger, users[0])).toEqual({ value: 'Please ask @Maya Santos ', cursor: 24 });
  });

  it('filters suggestions and resolves IDs from the final body', () => {
    expect(mentionSuggestions(users, 'no')).toEqual([users[1]]);
    expect(resolveMentionUserIds('@Maya Santos please pair with @Noah Cruz', users)).toEqual([1, 2]);
  });

  it('segments known mentions for highlighted rendering', () => {
    expect(messageSegments('Thanks @Maya Santos!', users)).toEqual([
      { text: 'Thanks ', mention: false },
      { text: '@Maya Santos', mention: true },
      { text: '!', mention: false },
    ]);
  });
});
