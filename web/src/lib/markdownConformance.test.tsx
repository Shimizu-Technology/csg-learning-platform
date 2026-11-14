// @vitest-environment jsdom
/// <reference types="node" />
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'
import { marked, Renderer } from 'marked'
import type { JSONContent } from '@tiptap/core'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from '../components/shared/MarkdownRenderer'
import { FormattedMessage } from '../pages/shared/Messages'
import { lanceNov11Markdown, overlappingMarkParagraphs, realMessagePatterns, unflankedPunctuationParagraphs } from './markdownFixtures'
import { editorJsonToMarkdown } from './messageFormat'

/**
 * The supported syntax (design spec §9.3) must look the same in a message
 * (the message parser), in long-form text on the web (react-markdown +
 * remark-gfm) and in long-form text on mobile (marked), so the two-mode
 * editor's Preview matches every reader. All three renderers are reduced to
 * the same semantic tree and compared.
 */
type Semantic = string | { tag: string; attrs?: Record<string, string>; children: Semantic[] }

const TAGS: Record<string, string> = {
  P: 'p', STRONG: 'strong', EM: 'em', CODE: 'code', DEL: 'del', U: 'u', A: 'a', UL: 'ul', OL: 'ol', LI: 'li', BLOCKQUOTE: 'blockquote',
}

function semantic(node: Node, headingOffset: number): Semantic[] {
  if (node.nodeType === Node.TEXT_NODE) return [node.textContent || '']
  if (!(node instanceof Element)) return []
  if (node.tagName === 'BR') return ['\n']
  if (node.classList.contains('code-block')) {
    return [{ tag: 'codeblock', attrs: { language: node.getAttribute('data-language') || '' }, children: [node.querySelector('pre')?.textContent || ''] }]
  }
  if (node.tagName === 'PRE') {
    // marked's <pre><code class="language-x">, trimmed of blank lines like <CodeBlock>.
    const language = node.querySelector('code')?.className.match(/language-(\S+)/)?.[1] || ''
    return [{ tag: 'codeblock', attrs: { language }, children: [(node.textContent || '').replace(/^(?:[ \t]*\n)+|(?:\n[ \t]*)+$/g, '')] }]
  }
  // Wrappers (spans, divs) pass their content through; only semantic elements normalize it.
  const raw = Array.from(node.childNodes).flatMap((child) => semantic(child, headingOffset))
  const children = normalize(raw)
  const heading = node.tagName.match(/^H(\d)$/)
  if (heading) return [{ tag: `h${Number(heading[1]) - headingOffset}`, children }]
  const tag = TAGS[node.tagName]
  if (!tag) return raw
  const attrs: Record<string, string> = {}
  if (tag === 'a') attrs.href = node.getAttribute('href') || ''
  if (tag === 'ol' && node.getAttribute('start')) attrs.start = node.getAttribute('start')!
  return [{ tag, attrs, children }]
}

/**
 * Merge text, collapse whitespace (a run with a newline is one line break),
 * and drop blank text at the edges and next to blocks. Blank text between two
 * inline elements (`**a** _b_`) is kept: it's what separates the words.
 */
function normalize(nodes: Semantic[]): Semantic[] {
  const merged: Semantic[] = []
  for (const node of nodes) {
    if (typeof node === 'string' && typeof merged.at(-1) === 'string') merged[merged.length - 1] += node
    else merged.push(node)
  }
  const inline = (node: Semantic | undefined) => node !== undefined && typeof node !== 'string' && !isBlock(node)
  return merged
    .map((node) => typeof node === 'string' ? node.replace(/\s+/g, (space) => space.includes('\n') ? '\n' : ' ') : node)
    .filter((node, index, list) => typeof node !== 'string' || node.trim() !== '' || merged.length === 1
      || (inline(list[index - 1]) && inline(list[index + 1])))
    .map((node, index, list) => {
      if (typeof node !== 'string') return node
      let text = node
      if (index === 0 || typeof list[index - 1] !== 'string' && isBlock(list[index - 1])) text = text.replace(/^\s+/, '')
      if (index === list.length - 1 || typeof list[index + 1] !== 'string' && isBlock(list[index + 1])) text = text.replace(/\s+$/, '')
      return text
    })
}

function isBlock(node: Semantic) {
  return typeof node !== 'string' && ['p', 'ul', 'ol', 'li', 'blockquote', 'codeblock', 'h2', 'h3'].includes(node.tag)
}

function tree(html: string, headingOffset: number) {
  const document = new DOMParser().parseFromString(html, 'text/html')
  return normalize(semantic(document.body, headingOffset))
}

// mobile/src/lib/lesson-markdown.ts, compiled without Expo's tsconfig (the
// frontend CI job installs web dependencies only), on the web's copy of marked.
const nativeMarkdown: { renderLessonMarkdown?: (body: string, options: { written: boolean }) => string } = {}
runInNewContext(ts.transpileModule(readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../../../mobile/src/lib/lesson-markdown.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, {
  exports: nativeMarkdown,
  require: (id: string) => id === 'marked' ? { marked, Renderer }
    : id === './learning' ? { safeExternalUrl: (url: string) => /^(?:https?:|mailto:)/i.test(url) ? url : null }
    : (() => { throw new Error(`Unexpected import ${id}`) })(),
})

const asMessage = (body: string) => tree(renderToStaticMarkup(<FormattedMessage body={body} />), 1)
const asLongForm = (body: string) => tree(renderToStaticMarkup(<MarkdownText content={body} />), 1)
const asNativeLongForm = (body: string) => tree(nativeMarkdown.renderLessonMarkdown!(body, { written: true }), 1)

const SUPPORTED_SYNTAX = [
  'Line one\nLine two\n\nA new paragraph',
  '**bold**, _italic_, *also italic*, `code` and ~~struck~~',
  'Run **`bin/rails db:migrate`** then _`restart`_',
  '**What `git init` does:** it turns the folder into a repo',
  '```ruby\nputs "hi"\n```',
  '```\nls -a\n```',
  'Before\n\n```js\nconst a = 1',
  '- one\n- two **bold**\n- three',
  '1. one\n2. two\n3. three',
  '3. three\n4. four',
  '> quoted **text**\n> second line',
  'See [the guide](https://example.com/a_b) or https://example.com/docs.',
  '## Week 10\n\n### Tuesday',
  'user_id, first_name and __init__ stay literal; _this_ is italic',
  '\\*not bold\\* and \\`not code\\` and 1\\. not a list',
  'Tom &amp; Jerry said &quot;hi&quot; &#8212; and \\&amp; stays as typed',
  'Docs at <https://example.com/a_b>, <mailto:help@example.com> or <help@example.com>',
  '<div>literal</div>',
  'Wrap it in a <div> and `<span>`',
  '<div>one\ntwo</div>\n\nAfter',
  '- ```rb\n  puts 1\n  ```',
  '- ```rb\n  puts 1\n- Next step',
  '1. Run\n   ```bash\n   ls -a\n2. Check',
  lanceNov11Markdown,
]

describe('message and long-form renderers agree on the supported syntax', () => {
  it.each(SUPPORTED_SYNTAX)('%s', (body) => {
    const message = asMessage(body)
    expect(asLongForm(body)).toEqual(message)
    expect(asNativeLongForm(body)).toEqual(message)
  })

  it('still sees documented differences outside §9.3 (a single # heading)', () => {
    expect(asMessage('# Title')).not.toEqual(asLongForm('# Title'))
  })

  it('compares real structure, not just text', () => {
    expect(asMessage('Run **`x`**')).toEqual([{ tag: 'p', attrs: {}, children: ['Run ', { tag: 'strong', attrs: {}, children: [{ tag: 'code', attrs: {}, children: ['x'] }] }] }])
  })
})

/** Each character's text and sorted marks, so nesting order doesn't matter. */
function marksByCharacter(nodes: Semantic[], marks = ''): string[] {
  return nodes.flatMap((node) => typeof node === 'string'
    ? [...node].map((character) => /\s/.test(character) ? character : `${character}:${[...marks].sort().join('')}`)
    : marksByCharacter(node.children, marks + ({ strong: 'b', em: 'i', del: 's', code: 'c' }[node.tag] || '')))
}

describe('composer formatting reads back the same in every renderer', () => {
  it.each(overlappingMarkParagraphs.map((paragraph) => [editorJsonToMarkdown(paragraph), paragraph] as const))('%s', (body, paragraph) => {
    const message = asMessage(body)
    expect(asLongForm(body)).toEqual(message)
    expect(asNativeLongForm(body)).toEqual(message)
    // ...and what the sender formatted is what every reader sees.
    const sent = (paragraph.content || []).flatMap((node) => [...(node.text || '')].map((character) => /\s/.test(character)
      ? character
      : `${character}:${(node.marks || []).map((mark) => ({ bold: 'b', italic: 'i', strike: 's', code: 'c' }[mark.type] || '')).sort().join('')}`))
    expect(marksByCharacter(message).join('|').trim()).toBe(sent.join('|').trim())
  })

  it('serializes the review case (italic, bold italic, bold) without a ***** run', () => {
    expect(editorJsonToMarkdown(overlappingMarkParagraphs[0])).toBe('*a**b***__c__')
  })

  it.each(unflankedPunctuationParagraphs)('moves unflanked punctuation outside the mark: $markdown', ({ paragraph, markdown, read }) => {
    expect(editorJsonToMarkdown(paragraph)).toBe(markdown)
    const message = asMessage(markdown)
    expect(asLongForm(markdown)).toEqual(message)
    expect(asNativeLongForm(markdown)).toEqual(message)
    expect(marksByCharacter(message).join('|')).toBe(read)
  })
})

describe('composer formatting survives random marks and literal punctuation', () => {
  // A seeded generator, so a failure names a reproducible input.
  let seed = 20261116
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const pick = <T,>(list: T[]) => list[Math.floor(random() * list.length)]
  const paragraphs = (markSets: string[][]) => Array.from({ length: 300 }, () => ({
    type: 'paragraph',
    content: Array.from({ length: 2 + Math.floor(random() * 3) }, () => ({
      type: 'text',
      text: Array.from({ length: 1 + Math.floor(random() * 4) }, () => pick(['a', 'b', '_', '.', ' '])).join(''),
      marks: pick(markSets).map((type) => ({ type })),
    })).filter((node) => node.text.trim()),
  })).filter((paragraph) => paragraph.content.length)

  /** Bodies a renderer reads differently from the message parser, or where a letter lost or gained a mark. */
  const failures = (samples: JSONContent[], renderers: ((body: string) => Semantic[])[]) => samples.flatMap((paragraph) => {
    const body = editorJsonToMarkdown(paragraph)
    const message = asMessage(body)
    // Punctuation may move outside a mark (unflankedPunctuationParagraphs); letters keep theirs.
    const sent = (paragraph.content || []).flatMap((node) => [...(node.text || '')].filter((character) => character.trim()).map((character) => /[a-z]/.test(character)
      ? `${character}:${(node.marks || []).map((mark) => ({ bold: 'b', italic: 'i', strike: 's' }[mark.type])).sort().join('')}` : character))
    const read = marksByCharacter(message).filter((entry) => entry.trim()).map((entry) => /^[a-z]:/.test(entry) ? entry : entry[0])
    const agree = renderers.every((render) => JSON.stringify(render(body)) === JSON.stringify(message))
    return agree && read.join('|') === sent.join('|') ? [] : [body]
  })

  it('bold and italic read back the same in every renderer', () => {
    expect(failures(paragraphs([[], ['bold'], ['italic'], ['bold', 'italic']]), [asLongForm, asNativeLongForm])).toEqual([])
  })

  // marked reads a `~` beside `*` or `_` as a letter, so strike is checked against react-markdown; strike
  // sharing an edge with bold or italic next to a letter (`x~~*a*~~y`) can't be written (docs/MARKDOWN.md).
  it('strikethrough beside emphasis reads back the same in messages and web long-form text', () => {
    expect(failures(paragraphs([[], ['bold'], ['italic'], ['strike']]), [asLongForm])).toEqual([])
  })
})

describe('the message parser matches react-markdown on random emphasis', () => {
  // A seeded generator, so a failure names a reproducible input.
  let seed = 20261115
  const random = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
  const samples = Array.from({ length: 400 }, () => {
    const alphabet = '***__~~ ab.,'
    return `x ${Array.from({ length: 2 + Math.floor(random() * 10) }, () => alphabet[Math.floor(random() * alphabet.length)]).join('').trim()}`
  })
  it('agrees on every sample', () => {
    const mismatches = samples.filter((body) => JSON.stringify(asMessage(body)) !== JSON.stringify(asLongForm(body)))
    expect(mismatches).toEqual([])
  })
})

// Checked against the previous renderer (origin/main, Nov 15): identical except
// fences (now <CodeBlock>) and bold around inline code (was literal **).
describe('real message patterns keep rendering the same way', () => {
  it.each(realMessagePatterns)('%s', (body) => {
    expect(asMessage(body)).toMatchSnapshot()
  })
})

