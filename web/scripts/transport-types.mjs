import ts from 'typescript';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
// A ratchet for the unfinished inventory. Remove entries as those transports migrate.
const baseline = JSON.parse(await readFile(new URL('./transport-types-baseline.json', import.meta.url), 'utf8'));
export function transportInterfaces(source, filename) {
  const ast = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  const canonical = /^(web\/src\/types\/api|mobile\/src\/lib\/(types|api))\.ts$/.test(filename);
  const found = [];
  function visit(node) {
    if (ts.isInterfaceDeclaration(node) && (canonical || /(?:Response|Payload)$/.test(node.name.text))) found.push(`${filename}:${node.name.text}`);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}
async function walk(dir) {
  const entries = await readdir(path.join(root, dir), { withFileTypes: true });
  return (await Promise.all(entries.map(async entry => {
    const name = `${dir}/${entry.name}`;
    if (entry.isDirectory()) return walk(name);
    if (!/\.tsx?$/.test(name) || /(?:\.generated\.|\.test\.|__tests__|\/fixtures\/)/.test(name)) return [];
    return transportInterfaces(await readFile(path.join(root, name), 'utf8'), name);
  }))).flat();
}
const inventory = (await Promise.all(['web/src', 'mobile/src'].map(walk))).flat().sort();
if (process.argv.includes('--inventory')) console.log(JSON.stringify(inventory, null, 2));
else {
  const added = inventory.filter(name => !baseline.includes(name));
  if (added.length) throw new Error(`Handwritten API response interfaces must use generated schemas:\n${added.join('\n')}`);
}
