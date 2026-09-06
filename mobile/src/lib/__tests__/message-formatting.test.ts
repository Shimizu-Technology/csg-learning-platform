import { applyMessageFormat, applyMessageLink, messageFormatIsActive } from '../message-formatting';

describe('mobile message formatting', () => {
  it('wraps a selection and toggles it back off', () => {
    const formatted = applyMessageFormat('hello world', { start: 6, end: 11 }, 'bold');
    expect(formatted).toEqual({ value: 'hello **world**', selection: { start: 8, end: 13 } });
    expect(messageFormatIsActive(formatted.value, formatted.selection, 'bold')).toBe(true);
    expect(applyMessageFormat(formatted.value, formatted.selection, 'bold')).toEqual({ value: 'hello world', selection: { start: 6, end: 11 } });
  });

  it('inserts paired inline marks at a collapsed cursor', () => {
    expect(applyMessageFormat('hello ', { start: 6, end: 6 }, 'italic')).toEqual({
      value: 'hello __',
      selection: { start: 7, end: 7 },
    });
  });

  it('starts a list exactly where a cursor sits inside existing text', () => {
    expect(applyMessageFormat('first itemsecond item', { start: 10, end: 10 }, 'bulletList')).toEqual({
      value: 'first item\n- second item',
      selection: { start: 13, end: 13 },
    });
  });

  it('formats only the selected lines and creates ordered numbering', () => {
    expect(applyMessageFormat('before\none\ntwo\nafter', { start: 7, end: 14 }, 'orderedList')).toEqual({
      value: 'before\n1. one\n2. two\nafter',
      selection: { start: 7, end: 20 },
    });
  });

  it('changes one list kind to another without nesting prefixes', () => {
    expect(applyMessageFormat('- one\n- two', { start: 0, end: 11 }, 'orderedList').value).toBe('1. one\n2. two');
  });

  it('toggles quote prefixes across selected lines', () => {
    const quoted = applyMessageFormat('one\ntwo', { start: 0, end: 7 }, 'quote');
    expect(quoted.value).toBe('> one\n> two');
    expect(applyMessageFormat(quoted.value, quoted.selection, 'quote').value).toBe('one\ntwo');
  });

  it('wraps the current line in a code block', () => {
    expect(applyMessageFormat('const answer = 42;', { start: 6, end: 6 }, 'codeBlock')).toEqual({
      value: '```\nconst answer = 42;\n```',
      selection: { start: 4, end: 22 },
    });
  });

  it('creates a link from selected text and keeps the label selected', () => {
    expect(applyMessageLink('Read docs', { start: 5, end: 9 }, 'https://example.com')).toEqual({
      value: 'Read [docs](https://example.com)',
      selection: { start: 6, end: 10 },
    });
  });

  it('inserts mention activation at the cursor', () => {
    expect(applyMessageFormat('Hello ', { start: 6, end: 6 }, 'mention')).toEqual({
      value: 'Hello @',
      selection: { start: 7, end: 7 },
    });
  });
});
