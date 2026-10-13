/// <reference types="node" />
import { describe, it, expect } from 'vitest'
import ts from 'typescript'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { parseMessageBlocks as parseWebMessageBlocks, editorJsonToMarkdown, type MessageBlock } from './messageFormat'

// Compile the dependency-free native parser without resolving Expo's tsconfig:
// the frontend CI job installs web dependencies only.
const nativeSource = readFileSync(new URL('../../../mobile/src/lib/message-format.ts', import.meta.url), 'utf8')
const nativeExports: { parseMessageBlocks?: (body: string) => MessageBlock[] } = {}
runInNewContext(ts.transpileModule(nativeSource, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports: nativeExports })
const parseMessageBlocks = nativeExports.parseMessageBlocks!

describe('web/native list compatibility', () => {
  const fixtures = [
    '- Parent\n\n  - Child\n\n    continuation\n- Sibling',
    '1. One\n  - a\n  - b\n  - c\n2. Two\n3. Three',
    '- Parent\n  1. Ordered\n    - Deep\n  - Mixed\n- Sibling',
    '- Parent\n  before\n  - Child\n  after\n  > quote\n  > continued\n- Sibling',
    '- Parent\n\t- Tab child\n\t\t- Deep tab\n- Sibling',
    '- First\n\n- Separate\n\n> Quote\n\n```js\n- not a list\n```',
  ];
  it.each(fixtures)('preserves the web block tree for %s', (body) => {
    expect(parseMessageBlocks(body)).toEqual(parseWebMessageBlocks(body));
  });
  it('keeps a child nested after an unindented blank line', () => {
    const body = '- Parent\n\n  - Child'
    const expected = [{ type: 'bulletList', items: [
      { text: 'Parent', children: [{ type: 'bulletList', items: [{ text: 'Child', children: [] }] }] },
    ] }]
    expect(parseMessageBlocks(body)).toEqual(expected)
    expect(parseWebMessageBlocks(body)).toEqual(expected)
  })
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
