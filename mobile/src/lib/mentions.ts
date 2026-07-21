import type { UserSummary } from './types';

export type MentionTrigger = { start: number; end: number; query: string };

export function mentionTriggerAt(body: string, cursor: number): MentionTrigger | null {
  const beforeCursor = body.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|\s)@([^@\n]*)$/);
  if (!match) return null;
  const query = match[1];
  if (query.length > 60) return null;
  const start = cursor - query.length - 1;
  return { start, end: cursor, query };
}

export function mentionSuggestions(users: UserSummary[], query: string, limit = 6) {
  const normalized = query.trim().toLowerCase();
  return users
    .filter((user) => !normalized || `${user.full_name} ${user.email}`.toLowerCase().includes(normalized))
    .slice(0, limit);
}

export function insertMention(body: string, trigger: MentionTrigger, user: UserSummary) {
  const value = `${body.slice(0, trigger.start)}@${user.full_name} ${body.slice(trigger.end)}`;
  return { value, cursor: trigger.start + user.full_name.length + 2 };
}

export function resolveMentionUserIds(body: string, users: UserSummary[]) {
  const names = users
    .map((user) => user.full_name)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  if (!names.length) return [];

  const pattern = new RegExp(`(?:^|[\\s([{])@(${names.join('|')})(?![\\p{L}\\p{N}_’'-])`, 'giu');
  const mentionedNames = new Set([...body.matchAll(pattern)].map((match) => match[1].toLowerCase()));
  return users.filter((user) => mentionedNames.has(user.full_name.toLowerCase())).map((user) => user.id);
}

export function messageSegments(body: string, users: UserSummary[]) {
  const names = users
    .map((user) => user.full_name)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  if (!names.length) return [{ text: body, mention: false }];
  const pattern = new RegExp(`(@(?:${names.join('|')})(?![\\p{L}\\p{N}_’'-]))`, 'giu');
  return body.split(pattern).filter(Boolean).map((text) => ({ text, mention: text.startsWith('@') }));
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
