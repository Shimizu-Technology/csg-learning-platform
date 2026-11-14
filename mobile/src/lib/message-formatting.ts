import { markdownSourceEdit, markdownSourceIsActive, type FormatAction } from './markdown-source';
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

export function applyMessageLink(value: string, selection: ComposerSelection, url: string): MessageFormatResult {
  return sourceFormat(value, selection, 'link', url);
}

function sourceFormat(value: string, selection: ComposerSelection, action: FormatAction, href = ''): MessageFormatResult {
  const range = clampSelection(value, selection);
  const edit = markdownSourceEdit(value, range.start, range.end, action, href);
  return { value: value.slice(0, edit.start) + edit.text + value.slice(edit.end), selection: { start: edit.selectionStart, end: edit.selectionEnd } };
}

export function applyMessageFormat(value: string, selection: ComposerSelection, action: Exclude<MessageFormatAction, 'link'>): MessageFormatResult {
  if (action === 'underline') return inlineFormat(value, selection, '++');
  if (action !== 'mention') return sourceFormat(value, selection, action === 'inlineCode' ? 'code' : action === 'quote' ? 'blockquote' : action);
  const range = clampSelection(value, selection);
  return { value: `${value.slice(0, range.start)}@${value.slice(range.end)}`, selection: { start: range.start + 1, end: range.start + 1 } };
}

export function messageFormatIsActive(value: string, selection: ComposerSelection, action: Exclude<MessageFormatAction, 'link' | 'mention'>) {
  const range = clampSelection(value, selection);
  if (action !== 'underline') return markdownSourceIsActive(value, range.start, range.end, action === 'inlineCode' ? 'code' : action === 'quote' ? 'blockquote' : action);
  return enclosingInlineWrapper(value, range, '++') !== null
    || (value.slice(range.start, range.end).startsWith('++') && value.slice(range.start, range.end).endsWith('++') && range.end - range.start >= 4);
}
