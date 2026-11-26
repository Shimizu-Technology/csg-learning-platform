const MAX_SCAN_CHARS = 16_000
const MAX_SCAN_LINES = 200
const MAX_LINE_CHARS = 500

// Strong per-line code signals only: keywords, assignments, bare calls, and
// brace/semicolon endings. A trailing ':' or ')' alone is common in prose.
const CODE_LINE = /^\s*(def |class |if |elif |else:|for |while |return\b|import |from \S+ import|print\(|try:|except\b|with |async |await |const |let |var |function\b|end\b|puts |require |#include|<\/?[a-z][\w-]*[\s>/])|[{};]\s*$|^\s*[\w.[\]"']+\s*[+\-*/]?=\s*\S|^\s*[A-Za-z_][\w.]*\([^()]*\)\s*$/

// Shell prompts: "$ cmd", "% cmd", "PS C:\path> cmd", "C:\path> cmd", "user@host:~/dir$ cmd", "~/dir % cmd".
const SHELL_PROMPT_LINE = /^\s*(?:[$%] \S+|PS [A-Za-z]:\\[^>]*>\s*\S*|[A-Za-z]:\\[^>]*>\s*\S+|[\w.-]+@[\w.-]+:[^\s$#%]*[$#%]\s+\S+|~[^\s%$#]*\s+[%$#]\s+\S+)/

// Common CLI commands students and instructors paste from a terminal (without false positives on normal English).
const TERMINAL_COMMAND_LINE = /^\s*(?:[$%]\s+)?(?:git\s+(?:add|bisect|branch|checkout|cherry-pick|clean|clone|commit|config|diff|fetch|init|log|merge|mv|pull|push|rebase|remote|reset|restore|revert|rm|show|stash|status|switch|tag)\b|npm\s+(?:audit|ci|exec|i|init|install|link|ls|outdated|prune|publish|rebuild|remove|run|search|start|test|uninstall|update|version|view|whoami)\b|npx\s+\S+|(?:yarn|pnpm|bun)\s+(?:add|build|create|dev|dlx|exec|init|install|lint|remove|run|start|test|upgrade)\b|node\s+(?:-[a-zA-Z]|--[a-zA-Z]|\S+\.[cm]?[jt]sx?\b|\.)|ruby\s+(?:-[a-zA-Z]|--[a-zA-Z]|\S+\.rb\b)|bundle\s+(?:add|binstubs|check|clean|config|exec|info|init|install|list|lock|open|outdated|remove|show|update)\b|(?:bin\/)?rails\s+(?:about|assets|c|console|credentials|db:\S+|destroy|g|generate|help|importmap|initializers|log|middleware|new|notes|restart|routes|runner|s|server|stats|t|test|tmp)\b|rake\s+\S+|bin\/\S+|\.\/\S+|python3?\s+(?:-[a-zA-Z]|--[a-zA-Z]|\S+\.py\b)|pip3?\s+(?:check|config|download|freeze|install|list|search|show|uninstall|wheel)\b|(?:pytest|vitest|jest)\b(?:\s+\S+|$)|cd\s+(?:~|\.{1,2}|\/|[A-Za-z]:\\|\S+\/\S*|[a-zA-Z0-9._-]+$)|ls(?:\s+-[a-zA-Z0-9]+|\s+[.~/]\S*|$)|mkdir\s+(?:-p\s+)?\S+|rm\s+-[rfiv]+\s+\S+|(?:cp|mv)\s+(?:-[a-zA-Z]+\s+)?\S+\s+\S+|chmod\s+[0-7+ugoa-rwxX]+\s+\S+|curl\s+(?:-[a-zA-Z]|https?:\/\/)|http\s+(?:GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|:[0-9]+|https?:\/\/)|psql\b(?:\s+\S+|$)|sqlite3\s+\S+|docker\s+(?:build|compose|exec|images|logs|ps|pull|push|rm|rmi|run|start|stop|up|down|volume)\b|gh\s+(?:api|auth|browse|clone|gist|issue|pr|release|repo|run|search|status|workflow)\b|brew\s+(?:cleanup|doctor|info|install|list|outdated|search|services|tap|uninstall|update|upgrade)\b|code\s+(?:\.|-\S+|\S+\.[a-zA-Z0-9]+)|export\s+[A-Z_][A-Z0-9_]*=\S*|source\s+[.~/]\S+|(?:nvm|rbenv|mise|pyenv|asdf)\s+\S+|ssh\s+\S+|sudo\s+\S+|touch\s+\S+)/

// Compiler/runtime errors, Git/npm/PowerShell error output (all linear-time anchored patterns; stack frames parsed separately).
const ERROR_HEADER_OR_OUTPUT_LINE = /^(?:(?:Uncaught\s+)?[A-Z][A-Za-z0-9_]*(?:Error|Exception|Failure)(?:\s*\([^)]*\))?:|(?:fatal|error|ERROR|ERR!)\s*:|Traceback \(most recent call last\):|ActiveRecord::\w+|ActionController::\w+|(?:NoMethod|Name|Syntax|Type|Reference|Range|URI|Eval|Indentation|ModuleNotFound|Import|ZeroDivision|Key|Value|Attribute|Index|FileNotFound|Permission)Error\b|CommandNotFoundException\b|npm\s+ERR!(?:\s|$)|npm\s+(?:error|warn)\b|yarn\s+error\b|Aborting$|Please commit your changes or stash them|\s+from\s+\S+:\d+:in\s+|\s+File "[^"]+", line \d+|\s*At line:\d+ char:\d+|\s*\+\s*(?:CategoryInfo|FullyQualifiedErrorId)\s*:|\s*\+\s+~+|[^:\n]{1,120}:\s*(?:[^\n:]{1,80}:\s*)?(?:command not found|[Nn]o such file or directory|[Pp]ermission denied)\b|[^\n]{1,160}\bis not recognized as (?:the name of a cmdlet|an internal or external command))|\bE(?:NOENT|ACCES|ADDRINUSE|CONNREFUSED|NOTDIR|EXIST)\b/

/** Linear-time JS/Java/Node stack-frame detector (avoids overlapping \S+ / .* backtracking). */
function isStackFrameLine(line: string): boolean {
  if (!/^\s+at\s+\S/.test(line)) return false
  const trimmed = line.trimEnd()
  if (/:\d+(?::\d+)?\)$/.test(trimmed)) {
    const open = trimmed.lastIndexOf('(')
    return open > 0 && open < trimmed.length - 4 && !/\s/.test(trimmed.slice(open + 1, -1))
  }
  return /\s\S+:\d+(?::\d+)?$/.test(trimmed)
}

function isErrorOrTraceLine(line: string): boolean {
  const sample = line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line
  return ERROR_HEADER_OR_OUTPUT_LINE.test(sample) || isStackFrameLine(sample)
}

/** Normalizes clipboard text: Windows line endings, non-breaking spaces, trailing blank lines. */
export function normalizePastedCode(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(/\u00a0/g, ' ').replace(/\n+$/, '')
}

/**
 * Decides whether pasted plain text should become a code block. Python only
 * survives a chat message when its indentation does, and students/instructors
 * regularly paste terminal commands and error output, so multi-line text that
 * is indented or reads like code, CLI commands, or stack traces is kept verbatim
 * in monospace. Ordinary multi-paragraph prose stays as text (the composer
 * offers "Paste as code instead").
 */
export function looksLikeCode(raw: string): boolean {
  const bounded = raw.length > MAX_SCAN_CHARS ? raw.slice(0, MAX_SCAN_CHARS) : raw
  const text = normalizePastedCode(bounded)
  const lines = text.split('\n').slice(0, MAX_SCAN_LINES)
  const nonEmpty = lines.filter((line) => line.trim().length > 0)
  if (nonEmpty.length < 2) return false
  // Already fenced Markdown (``` or ~~~ on its own line): Markdown paste keeps the fence as a code block.
  if (lines.some((line) => /^ {0,3}(`{3,}|~{3,})/.test(line))) return false

  const indented = nonEmpty.filter((line) => /^( {2,}|\t)\S/.test(line) && !/^\s+([-*+•]|\d+[.)])\s/.test(line)).length
  if (indented > 0 && nonEmpty.some((line) => /^\S/.test(line))) return true
  if (lines.some((line) => /^\t/.test(line))) return true

  const capped = nonEmpty.map((line) => (line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) : line))
  const errorLines = capped.filter((line) => isErrorOrTraceLine(line)).length
  if (errorLines >= 2) return true
  // A shell prompt on the first line (e.g. "$ git status" followed by command output) is a terminal transcript.
  if (SHELL_PROMPT_LINE.test(capped[0]) && capped.length <= 12) return true

  const codeLike = capped.filter((line) => (
    CODE_LINE.test(line)
    || SHELL_PROMPT_LINE.test(line)
    || TERMINAL_COMMAND_LINE.test(line)
    || isErrorOrTraceLine(line)
  )).length
  return codeLike / capped.length >= 0.5
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
