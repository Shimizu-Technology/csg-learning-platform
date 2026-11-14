/**
 * Drops blank lines at the start and end of written Markdown, and nothing
 * else: the first line keeps its indentation (`    code` is an indented code
 * block) and the last keeps its trailing spaces, so text is stored as typed.
 * Use it instead of `.trim()` before saving.
 */
export function trimBlankLines(markdown: string): string {
  if (!markdown.trim()) return ''
  return markdown.replace(/^(?:[ \t]*\n)+/, '').replace(/(?:\n[ \t]*)+$/, '')
}

const EMPTY_LIST_MARKER = /^\s*(?:[-*+]|\d+[.)])\s*$/
const MESSAGE_FENCE = /^[ \t]*(?:(?:[-*+]|\d{1,9}[.)])[ \t]+)?(`{3,}|~{3,})(.*)$/
const MESSAGE_LIST_ITEM = /^[ \t]*(?:[-*+]|\d{1,9}[.)])[ \t]+\S/
const LIST_MARKER = /^[ \t]*(?:[-*+]|\d{1,9}[.)])/
const HEADING = /^ {0,3}#{1,6}(?:[ \t]|$)/
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/
/** CommonMark type 6 HTML blocks, which (unlike inline tags) can interrupt a paragraph. */
const HTML_BLOCK_TAG = new RegExp(`^ {0,3}</?(?:${[
  'address', 'article', 'aside', 'base', 'basefont', 'blockquote', 'body', 'caption', 'center', 'col', 'colgroup',
  'dd', 'details', 'dialog', 'dir', 'div', 'dl', 'dt', 'fieldset', 'figcaption', 'figure', 'footer', 'form', 'frame',
  'frameset', 'h[1-6]', 'head', 'header', 'hr', 'html', 'iframe', 'legend', 'li', 'link', 'main', 'menu', 'menuitem',
  'nav', 'noframes', 'ol', 'optgroup', 'option', 'p', 'param', 'search', 'section', 'summary', 'table', 'tbody', 'td',
  'tfoot', 'th', 'thead', 'title', 'tr', 'track', 'ul',
].join('|')})(?:[ \\t>]|/>|$)`, 'i')
/** CommonMark HTML blocks that run across blank lines until their end marker (types 1-5). */
const MULTILINE_HTML: { start: RegExp; end: RegExp }[] = [
  { start: /^ {0,3}<(?:pre|script|style|textarea)(?:\s|>|$)/i, end: /<\/(?:pre|script|style|textarea)>/i },
  { start: /^ {0,3}<!--/, end: /-->/ },
  { start: /^ {0,3}<\?/, end: /\?>/ },
  { start: /^ {0,3}<![A-Za-z]/, end: />/ },
  { start: /^ {0,3}<!\[CDATA\[/, end: /\]\]>/ },
]

/** Lines that start a new block, so they can't lazily continue a list item's paragraph. */
const BLOCK_START = [
  HEADING, THEMATIC_BREAK, HTML_BLOCK_TAG, /^ {0,3}>/, /^ {0,3}(?:`{3,}|~{3,})/,
  /^[ \t]*(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)/, ...MULTILINE_HTML.map(({ start }) => start),
]

function columns(line: string) {
  let count = 0
  for (const character of line.match(/^[ \t]*/)![0]) count += character === '\t' ? 4 - count % 4 : 1
  return count
}

/**
 * The body a message is sent or saved with. Outside code it collapses runs
 * of blank lines into one and drops list markers with nothing after them
 * (an empty bullet left in the composer). Fenced code, indented code (at the
 * top level or inside a list item) and HTML blocks that run across blank
 * lines are kept byte for byte, as is every other line: only blank lines
 * between blocks and empty markers change.
 */
export function normalizeMessageMarkdown(body: string): string {
  const output: string[] = []
  let fence: string | null = null
  let htmlEnd: RegExp | null = null
  /** The column indented code must reach to continue, while inside it. */
  let codeIndent: number | null = null
  /** Content columns of the open list items, outermost first. */
  const items: { indent: number; content: number }[] = []
  let blanks: string[] = []
  /** Can an indented line start code here (start of text, after a blank line, a fence or a heading)? */
  let blockStart = true
  /** Was the previous line paragraph text (which a less indented line can lazily continue)? */
  let paragraph = false

  for (const line of body.replace(/\r\n?/g, '\n').split('\n')) {
    if (fence) {
      output.push(line)
      const close = line.match(/^[ \t]*(`{3,}|~{3,})[ \t]*$/)
      if (close && close[1][0] === fence[0] && close[1].length >= fence.length) {
        fence = null
        blockStart = true
        paragraph = false
      }
      continue
    }
    if (htmlEnd) {
      output.push(line)
      if (htmlEnd.test(line)) htmlEnd = null
      continue
    }
    if (!line.trim()) {
      blanks.push(line)
      paragraph = false
      continue
    }

    const indent = columns(line)
    const afterBlank = blanks.length > 0
    if (codeIndent !== null) {
      if (indent >= codeIndent) {
        // Blank lines inside indented code are part of the code.
        output.push(...blanks, line)
        blanks = []
        continue
      }
      codeIndent = null
    }
    if (blanks.length) {
      if (output.length) output.push(blanks.length === 1 ? blanks[0] : '')
      blanks = []
    }

    // A line belongs to the deepest list item it's indented into, unless it
    // lazily continues that item's paragraph (only text can, never a new block).
    const lazy = paragraph && !BLOCK_START.some((start) => start.test(line))
    if (!lazy) while (items.length && items[items.length - 1].content > indent) items.pop()
    const base = items.length ? items[items.length - 1].content : 0
    if ((afterBlank || blockStart) && indent >= base + 4) {
      codeIndent = base + 4
      paragraph = false
      output.push(line)
      continue
    }
    blockStart = false
    paragraph = false

    const opener = line.match(MESSAGE_FENCE)
    if (opener && !(opener[1][0] === '`' && opener[2].includes('`'))) {
      fence = opener[1]
      output.push(line)
      continue
    }
    const html = MULTILINE_HTML.find(({ start }) => start.test(line))
    if (html) {
      if (!html.end.test(line.replace(html.start, ''))) htmlEnd = html.end
      output.push(line)
      continue
    }
    const heading = HEADING.test(line)
    if (heading) blockStart = true

    // A marker with nothing after it is dropped, so it doesn't start a list item either.
    if (EMPTY_LIST_MARKER.test(line)) continue
    const item = line.match(MESSAGE_LIST_ITEM)
    paragraph = !heading && !THEMATIC_BREAK.test(line)
    if (item) {
      while (items.length && items[items.length - 1].indent >= indent) items.pop()
      const marker = columns(line.match(LIST_MARKER)![0].replace(/[^ \t]/g, ' '))
      const content = columns(item[0].slice(0, -1).replace(/[^ \t]/g, ' '))
      if (content - marker > 4) {
        // Five or more spaces after the marker: the item's content starts one
        // column past it, and the rest of the line is indented code.
        items.push({ indent, content: marker + 1 })
        codeIndent = marker + 5
        paragraph = false
      } else {
        items.push({ indent, content })
      }
    }
    output.push(line)
  }

  return trimBlankLines(output.join('\n'))
}

