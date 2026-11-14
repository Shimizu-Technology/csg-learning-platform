// @vitest-environment jsdom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { MarkdownText } from '../components/shared/MarkdownRenderer'
import { FormattedMessage } from '../pages/shared/Messages'
import { lanceNov11Markdown, realMessagePatterns } from './markdownFixtures'

/**
 * The supported syntax (design spec §9.3) must look the same in a message
 * (the message parser) and in long-form text (react-markdown + remark-gfm),
 * so the two-mode editor's Preview matches every reader. Both renderers are
 * reduced to the same semantic tree and compared.
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

/** Merge text, collapse whitespace (a run with a newline is one line break), drop blank text between blocks. */
function normalize(nodes: Semantic[]): Semantic[] {
  const merged: Semantic[] = []
  for (const node of nodes) {
    if (typeof node === 'string' && typeof merged.at(-1) === 'string') merged[merged.length - 1] += node
    else merged.push(node)
  }
  return merged
    .map((node) => typeof node === 'string' ? node.replace(/\s+/g, (space) => space.includes('\n') ? '\n' : ' ') : node)
    .filter((node) => typeof node !== 'string' || node.trim() !== '' || merged.length === 1)
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

const asMessage = (body: string) => tree(renderToStaticMarkup(<FormattedMessage body={body} />), 1)
const asLongForm = (body: string) => tree(renderToStaticMarkup(<MarkdownText content={body} />), 1)

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
  lanceNov11Markdown,
]

describe('message and long-form renderers agree on the supported syntax', () => {
  it.each(SUPPORTED_SYNTAX)('%s', (body) => {
    expect(asMessage(body)).toEqual(asLongForm(body))
  })

  it('still sees documented differences outside §9.3 (a single # heading)', () => {
    expect(asMessage('# Title')).not.toEqual(asLongForm('# Title'))
  })

  it('compares real structure, not just text', () => {
    expect(asMessage('Run **`x`**')).toEqual([{ tag: 'p', attrs: {}, children: ['Run ', { tag: 'strong', attrs: {}, children: [{ tag: 'code', attrs: {}, children: ['x'] }] }] }])
  })
})

// Checked against the previous renderer (origin/main, Nov 15): identical except
// fences (now <CodeBlock>) and bold around inline code (was literal **).
describe('real message patterns keep rendering the same way', () => {
  it.each(realMessagePatterns)('%s', (body) => {
    expect(asMessage(body)).toMatchSnapshot()
  })
})

