import { parseMessageBlocks, parseInline, type InlineNode, type MessageBlock } from './markdown-core';
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
    .filter((user) => !normalized || user.full_name.toLowerCase().includes(normalized))
    .slice(0, limit);
}

export function insertMention(body: string, trigger: MentionTrigger, user: UserSummary) {
  const value = `${body.slice(0, trigger.start)}@${user.full_name} ${body.slice(trigger.end)}`;
  return { value, cursor: trigger.start + user.full_name.length + 2 };
}

export function resolveMentionUserIds(body: string, users: UserSummary[], selectedIds: number[] = []) {
  const names = users
    .map((user) => user.full_name)
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .map(escapeRegExp);
  if (!names.length) return [];

  const pattern = new RegExp(`(?:^|[\\s([{])@(${names.join('|')})(?![\\p{L}\\p{N}_’'-])`, 'giu');
  const mentionedNames = new Set([...mentionProse(body).join('\n').matchAll(pattern)].map((match) => match[1].toLowerCase()));
  return users.filter((user) => mentionedNames.has(user.full_name.toLowerCase()) && (selectedIds.includes(user.id) || users.filter((other) => other.full_name.toLowerCase() === user.full_name.toLowerCase()).length === 1)).map((user) => user.id);
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
/** Only prose can contain a mention; code spans and code blocks never notify. */
function mentionProse(body: string): string[] {
  const inline = (nodes: InlineNode[]): string => nodes.map((node) => node.type === 'code' ? '' : node.type === 'text' ? node.text : inline(node.children)).join('');
  const blocks = (items: MessageBlock[]): string[] => items.flatMap((block) => {
    if (block.type === 'code' || block.type === 'spacer') return [];
    if (block.type === 'bulletList' || block.type === 'orderedList') return block.items.flatMap((item) => [inline(parseInline(item.text)), ...blocks(item.children)]);
    return [inline(parseInline(block.text))];
  });
  return blocks(parseMessageBlocks(body));
}
