export type ComposerSelection = { start: number; end: number };

export type MessageFormatAction =
  | 'bold'
  | 'italic'
  | 'underline'
  | 'strike'
  | 'link'
  | 'orderedList'
  | 'bulletList'
  | 'quote'
  | 'inlineCode'
  | 'codeBlock'
  | 'mention';

export type MessageFormatResult = { value: string; selection: ComposerSelection };

const INLINE_WRAPPERS: Partial<Record<MessageFormatAction, string>> = {
  bold: '**',
  italic: '_',
  underline: '++',
  strike: '~~',
  inlineCode: '`',
};

function clampSelection(value: string, selection: ComposerSelection): ComposerSelection {
  const start = Math.max(0, Math.min(selection.start, selection.end, value.length));
  const end = Math.max(start, Math.min(Math.max(selection.start, selection.end), value.length));
  return { start, end };
}

function inlineFormat(value: string, selection: ComposerSelection, wrapper: string): MessageFormatResult {
  const range = clampSelection(value, selection);
  const before = value.slice(0, range.start);
  const selected = value.slice(range.start, range.end);
  const after = value.slice(range.end);

  if (before.endsWith(wrapper) && after.startsWith(wrapper)) {
    const start = range.start - wrapper.length;
    return {
      value: `${before.slice(0, -wrapper.length)}${selected}${after.slice(wrapper.length)}`,
      selection: { start, end: range.end - wrapper.length },
    };
  }

  if (selected.startsWith(wrapper) && selected.endsWith(wrapper) && selected.length >= wrapper.length * 2) {
    const unwrapped = selected.slice(wrapper.length, -wrapper.length);
    return {
      value: `${before}${unwrapped}${after}`,
      selection: { start: range.start, end: range.start + unwrapped.length },
    };
  }

  const nextValue = `${before}${wrapper}${selected}${wrapper}${after}`;
  if (range.start === range.end) {
    const cursor = range.start + wrapper.length;
    return { value: nextValue, selection: { start: cursor, end: cursor } };
  }
  return {
    value: nextValue,
    selection: { start: range.start + wrapper.length, end: range.end + wrapper.length },
  };
}

function selectedLineBounds(value: string, selection: ComposerSelection) {
  const range = clampSelection(value, selection);
  const start = value.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1;
  const endAnchor = range.end > range.start && value[range.end - 1] === '\n' ? range.end - 1 : range.end;
  const nextBreak = value.indexOf('\n', endAnchor);
  return { range, start, end: nextBreak === -1 ? value.length : nextBreak };
}

function splitAtCollapsedCursor(value: string, selection: ComposerSelection) {
  const range = clampSelection(value, selection);
  if (range.start !== range.end) return { value, selection: range };
  const lineStart = value.lastIndexOf('\n', Math.max(0, range.start - 1)) + 1;
  if (range.start === lineStart) return { value, selection: range };
  const nextValue = `${value.slice(0, range.start)}\n${value.slice(range.start)}`;
  const cursor = range.start + 1;
  return { value: nextValue, selection: { start: cursor, end: cursor } };
}

function lineFormat(value: string, selection: ComposerSelection, action: 'orderedList' | 'bulletList' | 'quote'): MessageFormatResult {
  const split = splitAtCollapsedCursor(value, selection);
  const { range, start, end } = selectedLineBounds(split.value, split.selection);
  const segment = split.value.slice(start, end);
  const lines = segment.split('\n');
  const pattern = action === 'orderedList' ? /^\s*\d+\.\s/ : action === 'bulletList' ? /^\s*[-*+]\s/ : /^\s*>\s?/;
  const nonBlankLines = lines.filter((line) => line.trim());
  const remove = nonBlankLines.length > 0 && nonBlankLines.every((line) => pattern.test(line));
  let ordered = 0;
  const transformed = lines.map((line) => {
    if (!line.trim()) return line;
    if (remove) return line.replace(pattern, '');
    const withoutOtherList = action === 'orderedList' || action === 'bulletList'
      ? line.replace(/^\s*(?:\d+\.|[-*+])\s/, '')
      : line;
    if (action === 'orderedList') return `${++ordered}. ${withoutOtherList}`;
    if (action === 'bulletList') return `- ${withoutOtherList}`;
    return `> ${line}`;
  }).join('\n');
  const nextValue = `${split.value.slice(0, start)}${transformed}${split.value.slice(end)}`;

  if (range.start === range.end) {
    const firstLine = lines[0] || '';
    const firstTransformed = transformed.split('\n')[0] || '';
    const delta = firstTransformed.length - firstLine.length;
    const cursor = Math.max(start, range.start + delta);
    return { value: nextValue, selection: { start: cursor, end: cursor } };
  }

  return { value: nextValue, selection: { start, end: start + transformed.length } };
}

function codeBlockFormat(value: string, selection: ComposerSelection): MessageFormatResult {
  const { range, start, end } = selectedLineBounds(value, selection);
  const selected = value.slice(start, end);
  const before = value.slice(0, start);
  const after = value.slice(end);
  const alreadyWrapped = before.endsWith('```\n') && after.startsWith('\n```');
  if (alreadyWrapped) {
    const nextStart = start - 4;
    return {
      value: `${before.slice(0, -4)}${selected}${after.slice(4)}`,
      selection: { start: nextStart, end: nextStart + selected.length },
    };
  }
  if (range.start === range.end && !selected) {
    const nextValue = `${before}\`\`\`\n\n\`\`\`${after}`;
    const cursor = start + 4;
    return { value: nextValue, selection: { start: cursor, end: cursor } };
  }
  const nextValue = `${before}\`\`\`\n${selected}\n\`\`\`${after}`;
  return { value: nextValue, selection: { start: start + 4, end: start + 4 + selected.length } };
}

export function applyMessageLink(value: string, selection: ComposerSelection, url: string): MessageFormatResult {
  const range = clampSelection(value, selection);
  const href = url.trim();
  const label = value.slice(range.start, range.end) || 'link text';
  const inserted = `[${label}](${href})`;
  const nextValue = `${value.slice(0, range.start)}${inserted}${value.slice(range.end)}`;
  if (range.start === range.end) {
    return { value: nextValue, selection: { start: range.start + 1, end: range.start + 1 + label.length } };
  }
  return { value: nextValue, selection: { start: range.start + 1, end: range.start + 1 + label.length } };
}

export function applyMessageFormat(value: string, selection: ComposerSelection, action: Exclude<MessageFormatAction, 'link'>): MessageFormatResult {
  const wrapper = INLINE_WRAPPERS[action];
  if (wrapper) return inlineFormat(value, selection, wrapper);
  if (action === 'orderedList' || action === 'bulletList' || action === 'quote') return lineFormat(value, selection, action);
  if (action === 'codeBlock') return codeBlockFormat(value, selection);

  const range = clampSelection(value, selection);
  const nextValue = `${value.slice(0, range.start)}@${value.slice(range.end)}`;
  const cursor = range.start + 1;
  return { value: nextValue, selection: { start: cursor, end: cursor } };
}

export function messageFormatIsActive(value: string, selection: ComposerSelection, action: Exclude<MessageFormatAction, 'link' | 'mention'>) {
  const range = clampSelection(value, selection);
  const wrapper = INLINE_WRAPPERS[action];
  if (wrapper) {
    return value.slice(0, range.start).endsWith(wrapper) && value.slice(range.end).startsWith(wrapper)
      || value.slice(range.start, range.end).startsWith(wrapper) && value.slice(range.start, range.end).endsWith(wrapper);
  }
  const { start, end } = selectedLineBounds(value, range);
  const lines = value.slice(start, end).split('\n').filter((line) => line.trim());
  if (!lines.length) return false;
  if (action === 'orderedList') return lines.every((line) => /^\s*\d+\.\s/.test(line));
  if (action === 'bulletList') return lines.every((line) => /^\s*[-*+]\s/.test(line));
  if (action === 'quote') return lines.every((line) => /^\s*>\s?/.test(line));
  return value.slice(0, start).endsWith('```\n') && value.slice(end).startsWith('\n```');
}
