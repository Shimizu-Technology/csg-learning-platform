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
import { looksLikeMarkdown, markdownToEditorDoc, sameMarkdownStructure, splitMarkdownChunks } from './markdownToEditorJson'

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
