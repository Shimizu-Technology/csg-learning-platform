import { describe, expect, it } from 'vitest'
import { parseMessageBlocks } from './messageFormat'

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
