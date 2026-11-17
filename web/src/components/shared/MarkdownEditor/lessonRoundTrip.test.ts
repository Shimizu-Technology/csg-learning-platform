// @vitest-environment jsdom
import { Editor, type JSONContent } from '@tiptap/core'
import { afterEach, describe, expect, it } from 'vitest'
import { editorJsonToMarkdown } from '../../../lib/messageFormat'
import { lessonMarkdownStructure } from '../../../lib/writtenMarkdown'
import preworkBodies from '../../../test/fixtures/prework-lesson-bodies.json'
import { createRichExtensions } from './extensions'
import { editorJsonToMarkdownKeepingSource, keySourceSegments, markdownToEditorDoc, RAW_MARKDOWN_NODE } from './markdownToEditorJson'

/**
 * U-6.8: lesson text and instructions through Rich mode. The bodies are the
 * production-authored prework (scripts/prework_exercises.json) exactly as
 * `curriculum:import_prework` stores them; regenerate them with
 * scripts/qa/lesson-bodies-fixture.rb.
 */
const bodies = preworkBodies as { title: string; body: string }[]

let editor: Editor | null = null
afterEach(() => {
  editor?.destroy()
  editor = null
})

/** Markdown into the real Rich schema, as a lesson block's editor loads it. */
function load(markdown: string) {
  editor?.destroy()
  const result = markdownToEditorDoc(markdown, { target: 'lesson' })
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
