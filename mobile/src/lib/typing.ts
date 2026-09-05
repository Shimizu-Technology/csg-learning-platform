import type { MessageTypingEvent } from './types';

export type TypingUser = MessageTypingEvent['user'];

export function typingIndicatorLabel(users: TypingUser[]) {
  if (!users.length) return '';
  if (users.length === 1) return `${users[0].full_name} is typing…`;
  if (users.length === 2) return `${users[0].full_name} and ${users[1].full_name} are typing…`;
  return `${users[0].full_name}, ${users[1].full_name}, and ${users.length - 2} more are typing…`;
}
