import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
const root = resolve(__dirname, '../..');
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    // Test fixtures may assert literal colors. Runtime TSX has no exceptions,
    // including code rendering: raw code uses the theme's dedicated code roles.
    return entry.isDirectory() ? entry.name === '__tests__' ? [] : sources(path) : path.endsWith('.tsx') ? [path] : [];
  });
}
it('keeps every runtime TSX color in the theme table and every readable font >=12pt', () => {
  const violations = sources(root).flatMap((path) => {
    const source = readFileSync(path, 'utf8');
    const bad = [...source.matchAll(/#[\da-fA-F]{3,8}\b|rgba?\([\d\s,.]+\)|(?:color|backgroundColor|borderColor):\s*['\"](?:white|black)['\"]|color=\"(?:white|black)\"|\bpalette\b|fontSize:\s*(?:[0-9]|1[01])\b/g)];
    return bad.map((m) => `${relative(root, path)}:${source.slice(0, m.index).split('\n').length}: ${m[0]}`);
  });
  expect(violations).toEqual([]);
});
