import { messagePreview } from './message-format';
import type { ChannelSummary, DirectConversationSummary, UserSummary } from './types';

function isInsideMarkdownOrListFence(value: string, cursor: number): boolean {
  const beforeCursor = value.slice(0, Math.max(0, cursor));
  const allLines = beforeCursor.split('\n');
  const priorLines = allLines.slice(0, -1);
  const currentLine = allLines[allLines.length - 1] ?? '';
  let open: { fence: string; minIndent: number } | null = null;

  const tryOpenFence = (line: string): { fence: string; minIndent: number } | null => {
    const listMatch = /^([ \t]*(?:[-*+]|\d+[.)])[ \t]+)(`{3,}|~{3,})(.*)$/.exec(line);
    if (listMatch) {
      if (listMatch[2][0] === '`' && listMatch[3].includes('`')) return null;
      return { fence: listMatch[2], minIndent: advanceVisualColumns(listMatch[1]) };
    }
    const plainMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (plainMatch) {
      if (plainMatch[1][0] === '`' && plainMatch[2].includes('`')) return null;
      return { fence: plainMatch[1], minIndent: 0 };
    }
    return null;
  };

  for (const line of priorLines) {
    if (open !== null) {
      if (open.minIndent > 0 && line.trim().length > 0) {
        const leadingIndent = advanceVisualColumns(/^[ \t]*/.exec(line)?.[0] ?? '');
        if (leadingIndent < open.minIndent) {
          open = tryOpenFence(line);
          continue;
        }
      }
      const closeMatch = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line);
      if (
        closeMatch
        && closeMatch[1][0] === open.fence[0]
        && closeMatch[1].length >= open.fence.length
        && closeMatch[2].trim() === ''
      ) {
        open = null;
      }
      continue;
    }
    open = tryOpenFence(line);
  }

  if (open !== null && open.minIndent > 0 && currentLine.trim().length > 0) {
    const currentIndent = advanceVisualColumns(/^[ \t]*/.exec(currentLine)?.[0] ?? '');
    if (currentIndent < open.minIndent) return false;
  }

  return open !== null;
}

export const ONLINE_WINDOW_MS = 2 * 60 * 1000;
export const PRESENCE_TICK_MS = 30 * 1000;

export function isRecentlyOnline(lastSeenAt: string | null | undefined, now = Date.now()): boolean {
  if (!lastSeenAt) return false;
  const parsed = Date.parse(lastSeenAt);
  return Number.isFinite(parsed) && now - parsed < ONLINE_WINDOW_MS;
}

/** The other participant in a 1:1 direct message, or null for group direct messages. */
export function directConversationPeer(
  conversation: Pick<DirectConversationSummary, 'users'> | null | undefined,
  currentUserId?: number | null,
): UserSummary | null {
  if (!conversation?.users?.length) return null;
  const others = currentUserId
    ? conversation.users.filter((member) => member.id !== currentUserId)
    : conversation.users;
  return others.length === 1 ? others[0] : null;
}

export function isDirectOneToOne(
  kind: 'channel' | 'dm',
  item: ChannelSummary | DirectConversationSummary,
  currentUserId?: number | null,
): boolean {
  return kind === 'dm' && directConversationPeer(item as DirectConversationSummary, currentUserId) !== null;
}

export function isGroupConversation(
  kind: 'channel' | 'dm',
  item: ChannelSummary | DirectConversationSummary,
  currentUserId?: number | null,
): boolean {
  return kind === 'channel' || !isDirectOneToOne(kind, item, currentUserId);
}

/** One-line inbox subtitle using strict author_id attribution for "You: ". */
export function conversationSubtitle(
  kind: 'channel' | 'dm',
  item: ChannelSummary | DirectConversationSummary,
  currentUserId?: number | null,
): string {
  const latest = item.latest_message;
  if (!latest) {
    return kind === 'channel' ? ((item as ChannelSummary).description || 'No messages yet') : 'No messages yet';
  }
  const peer = kind === 'dm' ? directConversationPeer(item as DirectConversationSummary, currentUserId) : null;
  const isOwnLatest = currentUserId != null && latest.author_id === currentUserId;
  const prefix = isOwnLatest
    ? 'You: '
    : kind === 'channel' || !peer
      ? `${latest.author_name}: `
      : '';
  return `${prefix}${messagePreview(latest.body)}`;
}

function advanceVisualColumns(text: string, startColumn = 0): number {
  let column = startColumn;
  for (const ch of text) {
    column = ch === '\t' ? column + (4 - (column % 4)) : column + 1;
  }
  return column;
}

/**
 * Native TextInput Markdown list Enter continuation.
 * Triggers only when a single `\n` was just inserted on a non-fenced list line.
 * Pass the pre-edit `selection` when available so insertion before an existing newline
 * (e.g. `"- item\nnext"` with caret after `item`) is resolved unambiguously.
 */
export function applyMarkdownListEnter(
  prevValue: string,
  nextValue: string,
  selection?: { start: number; end: number },
): { value: string; cursor: number } | null {
  let start = -1;
  let end = -1;

  if (selection) {
    const selStart = Math.max(0, Math.min(selection.start, selection.end, prevValue.length));
    const selEnd = Math.max(selStart, Math.min(Math.max(selection.start, selection.end), prevValue.length));
    if (nextValue === `${prevValue.slice(0, selStart)}\n${prevValue.slice(selEnd)}`) {
      start = selStart;
      end = selEnd;
    }
  }

  if (start === -1) {
    if (nextValue.length !== prevValue.length + 1) return null;
    let diffIndex = 0;
    while (diffIndex < prevValue.length && prevValue[diffIndex] === nextValue[diffIndex]) {
      diffIndex += 1;
    }
    if (nextValue[diffIndex] !== '\n') return null;
    if (prevValue.slice(diffIndex) !== nextValue.slice(diffIndex + 1)) return null;
    start = diffIndex;
    end = diffIndex;
  }

  const lineStart = prevValue.lastIndexOf('\n', start - 1) + 1;
  const beforeCaret = prevValue.slice(lineStart, start);
  const afterCaret = prevValue.slice(end);

  // Never rewrite inside an already-open fenced code block (including list-item fences).
  if (isInsideMarkdownOrListFence(prevValue, start)) return null;

  // Unordered or ordered list marker at start of line.
  const match = /^([ \t]*)([-*+]|(\d+)([.)]))([ \t]+)(.*)$/.exec(beforeCaret);
  if (!match) return null;

  const [, indent, marker, digits, delim, gap, content] = match;

  // Line opened a code fence inside a list item (e.g. `- ```js` or `01. ```js`):
  // indent next line to CommonMark content column instead of adding a new list marker.
  if (/^(`{3,}|~{3,})/.test(content)) {
    const contentColumn = advanceVisualColumns(`${indent}${marker}${gap}`);
    const padding = ' '.repeat(contentColumn);
    const value = `${prevValue.slice(0, start)}\n${padding}${afterCaret}`;
    return { value, cursor: start + 1 + padding.length };
  }

  // Empty list item (pressing Enter on `- ` or `1. `): clear the marker to exit the list.
  // For a noninitial empty item, retain a blank line so subsequent text starts outside the list.
  if (!content.trim() && (afterCaret.length === 0 || afterCaret.startsWith('\n'))) {
    if (lineStart > 0) {
      const value = `${prevValue.slice(0, lineStart)}\n${afterCaret}`;
      return { value, cursor: lineStart + 1 };
    }
    const value = `${prevValue.slice(0, lineStart)}${afterCaret}`;
    return { value, cursor: lineStart };
  }

  const nextMarker = digits ? `${Number(digits) + 1}${delim}` : marker;
  const insertion = `\n${indent}${nextMarker} `;
  const value = `${prevValue.slice(0, start)}${insertion}${afterCaret}`;
  return { value, cursor: start + insertion.length };
}
