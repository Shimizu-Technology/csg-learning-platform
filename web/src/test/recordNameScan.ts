import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import ts from 'typescript'

/*
 * Finds record names rendered as bare text on staff and student pages
 * (redesign §4.4, L-0.2). A "record name" is a property read such as
 * `cohort.name`, `submission.lesson_title` or `request.student.full_name`
 * rendered as a JSX child. It is fine inside a link (`RecordLink`, `Link`,
 * `LinkButton`, `a`) and is skipped inside controls that cannot hold a link
 * (`button`, `summary`, `option`, …). Attributes (`title=`, `aria-label=`)
 * and strings passed to props are not checked.
 */

/** Property names that are a record's name wherever they appear. */
const NAME_PROPS = new Set(['cohort_name', 'lesson_title', 'module_name', 'module_title', 'student_name', 'user_name'])
/** `<receiver>.name` / `.title` / `.full_name` where the receiver is a record of this kind. */
const RECEIVER_NAMES: Array<[RegExp, Set<string>]> = [
  [/^(cohort|selectedCohort)$/, new Set(['name'])],
  [/^(mod|module)$/, new Set(['name', 'title'])],
  [/^(lesson|next_lesson|prev_lesson|nextLesson)$/, new Set(['title'])],
  [/^(student|learner|selectedStudent)$/, new Set(['full_name'])],
]

const LINKS = new Set(['RecordLink', 'Link', 'LinkButton', 'PreviewLink', 'NavLink', 'a'])
/** Controls a link cannot be nested in; their names are reached another way. */
const CONTROLS = new Set(['button', 'Button', 'RowButton', 'TextButton', 'IconButton', 'summary', 'option', 'select', 'label', 'SegmentButton', 'FilterChip'])

export interface RecordNameFinding {
  file: string
  /** The expression as written, e.g. `request.cohort.name`. */
  expression: string
  line: number
}

function receiverName(expression: ts.Expression): string | null {
  const inner = ts.isNonNullExpression(expression) ? expression.expression : expression
  if (ts.isIdentifier(inner)) return inner.text
  if (ts.isPropertyAccessExpression(inner)) return inner.name.text
  return null
}

function isRecordName(node: ts.PropertyAccessExpression) {
  const prop = node.name.text
  if (NAME_PROPS.has(prop)) return true
  const receiver = receiverName(node.expression)
  return Boolean(receiver && RECEIVER_NAMES.some(([pattern, props]) => props.has(prop) && pattern.test(receiver)))
}

function tagName(node: ts.JsxElement | ts.JsxSelfClosingElement) {
  const tag = ts.isJsxElement(node) ? node.openingElement.tagName : node.tagName
  return tag.getText()
}

/** Property reads that end up as rendered text in this child expression. */
function renderedNames(expression: ts.Expression, found: ts.PropertyAccessExpression[]) {
  if (ts.isParenthesizedExpression(expression) || ts.isNonNullExpression(expression)) return renderedNames(expression.expression, found)
  if (ts.isConditionalExpression(expression)) { renderedNames(expression.whenTrue, found); renderedNames(expression.whenFalse, found); return }
  if (ts.isBinaryExpression(expression) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(expression.operatorToken.kind)) {
    // `a && b` renders b; `a || b` and `a ?? b` render either.
    if (expression.operatorToken.kind !== ts.SyntaxKind.AmpersandAmpersandToken) renderedNames(expression.left, found)
    renderedNames(expression.right, found)
    return
  }
  if (ts.isTemplateExpression(expression)) { for (const span of expression.templateSpans) renderedNames(span.expression, found); return }
  if (ts.isPropertyAccessExpression(expression) && isRecordName(expression)) found.push(expression)
}

function insideAllowedElement(node: ts.Node) {
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) || ts.isJsxSelfClosingElement(parent)) {
      const tag = tagName(parent)
      if (LINKS.has(tag) || CONTROLS.has(tag)) return true
    }
    // Stop at the component boundary: a name passed into another component's children is checked there.
    if (ts.isFunctionLike(parent) && !ts.isArrowFunction(parent)) return false
  }
  return false
}

export function scanSource(file: string, source: string): RecordNameFinding[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const findings: RecordNameFinding[] = []
  const visit = (node: ts.Node) => {
    if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) {
      const names: ts.PropertyAccessExpression[] = []
      renderedNames(node.expression, names)
      for (const name of names) {
        if (insideAllowedElement(node)) continue
        findings.push({ file, expression: name.getText(sf).replace(/\?\./g, '.').replace(/!/g, ''), line: sf.getLineAndCharacterOfPosition(name.getStart(sf)).line + 1 })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(sf)
  return findings
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

/** Staff and student page sources, relative to `web/`. */
export function pageSources(webRoot: string) {
  const dirs = ['src/pages/admin', 'src/pages/student', 'src/pages/shared', 'src/components/admin', 'src/components/student']
  return dirs.flatMap((dir) => walk(join(webRoot, dir)))
    .filter((file) => file.endsWith('.tsx') && !/\.test\.tsx$/.test(file))
    .map((file) => relative(webRoot, file))
}

export function scanPages(webRoot: string): RecordNameFinding[] {
  return pageSources(webRoot).flatMap((file) => scanSource(file, readFileSync(join(webRoot, file), 'utf8')))
}
