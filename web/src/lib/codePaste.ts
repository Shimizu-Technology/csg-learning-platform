// Strong per-line code signals only: keywords, assignments, bare calls, and
// brace/semicolon endings. A trailing ':' or ')' alone is common in prose.
const CODE_LINE = /^\s*(def |class |if |elif |else:|for |while |return\b|import |from \S+ import|print\(|try:|except\b|with |async |await |const |let |var |function\b|end\b|puts |require |#include|<\/?[a-z][\w-]*[\s>/])|[{};]\s*$|^\s*[\w.[\]"']+\s*[+\-*/]?=\s*\S|^\s*[A-Za-z_][\w.]*\([^()]*\)\s*$/

/** Normalizes clipboard text: Windows line endings, non-breaking spaces, trailing blank lines. */
export function normalizePastedCode(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+$/, '')
}

/**
 * Decides whether pasted plain text should become a code block. Python only
 * survives a chat message when its indentation does, so multi-line text that
 * is indented or reads like code is kept verbatim in monospace. Ordinary
 * multi-paragraph prose stays as text (the composer offers "Paste as code").
 */
export function looksLikeCode(raw: string): boolean {
  const text = normalizePastedCode(raw)
  const lines = text.split('\n')
  const nonEmpty = lines.filter((line) => line.trim().length > 0)
  if (nonEmpty.length < 2) return false
  if (text.includes('```')) return false // already fenced markdown

  const indented = nonEmpty.filter((line) => /^( {2,}|\t)\S/.test(line) && !/^\s+([-*+•]|\d+[.)])\s/.test(line)).length
  if (indented > 0 && nonEmpty.some((line) => /^\S/.test(line))) return true
  if (lines.some((line) => /^\t/.test(line))) return true

  const codeLike = nonEmpty.filter((line) => CODE_LINE.test(line)).length
  return codeLike / nonEmpty.length >= 0.5
}

/** Multi-line pastes that stay as text still get a "Paste as code" escape. */
export function isMultiLinePaste(raw: string): boolean {
  return normalizePastedCode(raw).split('\n').filter((line) => line.trim()).length >= 2
}

/** True when `cursor` sits inside an open ``` (or ~~~) fence of a markdown string. */
export function isInsideMarkdownFence(value: string, cursor: number): boolean {
  // Only complete lines above the cursor's line can open or close a fence.
  const lines = value.slice(0, Math.max(0, cursor)).split('\n').slice(0, -1)
  let open: string | null = null
  for (const line of lines) {
    const match = line.match(/^\s*(`{3,}|~{3,})(.*)$/)
    if (!match) continue
    // CommonMark: a backtick fence's info string can't contain backticks, so
    // "Run ```npm install``` first" is inline text, not an opening fence.
    if (open === null) {
      if (match[1][0] === '`' && match[2].includes('`')) continue
      open = match[1]
    }
    else if (match[1][0] === open[0] && match[1].length >= open.length && match[2].trim() === '') open = null
  }
  return open !== null
}

/**
 * The text to insert so pasted code becomes its own fenced block: on its own
 * lines, with a fence longer than any backtick run inside the code.
 */
export function fencedCodeInsertion(value: string, selectionStart: number, selectionEnd: number, code: string): string {
  const longestRun = Math.max(2, ...Array.from(code.matchAll(/`+/g), (match) => match[0].length))
  const fence = '`'.repeat(longestRun + 1)
  const before = value.slice(0, selectionStart)
  const after = value.slice(selectionEnd)
  const lead = before.length === 0 || before.endsWith('\n') ? '' : '\n'
  const trail = after.startsWith('\n') ? '' : '\n'
  return `${lead}${fence}\n${code}\n${fence}${trail}`
}
