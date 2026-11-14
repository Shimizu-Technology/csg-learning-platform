import { applyMessageFormat, messageFormatIsActive } from '../message-formatting';

it('inserts the same selected placeholder as web Markdown mode', () => {
  expect(applyMessageFormat('hello ', { start: 6, end: 6 }, 'italic')).toEqual({ value: 'hello _italic text_', selection: { start: 7, end: 18 } });
});
it('uses a longer fence for backticks in inline code and blocks', () => {
  expect(applyMessageFormat('a `b`', { start: 0, end: 5 }, 'inlineCode').value).toBe('`` a `b` ``');
  expect(applyMessageFormat('a ``` b', { start: 0, end: 7 }, 'codeBlock').value).toBe('````\na ``` b\n````');
});
it('prefixes the current line rather than splitting at the caret', () => {
  expect(applyMessageFormat('hello world', { start: 5, end: 5 }, 'bulletList').value).toBe('- hello world');
});

describe("formatting state", () => {
  it.each([
    ['_', 'italic'],
    ['`', 'inlineCode'],
    ['~~', 'strike'],
    ['++', 'underline'],
  ] as const)('does not treat a literal %s delimiter as active %s formatting', (value, action) => {
    expect(messageFormatIsActive(value, { start: 0, end: value.length }, action)).toBe(false);
  });

  it('recognizes complete selected inline wrappers', () => {
    expect(messageFormatIsActive('~~done~~', { start: 0, end: 8 }, 'strike')).toBe(true);
  });

  it('does not treat text between separate wrappers as active', () => {
    expect(messageFormatIsActive('**one** gap **two**', { start: 9, end: 9 }, 'bold')).toBe(false);
  });
});
