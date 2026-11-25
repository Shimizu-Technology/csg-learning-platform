import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/*
 * Finds the strings a person can read in the UI, so the glossary and writing
 * rules (redesign §2) can be checked by test. It is a heuristic over the
 * syntax tree, not a render: it collects
 *
 * - JSX text, with the element it sits in;
 * - string literals in JSX attributes and object properties whose name says
 *   they are copy (`label`, `title`, `aria-label`, `placeholder`, `message`…);
 * - string literals rendered as JSX children (`{done ? 'Saved' : 'Save'}`);
 * - string arguments to toast, confirm and error-message setters;
 * - strings returned by functions named like `statusLabel` or `emptyCopy`;
 * - values of object literals assigned to `…LABELS` / `…COPY` constants.
 *
 * Template literals keep their static text; each `${…}` becomes "…".
 */

export interface UiText {
  file: string
  line: number
  text: string
  /** Where it came from: `jsx`, `attr:<name>`, `prop:<name>`, `call:<name>`, `return:<fn>`, `map:<const>`. */
  context: string
  /** The nearest enclosing JSX element, when there is one. */
  element: string | null
  /** Every JSX element around it, nearest first, up to the component boundary. */
  ancestors: string[]
}

const COPY_NAME = /(^|[-_])(label|title|heading|subheading|placeholder|alt|description|message|text|hint|caption|eyebrow|subtitle|summary|empty|tooltip|cta|note|detail|body|prompt|copy|confirm|cancel|action|reason|status|tab|helper|context)s?$|Label$|Title$|Heading$|Text$|Message$|Copy$|Hint$|Description$|Caption$|Summary$|Note$|Detail$|Prompt$|Eyebrow$|Subtitle$|Placeholder$|Tooltip$/
const NOT_COPY = new Set(['className', 'class', 'to', 'href', 'id', 'key', 'type', 'name', 'role', 'variant', 'size', 'src', 'icon', 'tone', 'as', 'rel', 'target', 'autoComplete', 'inputMode', 'pattern', 'method', 'htmlFor', 'form', 'accept', 'color', 'align', 'side', 'mode', 'kind', 'layout', 'aria-controls', 'aria-describedby', 'aria-labelledby', 'aria-live', 'aria-current', 'aria-haspopup', 'data-testid', 'status', 'statusTone', 'action', 'textClassName', 'labelClassName', 'titleClassName'])
const COPY_CALL = /^(showToast|toast|success|notify|announce|confirm|setError|setNotice|setMessage|setSuccess|setFeedback|setStatusMessage|setFormError|setSaveError|setLoadError|setActionError|setInlineError|setAnnouncement|alert)$/
const COPY_FUNCTION = /(label|title|heading|copy|text|message|description|summary|caption|hint|eyebrow|subtitle|prompt|reason)$/i
const COPY_CONST = /(LABELS?|COPY|TITLES?|MESSAGES?|TEXTS?|HEADINGS?|NAMES)$/

function propertyName(name: ts.PropertyName | ts.JsxAttributeName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isPrivateIdentifier(name)) return name.text
  if (ts.isJsxNamespacedName(name)) return `${name.namespace.text}:${name.name.text}`
  return null
}

function isCopyName(name: string | null) {
  return Boolean(name && !NOT_COPY.has(name) && !/ClassName$|Class$|Id$|Ids$|Key$|Url$|Href$|Path$|At$/.test(name) && COPY_NAME.test(name))
}

function templateText(node: ts.TemplateExpression) {
  return node.head.text + node.templateSpans.map((span) => `…${span.literal.text}`).join('')
}

/** String values an expression can evaluate to, following `?:`, `||`, `??`, `&&` and parentheses. */
function stringValues(expression: ts.Expression | undefined, found: Array<{ node: ts.Node; text: string }> = []) {
  if (!expression) return found
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) return stringValues(expression.expression, found)
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) found.push({ node: expression, text: expression.text })
  else if (ts.isTemplateExpression(expression)) found.push({ node: expression, text: templateText(expression) })
  else if (ts.isConditionalExpression(expression)) { stringValues(expression.whenTrue, found); stringValues(expression.whenFalse, found) }
  else if (ts.isBinaryExpression(expression)) {
    const op = expression.operatorToken.kind
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) { stringValues(expression.left, found); stringValues(expression.right, found) }
    else if (op === ts.SyntaxKind.AmpersandAmpersandToken) stringValues(expression.right, found)
    else if (op === ts.SyntaxKind.PlusToken) {
      const left = stringValues(expression.left)
      const right = stringValues(expression.right)
      if (left.length || right.length) found.push({ node: expression, text: `${left.map((item) => item.text).join(' ') || '…'}${right.map((item) => item.text).join(' ') || '…'}` })
    }
  }
  return found
}

function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement | ts.JsxOpeningElement) {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  return tag.getText()
}

function enclosingElement(node: ts.Node): string | null {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) return tagName(parent)
    if (ts.isJsxAttribute(parent)) return tagName(parent.parent.parent)
  }
  return null
}

function jsxAncestors(node: ts.Node): string[] {
  const tags: string[] = []
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) tags.push(tagName(parent))
    else if (ts.isJsxAttribute(parent)) tags.push(tagName(parent.parent.parent))
    if (ts.isFunctionLike(parent)) break
  }
  return tags
}

function functionName(node: ts.Node): string | null {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isFunctionDeclaration(parent) && parent.name) return parent.name.text
    if ((ts.isArrowFunction(parent) || ts.isFunctionExpression(parent)) && ts.isVariableDeclaration(parent.parent) && ts.isIdentifier(parent.parent.name)) return parent.parent.name.text
    if (ts.isMethodDeclaration(parent)) return propertyName(parent.name)
    if (ts.isFunctionLike(parent)) return null
  }
  return null
}

function calleeName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text
  return null
}

const clean = (text: string) => text.replace(/\s+/g, ' ').trim()

export function scanUiSource(source: string, file: string): UiText[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: UiText[] = []
  const seen = new Set<ts.Node>()
  const add = (node: ts.Node, text: string, context: string) => {
    const value = clean(text)
    if (!value || seen.has(node) || !/\p{L}/u.test(value)) return
    seen.add(node)
    found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: value, context, element: enclosingElement(node), ancestors: jsxAncestors(node) })
  }
  const addAll = (expression: ts.Expression | undefined, context: string) => {
    for (const { node, text } of stringValues(expression)) add(node, text, context)
  }

  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isJsxText(node)) add(node, node.text, 'jsx')
    else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) addAll(node.expression, 'jsx')
    else if (ts.isJsxAttribute(node)) {
      const name = propertyName(node.name)
      if (isCopyName(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) add(node.initializer, node.initializer.text, `attr:${name}`)
        else if (ts.isJsxExpression(node.initializer)) addAll(node.initializer.expression, `attr:${name}`)
      }
    } else if (ts.isPropertyAssignment(node)) {
      const name = propertyName(node.name)
      const owner = node.parent.parent
      const constName = ts.isVariableDeclaration(owner) && ts.isIdentifier(owner.name) ? owner.name.text : null
      if (isCopyName(name)) addAll(node.initializer, `prop:${name}`)
      else if (constName && COPY_CONST.test(constName)) addAll(node.initializer, `map:${constName}`)
    } else if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression)
      if (callee && COPY_CALL.test(callee)) for (const arg of node.arguments) addAll(arg, `call:${callee}`)
    } else if (ts.isNewExpression(node) && calleeName(node.expression) === 'Error') {
      addAll(node.arguments?.[0], 'call:Error')
    } else if (ts.isReturnStatement(node) || (ts.isArrowFunction(node) && !ts.isBlock(node.body))) {
      const fn = ts.isArrowFunction(node) && ts.isVariableDeclaration(node.parent) && ts.isIdentifier(node.parent.name) ? node.parent.name.text : functionName(node)
      const value = ts.isReturnStatement(node) ? node.expression : (node.body as ts.Expression)
      if (fn && COPY_FUNCTION.test(fn) && !/className|class$/i.test(fn)) addAll(value, `return:${fn}`)
    } else if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && node.left.getText(sf) === 'document.title') {
      addAll(node.right, 'title')
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/** Non-test TypeScript sources under `dir`, as paths relative to `root`. */
export function uiSources(root: string, dir: string, extra: RegExp = /\.(ts|tsx)$/) {
  return walk(join(root, dir))
    .filter((file) => extra.test(file) && !/\.(test|spec)\.(ts|tsx)$/.test(file) && !/\/(__tests__|__mocks__|test|test-utils)\//.test(file) && !file.endsWith('.d.ts'))
    .map((file) => relative(root, file))
}

export function scanUiFiles(root: string, files: string[]) {
  return files.flatMap((file) => scanUiSource(readFileSync(join(root, file), 'utf8'), file))
}

/** Every string literal containing a space: prose-like text, wherever it sits (class names excluded). */
export function proseLiterals(source: string, file: string): UiText[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS)
  const found: UiText[] = []
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return
    if (ts.isJsxAttribute(node) && /className|class/i.test(propertyName(node.name) || '')) return
    if (ts.isPropertyAssignment(node) && /^(class|className|\w+ClassName)$/.test(propertyName(node.name) || '')) return
    let text: string | null = null
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text
    else if (ts.isTemplateExpression(node)) text = templateText(node)
    else if (ts.isJsxText(node)) text = node.text
    if (text !== null && /\S\s+\S/.test(text)) {
      found.push({ file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: clean(text), context: 'literal', element: enclosingElement(node), ancestors: [] })
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return found
}

/* ------------------------------------------------------------------ */
/* Sentence case                                                       */
/* ------------------------------------------------------------------ */

/** Elements and contexts whose text is a title, button, tab, label or menu item. */
export const LABEL_ELEMENTS = /^(button|Button|[A-Z]\w*Button|h[1-6]|th|label|legend|option|summary|Tab|[A-Z]\w*Tab|NavLink|PageHeader|SectionHeader|[A-Z]\w*Heading|DialogTitle|MenuItem|[A-Z]\w*Chip)$/
export const LABEL_CONTEXTS = /^(attr|prop):(label|title|heading|aria-label|placeholder|confirmLabel|cancelLabel|actionLabel|buttonLabel|submitLabel|ctaLabel|primaryLabel|secondaryLabel|emptyTitle|tabLabel|backLabel|eyebrow|subtitle|\w+Label|\w+Title)$|^title$|^(map|return):/

/**
 * Words that keep a capital letter mid-label: proper nouns, product names,
 * and the names of places in the app when a label points at them ("Back to
 * Today"). Grade letters and acronyms are caught by the all-caps rule.
 */
export const PROPER_NOUNS = new Set([
  // Days and months
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  // The school, products and services
  'Code', 'School', 'Guam', 'Learn', 'Alumni', 'Clerk', 'Google', 'GitHub', 'Zoom', 'Vimeo', 'YouTube', 'Loom', 'Mux', 'Netlify', 'Render',
  'Apple', 'App', 'Store', 'Play', 'Android', 'Chrome', 'Safari', 'Firefox', 'Windows', 'Mac', 'Linux', 'Slack', 'Discord', 'Stripe', 'Gmail',
  // Google Doc, Sheet, Slides and Drive, and other services links can point to
  'Doc', 'Sheet', 'Slides', 'Drive', 'Figma', 'Notion', 'Canva',
  'Markdown', 'Rich', 'JavaScript', 'TypeScript', 'Python', 'Ruby', 'Rails', 'React', 'Node', 'Git', 'Expo', 'Monaco', 'Chamorro', 'English', 'Shimizu', 'Technology',
  // Places in the app, used as names in "Back to …" and "Open …"
  'Today', 'Grading', 'Support', 'Messages', 'Updates', 'Content', 'Students', 'Cohorts', 'Recordings', 'Resources', 'Meetings', 'Team', 'Safety',
  // Grades
  'Redo',
  // Lowercase-start brand/product words that appear capitalised
  'I', 'OK', 'Cmd', 'Ctrl', 'Shift', 'Enter', 'Esc', 'Tab', 'Alt', 'Option',
])

const BREAK_BEFORE = /[.!?:·—–|/(“"]$/

/**
 * Words after the first that start with a capital letter and aren't proper
 * nouns, acronyms, numbers ("Week 2", "Cohort 3"), or the start of a new
 * sentence or segment ("Grading · Redo", "Check: Loops").
 */
export function titleCaseWords(text: string, properNouns: Set<string> = PROPER_NOUNS): string[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  const offenders: string[] = []
  const first = tokens.findIndex((token) => /\p{L}/u.test(token))
  for (let index = first + 1; first >= 0 && index < tokens.length; index += 1) {
    const previous = tokens[index - 1]
    const raw = tokens[index]
    const word = raw.replace(/^[("'“‘[]+|[)"'”’.,!?:;…\]]+$/g, '').replace(/['’]s$/, '')
    if (!/^\p{Lu}\p{Ll}/u.test(word)) continue // lowercase, acronym, number, or placeholder
    if (BREAK_BEFORE.test(previous) || previous === '…' || previous.endsWith('…')) continue
    if (properNouns.has(word) || properNouns.has(word.split(/[-/]/)[0])) continue
    const next = tokens[index + 1]
    if (next && /^(#?\d|…)/.test(next)) continue // "Week 2", "Cohort 3", "Module …"
    if (/^\p{Lu}/u.test(raw.replace(/^\W+/, '')) && /[A-Z].*[A-Z]/.test(word)) continue // CamelCase product words
    offenders.push(word)
  }
  return offenders
}

/** True when a string is UI copy worth a sentence-case check (not a sentence-long paragraph). */
export function isLabelLike(item: UiText) {
  if (item.text.length > 60 || /[.!?]\s+\p{Lu}/u.test(item.text)) return false
  if (item.context === 'jsx') return item.ancestors.slice(0, 3).some((tag) => LABEL_ELEMENTS.test(tag))
  return LABEL_CONTEXTS.test(item.context)
}
