import { describe, it, expect } from 'vitest'
import { parseMessageBlocks } from '../../../mobile/src/lib/message-format'
import { parseMessageBlocks as parseWebMessageBlocks, editorJsonToMarkdown } from './messageFormat'

describe('web/native list compatibility', () => {
  const fixtures = [
    '1. One\n  - a\n  - b\n  - c\n2. Two\n3. Three',
    '- Parent\n  1. Ordered\n    - Deep\n  - Mixed\n- Sibling',
    '- Parent\n  before\n  - Child\n  after\n  > quote\n  > continued\n- Sibling',
    '- Parent\n\t- Tab child\n\t\t- Deep tab\n- Sibling',
    '- First\n\n- Separate\n\n> Quote\n\n```js\n- not a list\n```',
  ];
  it.each(fixtures)('preserves the web block tree for %s', (body) => {
    expect(parseMessageBlocks(body)).toEqual(parseWebMessageBlocks(body));
  });
  it('preserves actual web editor multiline list serialization', () => {
    const text = (value: string) => ({ type: 'text', text: value });
    const paragraph = (value: string) => ({ type: 'paragraph', content: [text(value)] });
    const body = editorJsonToMarkdown({ type: 'doc', content: [{ type: 'orderedList', content: [
      { type: 'listItem', content: [
        { type: 'paragraph', content: [text('Parent'), { type: 'hardBreak' }, text('hard break')] },
        { type: 'bulletList', content: [{ type: 'listItem', content: [paragraph('Child')] }] },
        paragraph('after child'),
        { type: 'blockquote', content: [paragraph('quote')] },
      ] },
      { type: 'listItem', content: [paragraph('Sibling')] },
    ] }] });
    expect(parseMessageBlocks(body)).toEqual([{ type: 'orderedList', items: [
      { text: 'Parent', children: [
        { type: 'paragraph', text: 'hard break' },
        { type: 'bulletList', items: [{ text: 'Child', children: [] }] },
        { type: 'paragraph', text: 'after child' },
        { type: 'blockquote', text: 'quote' },
      ] },
      { text: 'Sibling', children: [] },
    ] }]);
  });
});
