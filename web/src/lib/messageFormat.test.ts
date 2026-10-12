import { describe, expect, it } from 'vitest'
import { editorJsonToMarkdown, normalizeMessageMarkdown, parseMessageBlocks } from './messageFormat'

describe('parseMessageBlocks', () => {
  it('groups bulleted and numbered lines into semantic list blocks', () => {
    expect(parseMessageBlocks('- First item\n- Second item\n\n1. One\n2. Two')).toEqual([
      { type: 'bulletList', items: [{ text: 'First item', children: [] }, { text: 'Second item', children: [] }] },
      { type: 'spacer' },
      { type: 'orderedList', items: [{ text: 'One', children: [] }, { text: 'Two', children: [] }] },
    ])
  })

  it('keeps paragraphs, quotes, and fenced code as separate blocks', () => {
    expect(parseMessageBlocks('Intro\n\n> A useful note\n\n```ts\nconst ready = true\n```')).toEqual([
      { type: 'paragraph', text: 'Intro' },
      { type: 'spacer' },
      { type: 'blockquote', text: 'A useful note' },
      { type: 'code', language: 'ts', code: 'const ready = true' },
    ])
  })

  it('keeps nested bullets under their parent across siblings and mixed list types', () => {
    const body = '- 1\n  - a\n  - b\n    1. deep\n  - c\n- 2\n  1. first\n  2. second\n- 3'
    expect(parseMessageBlocks(body)).toEqual([{
      type: 'bulletList',
      items: [
        { text: '1', children: [{ type: 'bulletList', items: [
          { text: 'a', children: [] },
          { text: 'b', children: [{ type: 'orderedList', items: [{ text: 'deep', children: [] }] }] },
          { text: 'c', children: [] },
        ] }] },
        { text: '2', children: [{ type: 'orderedList', items: [
          { text: 'first', children: [] }, { text: 'second', children: [] },
        ] }] },
        { text: '3', children: [] },
      ],
    }])
  })

  it('keeps mixed list types as siblings when indentation stays the same', () => {
    expect(parseMessageBlocks('1. One\n  - Child\n  1. Another child\n2. Two\n- A bullet')).toEqual([
      { type: 'orderedList', items: [
        { text: 'One', children: [
          { type: 'bulletList', items: [{ text: 'Child', children: [] }] },
          { type: 'orderedList', items: [{ text: 'Another child', children: [] }] },
        ] },
        { text: 'Two', children: [] },
      ] },
      { type: 'bulletList', items: [{ text: 'A bullet', children: [] }] },
    ])
  })

  it('supports indented and tab-indented messages, and keeps code fences literal', () => {
    expect(parseMessageBlocks('  - Parent\n\t- Child\n  - Sibling\n\n```md\n  - not a list\n```')).toEqual([
      { type: 'bulletList', items: [
        { text: 'Parent', children: [{ type: 'bulletList', items: [{ text: 'Child', children: [] }] }] },
        { text: 'Sibling', children: [] },
      ] },
      { type: 'code', language: 'md', code: '  - not a list' },
    ])
  })

  it('does not interpret hyphens in normal sentences as list markers', () => {
    expect(parseMessageBlocks('A mobile-first message stays a paragraph.')).toEqual([
      { type: 'paragraph', text: 'A mobile-first message stays a paragraph.' },
    ])
  })
})

describe('editorJsonToMarkdown', () => {
  it('serializes TipTap bullet and ordered lists with the markers used by the message renderer', () => {
    expect(editorJsonToMarkdown({
      type: 'doc',
      content: [
        {
          type: 'bulletList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] },
          ],
        },
        {
          type: 'orderedList',
          content: [
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'One' }] }] },
            { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Two' }] }] },
          ],
        },
      ],
    })).toBe('- First\n- Second\n\n1. One\n2. Two')
  })

  it('omits empty list items and renumbers the remaining ordered items', () => {
    expect(editorJsonToMarkdown({
      type: 'orderedList',
      content: [
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First' }] }] },
        { type: 'listItem', content: [{ type: 'paragraph' }] },
        { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Second' }] }] },
      ],
    })).toBe('1. First\n2. Second')
  })

  it('round-trips the composer’s nested bullets through the sent-message parser', () => {
    const body = editorJsonToMarkdown({ type: 'bulletList', content: [
      { type: 'listItem', content: [
        { type: 'paragraph', content: [{ type: 'text', text: '1' }] },
        { type: 'bulletList', content: ['a', 'b', 'c'].map((text) => ({
          type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
        })) },
      ] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '2' }] }] },
      { type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: '3' }] }] },
    ] })
    expect(body).toBe('- 1\n  - a\n  - b\n  - c\n- 2\n- 3')
    expect(parseMessageBlocks(normalizeMessageMarkdown(body))).toEqual([{
      type: 'bulletList', items: [
        { text: '1', children: [{ type: 'bulletList', items: ['a', 'b', 'c'].map((text) => ({ text, children: [] })) }] },
        { text: '2', children: [] }, { text: '3', children: [] },
      ],
    }])
  })

  it('preserves every inline format supported by the composer', () => {
    expect(editorJsonToMarkdown({
      type: 'paragraph',
      content: [
        { type: 'text', text: 'bold', marks: [{ type: 'bold' }] },
        { type: 'text', text: ' italic', marks: [{ type: 'italic' }] },
        { type: 'text', text: ' underline', marks: [{ type: 'underline' }] },
        { type: 'text', text: ' strike', marks: [{ type: 'strike' }] },
        { type: 'text', text: ' code', marks: [{ type: 'code' }] },
        { type: 'text', text: ' link', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] },
      ],
    })).toBe('**bold**_ italic_++ underline++~~ strike~~` code`[ link](https://example.com)')
  })

  it('serializes quotes, fenced code, hard breaks, and nested lists without dropping content', () => {
    expect(editorJsonToMarkdown({
      type: 'doc',
      content: [
        { type: 'blockquote', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Note' }, { type: 'hardBreak' }, { type: 'text', text: 'More' }] }] },
        { type: 'codeBlock', content: [{ type: 'text', text: 'const ready = true' }] },
        {
          type: 'bulletList',
          content: [{
            type: 'listItem',
            content: [
              { type: 'paragraph', content: [{ type: 'text', text: 'Parent' }] },
              { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Child' }] }] }] },
            ],
          }],
        },
      ],
    })).toBe('> Note\n> More\n\n```\nconst ready = true\n```\n\n- Parent\n  - Child')
  })
})

describe('normalizeMessageMarkdown', () => {
  it('removes empty bullet and ordered markers without touching real content', () => {
    expect(normalizeMessageMarkdown('1. First\n2. Second\n3.\n\n- One\n- Two\n-')).toBe(
      '1. First\n2. Second\n\n- One\n- Two',
    )
  })

  it('preserves marker-only lines inside fenced code blocks', () => {
    expect(normalizeMessageMarkdown('Before\n\n```text\n-\n1.\n```\n\n-')).toBe(
      'Before\n\n```text\n-\n1.\n```',
    )
  })
})
