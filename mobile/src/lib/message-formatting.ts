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

function enclosingInlineWrapper(value: string, selection: ComposerSelection, wrapper: string) {
  const range = clampSelection(value, selection);
  const occurrences: number[] = [];
  let searchFrom = 0;

  while (searchFrom <= value.length - wrapper.length) {
    const index = value.indexOf(wrapper, searchFrom);
    if (index === -1) break;
    occurrences.push(index);
    searchFrom = index + wrapper.length;
  }

  for (let pair = Math.floor(occurrences.length / 2) - 1; pair >= 0; pair -= 1) {
    const open = occurrences[pair * 2];
    const close = occurrences[(pair * 2) + 1];
    if (open + wrapper.length <= range.start && range.end <= close) return { open, close };
  }

  return null;
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

  const enclosing = enclosingInlineWrapper(value, range, wrapper);
  if (enclosing) {
    return {
      value: `${value.slice(0, enclosing.open)}${value.slice(enclosing.open + wrapper.length, enclosing.close)}${value.slice(enclosing.close + wrapper.length)}`,
      selection: { start: range.start - wrapper.length, end: range.end - wrapper.length },
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
  const pattern = action === 'orderedList' ? /^\d+\.\s/ : action === 'bulletList' ? /^[-*+]\s/ : /^>\s?/;
  const nonBlankLines = lines.filter((line) => line.trim());
  const remove = nonBlankLines.length > 0 && nonBlankLines.every((line) => pattern.test(line.trimStart()));
  const collapsedBlankTarget = range.start === range.end && lines.length === 1 && !lines[0].trim();
  const orderedByIndent = new Map<string, number>();
  const transformed = lines.map((line) => {
    const indentation = line.match(/^\s*/)?.[0] || '';
    if (!line.trim()) {
      if (!collapsedBlankTarget) return line;
      if (action === 'orderedList') return `${indentation}1. `;
      if (action === 'bulletList') return `${indentation}- `;
      return `${indentation}> `;
    }
    const content = line.slice(indentation.length);
    if (remove) return `${indentation}${content.replace(pattern, '')}`;
    const withoutOtherList = action === 'orderedList' || action === 'bulletList'
      ? content.replace(/^(?:\d+\.|[-*+])\s/, '')
      : content;
    if (action === 'orderedList') {
      const ordered = (orderedByIndent.get(indentation) || 0) + 1;
      orderedByIndent.set(indentation, ordered);
      return `${indentation}${ordered}. ${withoutOtherList}`;
    }
    if (action === 'bulletList') return `${indentation}- ${withoutOtherList}`;
    return `${indentation}> ${content}`;
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
    const selected = value.slice(range.start, range.end);
    return (value.slice(0, range.start).endsWith(wrapper) && value.slice(range.end).startsWith(wrapper))
      || (selected.length >= wrapper.length * 2 && selected.startsWith(wrapper) && selected.endsWith(wrapper))
      || enclosingInlineWrapper(value, range, wrapper) !== null;
  }
  const { start, end } = selectedLineBounds(value, range);
  const lines = value.slice(start, end).split('\n').filter((line) => line.trim());
  if (!lines.length) return false;
  if (action === 'orderedList') return lines.every((line) => /^\s*\d+\.\s/.test(line));
  if (action === 'bulletList') return lines.every((line) => /^\s*[-*+]\s/.test(line));
  if (action === 'quote') return lines.every((line) => /^\s*>\s?/.test(line));
  return value.slice(0, start).endsWith('```\n') && value.slice(end).startsWith('\n```');
}
