// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { editorJsonToMarkdown } from '../../../lib/messageFormat'
import { lessonMarkdownStructure } from '../../../lib/writtenMarkdown'
import preworkBodies from '../../../test/fixtures/prework-lesson-bodies.json'
import { createRichExtensions } from './extensions'
import { isLessonHtml } from '../../../lib/lessonHtml'
import { editorJsonToMarkdownKeepingSource, keySourceSegments, lockedKinds, lockedWarning, markdownToEditorDoc, RAW_MARKDOWN_NODE, type MarkdownTarget } from './markdownToEditorJson'

/**
 * U-6.8: lesson text and instructions through Rich mode. The bodies are the
 * production-authored prework (scripts/prework_exercises.json) exactly as
 * `curriculum:import_prework` stores them; regenerate them with
 * scripts/qa/lesson-bodies-fixture.rb.
 */
const bodies = preworkBodies as { title: string; body: string; html: string }[]

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** Markdown into the real Rich schema, as a lesson block's editor loads it. */
function load(markdown: string, target: MarkdownTarget = 'lesson') {
  editor?.destroy()
  const result = markdownToEditorDoc(markdown, { target })
  editor = new Editor({ extensions: createRichExtensions({ onLink: () => undefined, underlineShortcut: false }), content: result.doc })
  const json = editor.getJSON()
  return { result, json, kept: keySourceSegments(result, json) }
}

function rawBlocks(doc: JSONContent) {
  return (doc.content || []).filter((node) => node.type === RAW_MARKDOWN_NODE).map((node) => String(node.attrs?.markdown))
}

/** A copy of `doc` with `suffix` typed at the end of top-level block `index`'s text. */
function typeAtEnd(doc: JSONContent, index: number, suffix: string): JSONContent {
  const copy = structuredClone(doc)
  const block = copy.content![index]
  const target = block.type === 'paragraph' || block.type === 'heading' ? block : null
  if (!target) throw new Error(`block ${index} is ${block.type}`)
  target.content = [...(target.content || []), { type: 'text', text: suffix }]
  return copy
}

describe('real lesson bodies through Rich mode (U-6.8)', () => {
  it('has the whole prework course, with code, links and HTML in code', () => {
    expect(bodies).toHaveLength(127)
    expect(bodies.filter(({ body }) => body.includes('```')).length).toBeGreaterThan(100)
    expect(bodies.filter(({ body }) => /\]\(https?:/.test(body)).length).toBeGreaterThan(10)
    expect(bodies.filter(({ body }) => /<[a-z]/i.test(body)).length).toBeGreaterThan(5)
  })

  it.each(bodies.map(({ title, body }) => [title, body]))('%s: parse, serialize, compare gives the stored text back byte for byte', (_title, body) => {
    const { json, kept } = load(body)
    expect(kept).not.toBeNull()
    expect(editorJsonToMarkdownKeepingSource(json, kept, 'lesson')).toBe(body)
    // Even written fresh, nothing is dropped: it reads exactly the same to learners.
    expect(lessonMarkdownStructure(editorJsonToMarkdown(json))).toBe(lessonMarkdownStructure(body))
  })

  it.each(bodies.map(({ title, body }) => [title, body]))('%s: anything Rich mode cannot show is kept as typed', (_title, body) => {
    const { result } = load(body)
    for (const raw of rawBlocks(result.doc)) expect(body).toContain(raw)
    expect(result.issues.length > 0).toBe(rawBlocks(result.doc).length > 0)
  })

  it('locks only the one lesson whose no-break spaces Rich mode cannot show, and says why', () => {
    const locked = bodies.filter(({ body }) => load(body).result.issues.length > 0).map(({ title }) => title)
    expect(locked).toEqual(['Week 5 Day 2 Lesson 4: CSS selectors'])
  })

  it.each(bodies.filter(({ body }) => markdownToEditorDoc(body, { target: 'lesson' }).doc.content!.filter((node) => node.type === 'paragraph' && node.content).length >= 2).map(({ title, body }) => [title, body]))(
    '%s: an edit to one paragraph leaves every other block exactly as typed',
    (_title, body) => {
      const { json, kept } = load(body)
      const index = json.content!.findIndex((node) => node.type === 'paragraph' && node.content)
      const edited = editorJsonToMarkdownKeepingSource(typeAtEnd(json, index, ' Edited.'), kept, 'lesson')
      expect(edited).toContain('Edited.')
      const untouched = kept!.segments.filter((segment) => {
        let start = 0
        for (const other of kept!.segments) {
          if (other === segment) break
          start += other.count
        }
        return index < start || index >= start + segment.count
      })
      let from = 0
      for (const segment of untouched) {
        const at = edited.indexOf(segment.text, from)
        expect(at, segment.text).toBeGreaterThanOrEqual(0)
        from = at + segment.text.length
      }
      // The edit reads as the edit and nothing else.
      expect(lessonMarkdownStructure(edited)).toBe(lessonMarkdownStructure(editorJsonToMarkdown(typeAtEnd(json, index, ' Edited.'))))
    },
  )
})

/** Lesson constructs the prework doesn't use, written the way authors write them. */
const LESSON_CONSTRUCTS: [string, string][] = [
  ['a table', '| Command | Does |\n| --- | --- |\n| `ls` | lists files |\n| `cd` | changes folder |'],
  ['inline HTML', 'Press <kbd>Ctrl</kbd> + <kbd>C</kbd> to copy.'],
  ['an HTML block', '<details>\n<summary>Hint</summary>\n\nUse a loop.\n\n</details>'],
  ['an image', '![The terminal](https://example.invalid/terminal.png)'],
  ['an escaped link label', '[chap\\_01](https://pine.fm/LearnToProgram/chap_01.html) and *emphasis* and __strong__'],
  ['a reference link', 'Read [the guide][guide].\n\n[guide]: https://guides.rubyonrails.org/'],
  ['a divider and an h4', 'Before\n\n---\n\n#### Small heading'],
  ['a checklist', '- [ ] Fork the repo\n- [x] Clone it'],
  ['nested code in a list', '1. Run this:\n\n   ```bash\n   git status\n   ```\n\n2. Then commit.'],
  ['soft line breaks and entities', 'One line\ncontinues here &amp; here &copy; 2026\n\n\n\nAfter extra blank lines'],
]

describe('lesson constructs through Rich mode', () => {
  it.each(LESSON_CONSTRUCTS)('keeps %s byte for byte, unedited and beside an edit', (_name, construct) => {
    const body = `Intro paragraph.\n\n${construct}\n\nOutro paragraph.`
    const { json, kept, result } = load(body)
    expect(editorJsonToMarkdownKeepingSource(json, kept, 'lesson')).toBe(body)
    expect(lessonMarkdownStructure(editorJsonToMarkdown(json))).toBe(lessonMarkdownStructure(body))
    for (const raw of rawBlocks(result.doc)) expect(body).toContain(raw)

    const edited = editorJsonToMarkdownKeepingSource(typeAtEnd(json, 0, ' Edited.'), kept, 'lesson')
    expect(edited).toBe(`Intro paragraph. Edited.\n\n${construct}\n\nOutro paragraph.`)
  })

  it('warns about every construct Rich mode cannot edit instead of dropping it', () => {
    const kinds = LESSON_CONSTRUCTS.flatMap(([, construct]) => markdownToEditorDoc(construct, { target: 'lesson' }).issues)
    expect(new Set(kinds)).toEqual(new Set(['a table', 'HTML', 'an image', 'a link reference', 'a divider', 'a heading Rich mode can\'t show', 'a checklist', 'Markdown Rich mode can\'t show exactly']))
  })

  it('falls back to the plain writer when a kept block would read differently beside new text', () => {
    // Two lists with different markers are two lists; a new list item between
    // them must not make the kept ones join it.
    const body = '* first\n\n- second'
    const { json, kept } = load(body)
    expect(editorJsonToMarkdownKeepingSource(json, kept, 'lesson')).toBe(body)
    const plain = editorJsonToMarkdown(json)
    expect(lessonMarkdownStructure(editorJsonToMarkdownKeepingSource(json, null, 'lesson'))).toBe(lessonMarkdownStructure(plain))
  })

  it('writes a document not loaded from Markdown (a restored draft) the plain way', () => {
    const { json } = load('**bold** and *italic*')
    expect(editorJsonToMarkdownKeepingSource(json, null, 'lesson')).toBe(editorJsonToMarkdown(json))
  })

  it('stays fast enough to run every frame on the longest lesson', () => {
    const longest = bodies.reduce((a, b) => (b.body.length > a.body.length ? b : a)).body
    const { json, kept } = load(longest)
    const edited = typeAtEnd(json, json.content!.findIndex((node) => node.type === 'paragraph' && node.content), ' Edited.')
    const started = performance.now()
    for (let run = 0; run < 20; run += 1) editorJsonToMarkdownKeepingSource(edited, kept, 'lesson')
    expect((performance.now() - started) / 20).toBeLessThan(16)
  })
})

/** Stored text with line endings and outer whitespace Rich mode must keep, and the one paragraph edited. */
const STORED_WHITESPACE: [string, string, number, string][] = [
  // [name, stored, paragraph edited (top-level index), expected after typing " Edited." at its end]
  ['the review repro (CRLF, outer blank lines, trailing spaces)', '\n\nIntro.\r\n\r\nUntouched &nbsp; paragraph.  \r\n\r\nOutro.\r\n\r\n', 0, '\n\nIntro. Edited.\r\n\r\nUntouched &nbsp; paragraph.  \r\n\r\nOutro.\r\n\r\n'],
  ['CRLF throughout, with code', 'Intro.\r\n\r\nSecond *one*\r\nline two\r\n\r\n```js\r\nconst a = 1\r\n```\r\n\r\nOutro.', 0, 'Intro. Edited.\r\n\r\nSecond *one*\r\nline two\r\n\r\n```js\r\nconst a = 1\r\n```\r\n\r\nOutro.'],
  ['a CRLF paragraph edited keeps CRLF inside it', 'Intro.\r\n\r\nLine one\r\nline two\r\n\r\nOutro.', 1, 'Intro.\r\n\r\nLine one\r\nline two Edited.\r\n\r\nOutro.'],
  ['leading and trailing blank lines', '\n\n\nIntro.\n\nMiddle.\n\n\n', 0, '\n\n\nIntro. Edited.\n\nMiddle.\n\n\n'],
  ['an untouched hard break (two trailing spaces)', 'Intro.\n\nLine one  \nLine two\n\nOutro.', 0, 'Intro. Edited.\n\nLine one  \nLine two\n\nOutro.'],
  ['a final newline with no blank line after it', 'Intro.\n\nOutro.\n', 0, 'Intro. Edited.\n\nOutro.\n'],
  ['a final CRLF with no blank line after it', 'Intro.\r\n\r\nOutro.\r\n', 0, 'Intro. Edited.\r\n\r\nOutro.\r\n'],
  ['the last paragraph edited before trailing blank lines', 'Intro.\r\n\r\nOutro.\r\n\r\n', 1, 'Intro.\r\n\r\nOutro. Edited.\r\n\r\n'],
]

describe('stored whitespace and line endings through a Rich edit (#304 review)', () => {
  it.each(STORED_WHITESPACE.flatMap(([name, stored, index, expected]) => (['lesson', 'written', 'message'] as MarkdownTarget[]).map((target) => [name, target, stored, index, expected] as const)))(
    '%s (%s): only the edited paragraph changes',
    (_name, target, stored, index, expected) => {
      const { json, kept } = load(stored, target)
      expect(kept).not.toBeNull()
      expect(editorJsonToMarkdownKeepingSource(json, kept, target)).toBe(stored)
      expect(editorJsonToMarkdownKeepingSource(typeAtEnd(json, index, ' Edited.'), kept, target)).toBe(expected)
    },
  )

  it('writes a new block in the stored line ending', () => {
    const stored = 'Intro.\r\n\r\nOutro.'
    const { json, kept } = load(stored)
    const content: JSONContent[] = [...(json.content || [])]
    content.splice(1, 0, { type: 'paragraph', content: [{ type: 'text', text: 'New' }, { type: 'hardBreak' }, { type: 'text', text: 'lines' }] })
    const added: JSONContent = { ...json, content }
    expect(editorJsonToMarkdownKeepingSource(added, kept, 'lesson')).toBe('Intro.\r\n\r\nNew\r\nlines\r\n\r\nOutro.')
  })
})

/**
 * Lesson bodies still stored as HTML (Trix class archives, imported lessons,
 * Python lessons written as <p> + <pre><code>). Lessons render them as HTML,
 * so Rich mode keeps each one whole as a locked block: never converted to
 * Markdown, and saved byte for byte.
 */
const HTML_BODIES: [string, string][] = [
  ...bodies.map(({ title, html }): [string, string] => [`Trix: ${title}`, html]),
  ['Python <p> + <pre><code>, blank lines inside the code', '<p>Write a function that adds two numbers.</p>\n<pre><code>def add(a, b):\n    return a + b\n\nx = 1\n\ny = *2*\n\nprint(add(x, y))\n</code></pre>\n<p>Run it with <code>python3 add.py</code>.</p>'],
  ['mixed: HTML first, Markdown after', '<p>Intro in HTML with <a href="https://example.com/a_b">a link</a>.</p>\n\nThen some **Markdown** text with a [link](https://example.com).\n\n- a list item\n\n```ruby\nputs 1\n```\n'],
  ['CRLF Trix with outer blank lines', '\r\n<div class="trix-content">\r\n  <div>Line one<br>Line two</div>\r\n\r\n<div>After a blank line</div>\r\n</div>\r\n\r\n'],
]

describe('lesson bodies stored as HTML (old editors)', () => {
  it('covers every production Trix body in the prework export, links included', () => {
    expect(bodies.filter(({ html }) => html.startsWith('<div class="trix-content">'))).toHaveLength(127)
    expect(bodies.filter(({ html }) => html.includes('<a href=')).length).toBeGreaterThan(10)
    expect(bodies.filter(({ html }) => html.includes('<pre><code>')).length).toBeGreaterThan(100)
  })

  it.each(HTML_BODIES)('%s: one locked HTML block with a warning, saved byte for byte, never converted', (_name, html) => {
    expect(isLessonHtml(html)).toBe(true) // the lesson renderer shows it as HTML
    const { result, json, kept } = load(html)
    // Nothing became Rich formatting: one locked block (with the stored text inside it) and the empty paragraph after it.
    expect(json.content!.map((node) => node.type)).toEqual([RAW_MARKDOWN_NODE, 'paragraph'])
    expect(json.content![1].content).toBeUndefined()
    const lockedText = String(json.content![0].attrs?.markdown)
    expect(html.replace(/\r\n?/g, '\n')).toContain(lockedText)
    expect(lockedKinds(result.doc)).toEqual(['HTML'])
    expect(lockedWarning(lockedKinds(result.doc))).toContain('can\'t edit HTML')
    // Untouched: exactly as stored, line endings and outer whitespace included.
    expect(editorJsonToMarkdownKeepingSource(json, kept, 'lesson')).toBe(html)
    // Text typed below it is added after the HTML; the HTML itself is not rewritten.
    const typed = typeAtEnd(json, 1, 'Added below.')
    const written = editorJsonToMarkdownKeepingSource(typed, kept, 'lesson')
    const stored = html.trimEnd()
    expect(written.startsWith(stored)).toBe(true)
    expect(written.slice(stored.length).trim()).toBe('Added below.')
  })

  it('keeps an HTML-first body whole in lessons, where it is rendered as HTML, but not in written text', () => {
    const mixed = HTML_BODIES.find(([name]) => name.startsWith('mixed'))![1]
    expect(load(mixed).json.content!.filter((node) => node.type !== RAW_MARKDOWN_NODE && node.content).length).toBe(0)
    // Written text shows HTML as typed, so there only the HTML paragraph is locked.
    expect(load(mixed, 'written').json.content!.some((node) => node.type === 'paragraph' && node.content)).toBe(true)
  })
})

