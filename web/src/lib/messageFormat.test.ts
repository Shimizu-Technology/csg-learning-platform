import { describe, expect, it } from 'vitest'
import { editorJsonToMarkdown, normalizeMessageMarkdown, parseMessageBlocks } from './messageFormat'

describe('parseMessageBlocks', () => {
  it('groups bulleted and numbered lines into semantic list blocks', () => {
    expect(parseMessageBlocks('- First item\n- Second item\n\n1. One\n2. Two')).toEqual([
      { type: 'bulletList', items: ['First item', 'Second item'] },
      { type: 'spacer' },
      { type: 'orderedList', items: ['One', 'Two'] },
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
