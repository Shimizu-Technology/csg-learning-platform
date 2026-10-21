import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

// The override lets CI/local proof run these exact guards against an archived ref.
const root = process.env.CSG_THEME_GUARD_ROOT ?? resolve(__dirname, '../..');
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? entry.name === '__tests__' ? [] : files(path) : path.endsWith('.tsx') ? [path] : [];
  });
}
const foregrounds = new Set(['color', 'foregroundColor', 'thumbColor', 'tintColor', 'placeholderTextColor']);
function unwrap(node: ts.Node): ts.Node {
  return ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
}
function themeToken(node: ts.Node): string | null {
  const value = unwrap(node).getText().replace(/\s/g, '');
  return /^(?:c|colors|theme\.colors)\.[\w.]+$/.test(value) ? value : null;
}
export function semanticViolations(source: string, filename = 'fixture.tsx') {
  const file = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const violations: string[] = [];
  const report = (node: ts.Node, kind: string) => violations.push(`${file.getLineAndCharacterOfPosition(node.getStart()).line + 1}: ${kind}`);
  const switchNames = new Set(['Switch']);
  const bindings = new Map<string, ts.Expression>();
  const collect = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) bindings.set(node.name.text, node.initializer);
    node.forEachChild(collect);
  };
  collect(file);
  file.forEachChild((node) => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier) && node.moduleSpecifier.text === 'react-native') {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) for (const item of bindings.elements) if ((item.propertyName ?? item.name).text === 'Switch') switchNames.add(item.name.text);
    }
  });
  const visit = (node: ts.Node) => {
    let foreground: ts.Node | undefined;
    if (ts.isShorthandPropertyAssignment(node) && foregrounds.has(node.name.text)) foreground = node.name;
    if (ts.isPropertyAssignment(node) && foregrounds.has(node.name.getText().replace(/['"]/g, ''))) foreground = node.initializer;
    if (ts.isJsxAttribute(node) && foregrounds.has(node.name.getText())) foreground = node.initializer;
    if (foreground) {
      const seen = new Set<ts.Node>();
      const property = (node: ts.Node, key: string): ts.Node[] => {
        node = unwrap(node);
        if (ts.isIdentifier(node) && bindings.has(node.text)) return property(bindings.get(node.text)!, key);
        if (ts.isConditionalExpression(node)) return [...property(node.whenTrue, key), ...property(node.whenFalse, key)];
        if (ts.isObjectLiteralExpression(node)) {
          const item = node.properties.find((item) => ts.isPropertyAssignment(item) && item.name.getText().replace(/['"]/g, '') === key);
          return item && ts.isPropertyAssignment(item) ? [item.initializer] : [];
        }
        return [];
      };
      const inspect = (value: ts.Node) => {
        if (seen.has(value)) return;
        seen.add(value);
        if (ts.isPropertyAccessExpression(value)) {
          if (/^(?:c|colors|theme\.colors)\.surface\./.test(value.getText().replace(/\s/g, ''))) report(value, 'surface used as foreground');
          // Resolve only this foreground property, never the background sibling.
          else for (const resolved of property(value.expression, value.name.text)) inspect(resolved);
          return;
        }
        if (ts.isIdentifier(value) && bindings.has(value.text)) inspect(bindings.get(value.text)!);
        else value.forEachChild(inspect);
      };
      inspect(foreground);
    }
    if (ts.isConditionalExpression(node)) {
      const yes = themeToken(node.whenTrue);
      if (yes && yes === themeToken(node.whenFalse)) report(node, 'identical state tokens');
    }
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && switchNames.has(node.tagName.getText())) {
      const shared = node.attributes.properties.some((attr) => ts.isJsxSpreadAttribute(attr) && ts.isCallExpression(attr.expression) && attr.expression.expression.getText() === 'switchColors');
      // No runtime exceptions: native switches must use one tested on/off recipe.
      if (!shared) report(node, 'Switch missing switchColors');
      if (node.attributes.properties.some((attr) => ts.isJsxAttribute(attr) && ['trackColor', 'thumbColor', 'ios_backgroundColor'].includes(attr.name.getText()))) report(node, 'Switch overrides shared colors');
    }
    node.forEachChild(visit);
  };
  visit(file);
  return violations;
}
it('rejects semantic foreground and state regressions in all runtime TSX', () => {
  expect(files(root).flatMap((path) => semanticViolations(readFileSync(path, 'utf8'), path).map((issue) => `${relative(root, path)}:${issue}`))).toEqual([]);
});
it('detects syntax variants rather than only one text spelling', () => {
  const bad = `const s = {color: c.surface.raised, tintColor: colors.surface.sunken};
    <Icon color={active ? c.surface.page : c.text.body} placeholderTextColor={theme.colors.surface.raised} />;
    const state = active ? (c.text.body) : c.text.body;
    <Switch value={on} />;`;
  expect(semanticViolations(bad)).toHaveLength(6);
  expect(semanticViolations('<Switch {...switchColors(c, on)} value={on} />')).toEqual([]);
  expect(semanticViolations("const color = urgent ? c.surface.sunken : c.text.body; const s = { color };")).toHaveLength(1);
  expect(semanticViolations("const tone = {fg:c.text.body, bg:c.surface.sunken}; const s = {color:tone.fg};")).toEqual([]);
  expect(semanticViolations('import {Switch as Toggle} from \"react-native\"; <Toggle />;')).toHaveLength(1);
});
