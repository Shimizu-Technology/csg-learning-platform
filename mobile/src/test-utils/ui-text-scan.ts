import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import ts from 'typescript';

/*
 * Finds strings a person can read in the app so the glossary (redesign
 * README §2, fixtures/glossary.json) can be checked by test. A heuristic over
 * the syntax tree, not a render. It collects JSX text, string values of
 * copy-like props and object properties (`title`, `label`,
 * `accessibilityLabel`, `placeholder`, `message`…), arguments to Alert and
 * toast calls, strings rendered as JSX children, and every other string
 * literal with a space in it (class-like style strings excluded).
 * Template literals keep their static text; each `${…}` becomes "…".
 */

export interface UiText {
  file: string;
  line: number;
  text: string;
  /** `jsx`, `prop:<name>`, `call:<name>`, `literal`. */
  context: string;
  /** Nearest JSX element, when there is one. */
  element: string | null;
}

const COPY_NAME = /^(title|label|placeholder|message|description|text|hint|caption|subtitle|eyebrow|heading|body|detail|empty\w*|accessibilityLabel|accessibilityHint|headerTitle|headerBackTitle|tabBarLabel|tabBarAccessibilityLabel|confirmLabel|cancelLabel|actionLabel|buttonLabel|emptyTitle|emptyText|helperText|summary|note|reason|status\w*Label|\w+Label|\w+Title|\w+Message|\w+Text|\w+Hint|\w+Copy)$/;
const NOT_COPY = /(Style|ClassName|Color|Id|Key|Url|Href|Path|At)$/;
const COPY_CALL = /^(alert|showToast|toast|success|error|notify|confirm|setError|setNotice|setMessage|setStatus|setFeedback|announceForAccessibility)$/;

const clean = (text: string) => text.replace(/\s+/g, ' ').trim();

function propName(name: ts.PropertyName | ts.JsxAttributeName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name)) return name.text;
  return null;
}

function templateText(node: ts.TemplateExpression) {
  return node.head.text + node.templateSpans.map((span) => `…${span.literal.text}`).join('');
}

function strings(expression: ts.Expression | undefined, found: { node: ts.Node; text: string }[] = []) {
  if (!expression) return found;
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) return strings(expression.expression, found);
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) found.push({ node: expression, text: expression.text });
  else if (ts.isTemplateExpression(expression)) found.push({ node: expression, text: templateText(expression) });
  else if (ts.isConditionalExpression(expression)) { strings(expression.whenTrue, found); strings(expression.whenFalse, found); }
  else if (ts.isBinaryExpression(expression)) {
    const op = expression.operatorToken.kind;
    if (op === ts.SyntaxKind.BarBarToken || op === ts.SyntaxKind.QuestionQuestionToken) { strings(expression.left, found); strings(expression.right, found); }
    else if (op === ts.SyntaxKind.AmpersandAmpersandToken) strings(expression.right, found);
  }
  return found;
}

function elementOf(node: ts.Node): string | null {
  for (let parent: ts.Node | undefined = node.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent)) return parent.openingElement.tagName.getText();
    if (ts.isJsxSelfClosingElement(parent)) return parent.tagName.getText();
    if (ts.isJsxAttribute(parent)) return parent.parent.parent.tagName.getText();
  }
  return null;
}

function calleeName(expression: ts.LeftHandSideExpression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

export function scanUiSource(source: string, file: string): UiText[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found = new Map<ts.Node, UiText>();
  const add = (node: ts.Node, text: string, context: string) => {
    const value = clean(text);
    if (!value || !/\p{L}/u.test(value)) return;
    const existing = found.get(node);
    if (existing && existing.context !== 'literal') return;
    found.set(node, { file, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1, text: value, context, element: elementOf(node) });
  };
  const addAll = (expression: ts.Expression | undefined, context: string) => {
    for (const { node, text } of strings(expression)) add(node, text, context);
  };
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isJsxAttribute(node)) {
      const name = propName(node.name);
      if (name && /style|className|testID/i.test(name)) return;
      if (name && COPY_NAME.test(name) && !NOT_COPY.test(name) && node.initializer) {
        if (ts.isStringLiteral(node.initializer)) add(node.initializer, node.initializer.text, `prop:${name}`);
        else if (ts.isJsxExpression(node.initializer)) addAll(node.initializer.expression, `prop:${name}`);
      }
    } else if (ts.isJsxText(node)) add(node, node.text, 'jsx');
    else if (ts.isJsxExpression(node) && node.expression && (ts.isJsxElement(node.parent) || ts.isJsxFragment(node.parent))) addAll(node.expression, 'jsx');
    else if (ts.isPropertyAssignment(node)) {
      const name = propName(node.name);
      if (name && COPY_NAME.test(name) && !NOT_COPY.test(name)) addAll(node.initializer, `prop:${name}`);
    } else if (ts.isCallExpression(node)) {
      const callee = calleeName(node.expression);
      if (callee && COPY_CALL.test(callee)) for (const arg of node.arguments) addAll(arg, `call:${callee}`);
    }
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateExpression(node)) && !found.has(node)) {
      const text = ts.isTemplateExpression(node) ? templateText(node) : node.text;
      if (/\S\s+\S/.test(text)) add(node, text, 'literal');
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return [...found.values()];
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Non-test sources under `dir`, relative to `root`. */
export function uiSources(root: string, dir: string) {
  return walk(join(root, dir))
    .filter((file) => /\.(ts|tsx)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file) && !/\/(__tests__|__mocks__|test-utils|fixtures)\//.test(file) && !file.endsWith('.d.ts'))
    .map((file) => relative(root, file));
}

export function scanUiFiles(root: string, files: string[]) {
  return files.flatMap((file) => scanUiSource(readFileSync(join(root, file), 'utf8'), file));
}

/* Sentence case */

/** Titles, tab labels, buttons and headings. */
const LABEL_CONTEXT = /^prop:(title|label|headerTitle|tabBarLabel|accessibilityLabel|placeholder|confirmLabel|cancelLabel|actionLabel|buttonLabel|emptyTitle|\w+Label|\w+Title)$/;
const LABEL_ELEMENT = /^(Button|\w+Button|\w+Heading|Heading|ScreenTitle|\w+Title|SectionHeader|\w+Chip|\w+Tab)$/;

export function isLabelLike(item: UiText) {
  if (item.text.length > 60 || /[.!?]\s+\p{Lu}/u.test(item.text)) return false;
  if (item.context === 'jsx') return Boolean(item.element && LABEL_ELEMENT.test(item.element));
  return LABEL_CONTEXT.test(item.context);
}

export const PROPER_NOUNS = new Set([
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun',
  'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December',
  'Jan', 'Feb', 'Mar', 'Apr', 'Jun', 'Jul', 'Aug', 'Sep', 'Sept', 'Oct', 'Nov', 'Dec',
  'Code', 'School', 'Guam', 'Learn', 'Alumni', 'Clerk', 'Google', 'GitHub', 'Zoom', 'Vimeo', 'YouTube', 'Apple', 'App', 'Store', 'Play', 'Android', 'iPhone',
  'Markdown', 'Rich', 'JavaScript', 'TypeScript', 'Python', 'Ruby', 'React', 'Expo', 'Chamorro', 'English', 'Face', 'Settings', 'Safari', 'Chrome',
  'Today', 'Grading', 'Support', 'Messages', 'Updates', 'Content', 'Students', 'Cohorts', 'Recordings', 'Resources', 'Meetings', 'Team', 'Safety', 'Profile',
  'Redo', 'I', 'OK',
]);

const BREAK_BEFORE = /[.!?:·—–|/(“"]$/;

/** Capitalised words after the first that aren't proper nouns, numbers like "Week 2", or a new segment. */
export function titleCaseWords(text: string, properNouns: Set<string> = PROPER_NOUNS): string[] {
  const tokens = text.split(/\s+/).filter(Boolean);
  const first = tokens.findIndex((token) => /\p{L}/u.test(token));
  const offenders: string[] = [];
  for (let index = first + 1; first >= 0 && index < tokens.length; index += 1) {
    const previous = tokens[index - 1];
    const word = tokens[index].replace(/^[("'“‘[]+|[)"'”’.,!?:;…\]]+$/g, '').replace(/['’]s$/, '');
    if (!/^\p{Lu}\p{Ll}/u.test(word)) continue;
    if (BREAK_BEFORE.test(previous) || previous.endsWith('…')) continue;
    if (properNouns.has(word) || properNouns.has(word.split(/[-/]/)[0])) continue;
    const next = tokens[index + 1];
    if (next && /^(#?\d|…)/.test(next)) continue;
    if (/[A-Z].*[A-Z]/.test(word)) continue;
    offenders.push(word);
  }
  return offenders;
}
