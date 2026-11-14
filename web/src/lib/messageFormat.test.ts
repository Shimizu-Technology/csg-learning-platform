import { describe, expect, it } from 'vitest'
import { editorJsonToMarkdown, inlinePlainText, normalizeMessageMarkdown, parseInline, parseMessageBlocks, trimBlankLines } from './messageFormat'

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

  it('expands tabs to four-column stops when spaces and tabs mix', () => {
    expect(parseMessageBlocks('- Parent\n  \t- A\n    - B\n- Next')).toEqual([{
      type: 'bulletList', items: [
        { text: 'Parent', children: [{ type: 'bulletList', items: [
          { text: 'A', children: [] }, { text: 'B', children: [] },
        ] }] },
        { text: 'Next', children: [] },
      ],
    }])
  })

  it('keeps continuation paragraphs on their parent before and after a nested list', () => {
    expect(parseMessageBlocks('1. Parent\n  Before children\n  - Child\n    Child continuation\n  After children\n2. Next')).toEqual([{
      type: 'orderedList', items: [
        { text: 'Parent', children: [
          { type: 'paragraph', text: 'Before children' },
          { type: 'bulletList', items: [{ text: 'Child', children: [{ type: 'paragraph', text: 'Child continuation' }] }] },
          { type: 'paragraph', text: 'After children' },
        ] },
        { text: 'Next', children: [] },
      ],
    }])
  })

  it('keeps repeated hard-break continuations inside a list while blank message separators close it', () => {
    expect(parseMessageBlocks('- Parent\n  First\n  \n  Second\n  - Child\n- Next\n\nOutside')).toEqual([
      { type: 'bulletList', items: [
        { text: 'Parent', children: [{ type: 'paragraph', text: 'First\n\nSecond' }, { type: 'bulletList', items: [{ text: 'Child', children: [] }] }] },
        { text: 'Next', children: [] },
      ] },
      { type: 'spacer' },
      { type: 'paragraph', text: 'Outside' },
    ])
  })

  it('keeps quoted continuations formatted inside their list item', () => {
    expect(parseMessageBlocks('1. Parent\n  > Quoted note\n  > Another line\n  - Child\n2. Next')).toEqual([{
      type: 'orderedList', items: [
        { text: 'Parent', children: [{ type: 'blockquote', text: 'Quoted note\nAnother line' }, { type: 'bulletList', items: [{ text: 'Child', children: [] }] }] },
        { text: 'Next', children: [] },
      ],
    }])
  })

  it('ends a list at an unindented paragraph rather than absorbing unrelated text', () => {
    expect(parseMessageBlocks('- First\nOutside the list\n- Second')).toEqual([
      { type: 'bulletList', items: [{ text: 'First', children: [] }] },
      { type: 'paragraph', text: 'Outside the list' },
      { type: 'bulletList', items: [{ text: 'Second', children: [] }] },
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

  it.each(['parent', 'child'])('round-trips a hard break in a %s list item without splitting the list', (target) => {
    const paragraph = (text: string, multiline = false) => ({ type: 'paragraph', content: [
      { type: 'text', text }, ...(multiline ? [{ type: 'hardBreak' }, { type: 'text', text: 'continued' }] : []),
    ] })
    const body = normalizeMessageMarkdown(editorJsonToMarkdown({ type: 'orderedList', content: [
      { type: 'listItem', content: [paragraph('Parent', target === 'parent'), { type: 'bulletList', content: [
        { type: 'listItem', content: [paragraph('a', target === 'child')] },
        { type: 'listItem', content: [paragraph('b')] },
      ] }] },
      { type: 'listItem', content: [paragraph('Next')] },
    ] }))
    expect(body).toBe(target === 'parent'
      ? '1. Parent\n   continued\n   - a\n   - b\n2. Next'
      : '1. Parent\n   - a\n     continued\n   - b\n2. Next')
    expect(parseMessageBlocks(body)).toEqual([{
      type: 'orderedList', items: [
        { text: 'Parent', children: [
          ...(target === 'parent' ? [{ type: 'paragraph', text: 'continued' }] : []),
          { type: 'bulletList', items: [
            { text: 'a', children: target === 'child' ? [{ type: 'paragraph', text: 'continued' }] : [] },
            { text: 'b', children: [] },
          ] },
        ] },
        { text: 'Next', children: [] },
      ],
    }])
  })

  it('preserves every inline format supported by the composer, with spaces outside the delimiters', () => {
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
    })).toBe('**bold** _italic_ ++underline++ ~~strike~~` code` [link](https://example.com)')
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

describe('trimBlankLines (review round 1)', () => {
  it('drops blank edge lines and keeps the first line indentation and last line spaces', () => {
    expect(trimBlankLines('\n  \n    indented code\n\n| a |  \n  \n')).toBe('    indented code\n\n| a |  ')
    expect(trimBlankLines(' \n\t\n ')).toBe('')
    expect(normalizeMessageMarkdown('    code first\n\nthen text\n\n')).toBe('    code first\n\nthen text')
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

describe('editorJsonToMarkdown escaping (M-1)', () => {
  const sent = (value: string) => editorJsonToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] })
  const literal = [
    '**not bold** and _not italic_ and `not code`',
    '- not a list',
    '1. not a numbered list',
    '2) nor this',
    '# not a heading',
    '> not a quote',
    '```js',
    '~~~',
    '---',
    '[not](a link) and [x]: https://example.com',
    'snake_case_name and __init__ and _private',
    'C++ and ++i and ~~gone~~ and a ~ b',
    'path C:\\Users\\alex and a trailing slash \\',
    '&amp; stays as typed',
    '2 * 3 * 4',
    '*',
    'https://example.com/a_b_c is a link',
  ]

  it.each(literal)('reads %s back exactly as typed', (value) => {
    const blocks = parseMessageBlocks(sent(value))
    expect(blocks).toHaveLength(1)
    expect(blocks[0].type).toBe('paragraph')
    const nodes = parseInline((blocks[0] as { text: string }).text)
    expect(inlinePlainText(nodes)).toBe(value)
    expect(nodes.every((node) => node.type === 'text' || node.type === 'link')).toBe(true)
  })

  it('leaves ordinary prose unescaped', () => {
    expect(sent('Use snake_case, C++ and 2 * 3 freely.')).toBe('Use snake_case, C++ and 2 * 3 freely.')
    expect(sent('Hi Alex, this looks great!')).toBe('Hi Alex, this looks great!')
  })

  it('escapes a * only where it could become formatting', () => {
    // Spaces on both sides: never emphasis, so math and prices stay as typed.
    expect(sent('2 * 3 = 6, a * b and $5 * 2 = $10')).toBe('2 * 3 = 6, a * b and $5 * 2 = $10')
    expect(sent('a ** b')).toBe('a ** b')
    // Touching a word, a * could open or close emphasis.
    expect(sent('*word* and **bold**')).toBe('\\*word\\* and \\*\\*bold\\*\\*')
    expect(sent('2*3*4')).toBe('2\\*3\\*4')
    expect(sent('footnote*')).toBe('footnote\\*')
    // A list marker at the start of a line is escaped as a marker.
    expect(sent('* not a list')).toBe('\\* not a list')
  })

  it.each(['2 * 3 = 6', 'a * b', '$5 * 2', '*word*', '2*3*4', 'x ** y **z**', '* item', 'end *'])('reads %s back as typed', (value) => {
    const nodes = parseInline((parseMessageBlocks(sent(value))[0] as { text: string }).text)
    expect(inlinePlainText(nodes)).toBe(value)
    expect(nodes.every((node) => node.type === 'text')).toBe(true)
  })

  it('uses longer backtick runs when code contains backticks', () => {
    const inline = editorJsonToMarkdown({ type: 'paragraph', content: [{ type: 'text', text: 'a`b', marks: [{ type: 'code' }] }, { type: 'text', text: ' and ' }, { type: 'text', text: '`tick`', marks: [{ type: 'code' }] }] })
    expect(inline).toBe('``a`b`` and `` `tick` ``')
    expect(parseInline(inline)).toEqual([{ type: 'code', text: 'a`b' }, { type: 'text', text: ' and ' }, { type: 'code', text: '`tick`' }])

    const block = editorJsonToMarkdown({ type: 'codeBlock', attrs: { language: 'md' }, content: [{ type: 'text', text: '```js\nx\n```' }] })
    expect(block).toBe('````md\n```js\nx\n```\n````')
    expect(parseMessageBlocks(block)).toEqual([{ type: 'code', language: 'md', code: '```js\nx\n```' }])
  })

  it('puts inline code innermost so bold and italic around code keep both marks', () => {
    expect(editorJsonToMarkdown({ type: 'paragraph', content: [
      { type: 'text', text: 'Run ' },
      { type: 'text', text: 'bin/rails db:migrate', marks: [{ type: 'code' }, { type: 'bold' }] },
      { type: 'text', text: ' then ' },
      { type: 'text', text: 'restart', marks: [{ type: 'italic' }, { type: 'code' }] },
    ] })).toBe('Run **`bin/rails db:migrate`** then _`restart`_')
  })

  it('switches italic to * inside a word and closes marks around a line break', () => {
    expect(editorJsonToMarkdown({ type: 'paragraph', content: [
      { type: 'text', text: 'un' }, { type: 'text', text: 'believ', marks: [{ type: 'italic' }] }, { type: 'text', text: 'able' },
    ] })).toBe('un*believ*able')
    const body = editorJsonToMarkdown({ type: 'paragraph', content: [
      { type: 'text', text: 'one', marks: [{ type: 'bold' }] }, { type: 'hardBreak' }, { type: 'text', text: '- two', marks: [{ type: 'bold' }] },
    ] })
    expect(body).toBe('**one**\n**- two**')
    expect(parseMessageBlocks(body)).toEqual([{ type: 'paragraph', text: '**one**\n**- two**' }])
  })

  it('serializes headings at the supported ## and ### levels', () => {
    expect(editorJsonToMarkdown({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Week 10' }] })).toBe('## Week 10')
    expect(editorJsonToMarkdown({ type: 'heading', attrs: { level: 3 }, content: [{ type: 'text', text: 'Tue' }] })).toBe('### Tue')
  })
})
