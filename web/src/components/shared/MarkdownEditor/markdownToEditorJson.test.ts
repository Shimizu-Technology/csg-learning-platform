// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { editorJsonToMarkdown } from '../../../lib/messageFormat'
import {
  lanceNov11Editor,
  lanceNov11Markdown,
  literalBackslashParagraphs,
  overlappingMarkParagraphs,
  realMessagePatterns,
  unflankedPunctuationParagraphs,
} from '../../../lib/markdownFixtures'
import { createRichExtensions } from './extensions'
import { lockedKinds, lockedWarning, looksLikeMarkdown, markdownToEditorDoc, sameMarkdownStructure, splitMarkdownChunks, type MarkdownTarget } from './markdownToEditorJson'

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** Loads JSON into the real Rich schema and reads it back, as switching modes does. */
function throughRichEditor(doc: JSONContent) {
  editor?.destroy()
  editor = new Editor({ extensions: createRichExtensions({ onLink: () => undefined, underlineShortcut: true }), content: doc })
  return editor.getJSON()
}

const markdownToRichToMarkdown = (markdown: string) => editorJsonToMarkdown(throughRichEditor(markdownToEditorDoc(markdown).doc))

/** Every construct in the supported syntax (design spec §9.3, docs/MARKDOWN.md), written the way the serializer writes it. */
const SUPPORTED = [
  'Plain paragraph',
  'Line one\nLine two',
  'First paragraph\n\nSecond paragraph',
  '**bold** and _italic_ and `inline code`',
  '**`git init`** is bold code',
  '_Run **`--global`** once_',
  '~~struck~~ text',
  '```bash\ncd ~\nls -a\n```',
  '```\nno language\n```',
  '- one\n- two\n- three',
  '1. first\n2. second',
  '3. continues\n4. at three',
  '> quoted line\n> second line',
  '[the Rails guide](https://guides.rubyonrails.org/)',
  '## Heading two',
  '### Heading three',
  '- item with `code`\n- item with **bold**',
  'Escaped \\*stars\\* stay literal',
  'snake_case and user_id stay as typed',
  '2 * 3 = 6 and C++ code',
]

describe('Rich ⇄ Markdown round trip (§9.1)', () => {
  it.each(SUPPORTED)('keeps %j exactly through Rich mode', (markdown) => {
    const { issues } = markdownToEditorDoc(markdown)
    expect(issues).toEqual([])
    expect(markdownToRichToMarkdown(markdown)).toBe(markdown)
  })

  it("keeps Lance's Nov 11 reply exactly, both directions", () => {
    expect(markdownToEditorDoc(lanceNov11Markdown).issues).toEqual([])
    expect(markdownToRichToMarkdown(lanceNov11Markdown)).toBe(lanceNov11Markdown)
    // Rich → Markdown → Rich returns the same document.
    const markdown = editorJsonToMarkdown(throughRichEditor(lanceNov11Editor))
    expect(markdown).toBe(lanceNov11Markdown)
    expect(editorJsonToMarkdown(throughRichEditor(markdownToEditorDoc(markdown).doc))).toBe(markdown)
  })

  it.each(realMessagePatterns)('reads real message %j the same after Rich mode', (markdown) => {
    const once = markdownToRichToMarkdown(markdown)
    expect(sameMarkdownStructure(markdown, once)).toBe(true)
    // Whatever Rich mode writes is stable from then on.
    expect(markdownToRichToMarkdown(once)).toBe(once)
  })

  it.each([
    ...overlappingMarkParagraphs.map((paragraph) => ({ type: 'doc', content: [paragraph] })),
    ...unflankedPunctuationParagraphs.map(({ paragraph }) => ({ type: 'doc', content: [paragraph] })),
    ...literalBackslashParagraphs.map(({ paragraph }) => ({ type: 'doc', content: [paragraph] })),
  ])('Rich → Markdown → Rich reads the same for composer paragraph %#', (doc) => {
    const markdown = editorJsonToMarkdown(throughRichEditor(doc))
    const again = markdownToRichToMarkdown(markdown)
    // Punctuation the serializer moved outside a mark can be escaped differently the second time; it reads the same.
    expect(sameMarkdownStructure(markdown, again)).toBe(true)
    expect(markdownToRichToMarkdown(again)).toBe(again)
  })

  it('applies only the allowed spelling normalizations', () => {
    expect(markdownToRichToMarkdown('* star bullet')).toBe('- star bullet')
    expect(markdownToRichToMarkdown('*italic*')).toBe('_italic_')
  })
})

describe('Markdown Rich mode cannot edit (§9.6)', () => {
  it.each([
    ['| a | b |\n|---|---|\n| 1 | 2 |', 'a table'],
    ['![diagram](https://example.com/d.png)', 'an image'],
    ['- [ ] write tests\n- [x] ship', 'a checklist'],
    ['---', 'a divider'],
    ['# Big title', "a heading Rich mode can't show"],
    ['#### Small title', "a heading Rich mode can't show"],
    ['<div>raw</div>', 'HTML'],
    ['[ref]: https://example.com', 'a link reference'],
    ['> ```\n> code\n> ```', 'a list or code block inside a quote'],
    ['    indented code', 'an indented code block'],
  ])('locks %j as %s and saves it byte for byte', (markdown, kind) => {
    const { doc, issues } = markdownToEditorDoc(`Before **bold**\n\n${markdown}\n\nAfter _it_`)
    expect(issues).toEqual([kind])
    expect(doc.content?.find((node) => node.type === 'rawMarkdown')?.attrs?.markdown).toBe(markdown)
    expect(markdownToRichToMarkdown(`Before **bold**\n\n${markdown}\n\nAfter _it_`)).toBe(`Before **bold**\n\n${markdown}\n\nAfter _it_`)
  })

  it('keeps blank lines inside fences and list continuations in one chunk', () => {
    expect(splitMarkdownChunks('```\na\n\nb\n```\n\nnext')).toEqual(['```\na\n\nb\n```', 'next'])
    expect(splitMarkdownChunks('- item\n\n  more\n\nafter')).toEqual(['- item\n\n  more', 'after'])
  })

  it('never drops text: whatever the input, Rich mode reads the same', () => {
    const samples = [
      'x _~~*one~~*',
      'Text\n- list right after\nlazy line',
      '<https://example.com> and www.example.com',
      '1) paren list\n2) second',
      '&amp; &copy; &#123;',
      'trailing backslash\\\nnext',
    ]
    for (const markdown of samples) {
      expect(sameMarkdownStructure(markdown, markdownToRichToMarkdown(markdown))).toBe(true)
    }
  })
})

describe('looksLikeMarkdown (paste, §9.5)', () => {
  it.each([
    '**bold** words', 'run `npm test`', '```js\nx\n```', '- one\n- two', '1. first', '> quote', '## Title', '[docs](https://x.dev)', '| a | b |',
  ])('reads %j as Markdown', (text) => expect(looksLikeMarkdown(text)).toBe(true))

  it.each(['Thanks for the help today.', 'snake_case and 2 * 3', 'Meet at 6:00 - bring snacks'])('leaves %j as text', (text) => {
    expect(looksLikeMarkdown(text)).toBe(false)
  })
})

/** Loads Markdown into the real Rich editor, types `insert` right after the first `after`, and saves. */
function editBeside(markdown: string, after: string, insert: string, target: MarkdownTarget = 'message') {
  editor?.destroy()
  editor = new Editor({ extensions: createRichExtensions({ onLink: () => undefined, underlineShortcut: true }), content: markdownToEditorDoc(markdown, { target }).doc })
  let position = -1
  editor.state.doc.descendants((node, offset) => {
    if (position < 0 && node.isText && node.text!.includes(after)) position = offset + node.text!.indexOf(after) + after.length
  })
  expect(position).toBeGreaterThan(0)
  editor.commands.insertContentAt(position, insert)
  return editorJsonToMarkdown(editor.getJSON())
}

describe('locked blocks keep every byte beside a Rich edit (review round 1)', () => {
  it.each<[string, string, MarkdownTarget]>([
    // First position: leading indentation is the code block.
    ['    indented code\n\nAfter', 'After', 'message'],
    ['\tindented with a tab\n      deeper\n\nAfter', 'After', 'written'],
    // Last position: trailing spaces on the final table row.
    ['Before\n\n| a | b |\n|---|---|\n| 1 | 2 |   ', 'Before', 'written'],
    ['Before\n\n| a | b |   \n|---|---|\n| 1 | 2 |  ', 'Before', 'message'],
    // Middle, with blank lines (and a whitespace-only line) inside one indented code block.
    ['Before\n\n    a\n\n\n    b\n      \n    c\n\nAfter', 'After', 'written'],
    ['Before\n\n    a\n\n\n    b\n      \n    c\n\nAfter', 'Before', 'message'],
    // Neighbouring locked blocks of different kinds, separated by extra blank lines.
    ['Intro\n\n---\n\n\n# Title  \n\nOutro', 'Outro', 'written'],
  ])('keeps the locked text of %j exactly when %j is edited (%s)', (markdown, after, target) => {
    const edited = editBeside(markdown, after, '!', target)
    expect(edited).toBe(markdown.replace(after, `${after}!`))
  })

  it('names every kind in a block of neighbouring locked chunks', () => {
    const { doc, issues } = markdownToEditorDoc('    code\n\n| a |\n|---|\n\n&check; done\n\nAfter')
    expect(issues).toEqual(['an indented code block', 'a table', 'an HTML5 character reference'])
    expect(doc.content?.filter((node) => node.type === 'rawMarkdown')).toHaveLength(1)
    expect(lockedKinds(doc)).toEqual(['an indented code block', 'a table', 'an HTML5 character reference'])
    expect(lockedWarning(lockedKinds(doc))).toBe("Rich mode can't edit an indented code block, a table and an HTML5 character reference. It's shown as Markdown text and saved unchanged.")
  })

  it('keeps a whole-document lock byte for byte at both ends', () => {
    expect(markdownToRichToMarkdown('    only code  ')).toBe('    only code  ')
    expect(markdownToRichToMarkdown('| a |\n|---|\n| 1 |  ')).toBe('| a |\n|---|\n| 1 |  ')
  })

  it('keeps whitespace-only lines inside a chunk', () => {
    expect(splitMarkdownChunks('- item\n  \n  more\n\nafter')).toEqual(['- item\n  \n  more', 'after'])
  })

  it('still trims the whitespace the editor writes at the ends', () => {
    expect(editorJsonToMarkdown({ type: 'doc', content: [{ type: 'paragraph' }, { type: 'paragraph', content: [{ type: 'text', text: '  hi  ' }] }, { type: 'paragraph' }] })).toBe('hi')
  })
})

describe('the round trip is checked in the renderer that shows the text (review round 1)', () => {
  const written = (markdown: string) => markdownToEditorDoc(markdown, { target: 'written' })
  const message = (markdown: string) => markdownToEditorDoc(markdown, { target: 'message' })

  it.each(SUPPORTED)('long-form text: keeps %j editable and exact', (markdown) => {
    expect(written(markdown).issues).toEqual([])
    expect(editorJsonToMarkdown(throughRichEditor(written(markdown).doc))).toBe(markdown)
  })

  it('locks HTML5-only entity names on both surfaces, so they stay as typed', () => {
    for (const result of [written('&check; done'), message('&check; done')]) {
      expect(result.issues).toEqual(['an HTML5 character reference'])
      expect(editorJsonToMarkdown(throughRichEditor(result.doc))).toBe('&check; done')
    }
    // HTML4 names read the same everywhere and stay editable.
    expect(written('&amp; &copy;').issues).toEqual([])
    expect(editBeside('&check; done\n\nNext', 'Next', '!', 'written')).toBe('&check; done\n\nNext!')
  })

  it('locks a lazy continuation line in long-form text, where it joins the item', () => {
    const lazy = '- first\nlazy continuation'
    expect(written(lazy).issues).toEqual(["Markdown Rich mode can't show exactly"])
    expect(editBeside(`Intro\n\n${lazy}`, 'Intro', '!', 'written')).toBe(`Intro!\n\n${lazy}`)
    // Messages end the list there, and Rich mode reads it the same way.
    expect(message(lazy).issues).toEqual([])
    expect(sameMarkdownStructure(lazy, editorJsonToMarkdown(throughRichEditor(message(lazy).doc)))).toBe(true)
  })

  it('locks a list that is loose in CommonMark but would be written tight', () => {
    const loose = '- a\n- b\n\n  more in b'
    expect(written(loose).issues).toEqual(["Markdown Rich mode can't show exactly"])
    expect(editorJsonToMarkdown(throughRichEditor(written(loose).doc))).toBe(loose)
  })

  it('compares the written renderer only for long-form text', () => {
    expect(sameMarkdownStructure('- first\nlazy', '- first\n\nlazy')).toBe(true)
    expect(sameMarkdownStructure('- first\nlazy', '- first\n\nlazy', 'written')).toBe(false)
  })
})

describe('bare URLs are stored as typed (review round 1)', () => {
  it.each<MarkdownTarget>(['message', 'written'])('keeps bare URLs and <autolinks> as typed (%s)', (target) => {
    const markdown = 'See https://example.com/a_b_c and www.example.org, or <https://x.dev> and <help@example.com>.'
    const { doc, issues } = markdownToEditorDoc(markdown, { target })
    expect(issues).toEqual([])
    expect(editorJsonToMarkdown(throughRichEditor(doc))).toBe(markdown)
    expect(editBeside(markdown, 'See', ' it', target)).toBe(markdown.replace('See', 'See it'))
  })

  it('keeps [url](url) and **bare** URLs in their spelling', () => {
    expect(markdownToRichToMarkdown('[https://x.dev](https://x.dev)')).toBe('[https://x.dev](https://x.dev)')
    expect(markdownToRichToMarkdown('**https://x.dev/a_b**')).toBe('**https://x.dev/a_b**')
    expect(markdownToRichToMarkdown('- https://x.dev\n- [docs](https://x.dev/docs)')).toBe('- https://x.dev\n- [docs](https://x.dev/docs)')
  })

  it('stores a URL typed in Rich mode bare', () => {
    editor?.destroy()
    editor = new Editor({ extensions: createRichExtensions({ onLink: () => undefined }), content: '<p></p>' })
    editor.commands.insertContent('see https://example.com/a_b ')
    editor.commands.insertContent('and www.example.org ')
    const paragraph: JSONContent[] = editor.getJSON().content![0].content!
    expect(paragraph.filter((node) => node.marks?.some((mark) => mark.type === 'link')).map((node) => node.text)).toEqual(['https://example.com/a_b', 'www.example.org'])
    expect(editorJsonToMarkdown(editor.getJSON())).toBe('see https://example.com/a_b and www.example.org')
  })

  it('writes [text](url) when the link text is not the URL, or a bare URL would read differently', () => {
    const link = (text: string, href = 'https://x.dev') => ({ type: 'text', text, marks: [{ type: 'link', attrs: { href } }] })
    const paragraph = (...content: JSONContent[]) => editorJsonToMarkdown({ type: 'doc', content: [{ type: 'paragraph', content }] })
    expect(paragraph(link('docs'))).toBe('[docs](https://x.dev)')
    expect(paragraph(link('https://x.dev'))).toBe('https://x.dev')
    // A letter right after the URL would join it.
    expect(paragraph(link('https://x.dev'), { type: 'text', text: 'abc' })).toBe('[https://x.dev](https://x.dev)abc')
    // Text edited away from the URL it points to.
    expect(paragraph(link('https://y.dev'))).toBe('[https://y.dev](https://x.dev)')
  })
})

describe('numbered lists keep a zero start (review round 1)', () => {
  it.each<MarkdownTarget>(['message', 'written'])('keeps 0. as the first number (%s)', (target) => {
    const { doc, issues } = markdownToEditorDoc('0. zero\n1. one', { target })
    expect(issues).toEqual([])
    expect(doc.content?.[0]).toMatchObject({ type: 'orderedList', attrs: { start: 0 } })
    expect(editorJsonToMarkdown(throughRichEditor(doc))).toBe('0. zero\n1. one')
    expect(editBeside('0. zero\n1. one', 'one', '!', target)).toBe('0. zero\n1. one!')
  })

  it('reads 0. and 1. starts as different lists', () => {
    expect(sameMarkdownStructure('0. a', '1. a')).toBe(false)
  })
})
