// Asserts the first load (every route, including the signed-out landing) does not
// download analytics or other heavy, route-specific vendor chunks. Run after `vite build`.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist/', import.meta.url))
const html = readFileSync(join(dist, 'index.html'), 'utf8')

const entry = html.match(/<script type="module" crossorigin src="\/assets\/([^"]+)"/)?.[1]
assert.ok(entry, 'entry script not found in dist/index.html')
const preloads = [...html.matchAll(/<link rel="modulepreload" crossorigin href="\/assets\/([^"]+)"/g)].map((m) => m[1])

// Follow static imports and re-exports (not dynamic import()) from the entry chunk.
const initial = new Set()
const queue = [entry, ...preloads]
while (queue.length) {
  const file = queue.shift()
  if (initial.has(file)) continue
  initial.add(file)
  const code = readFileSync(join(dist, 'assets', file), 'utf8')
  for (const match of code.matchAll(/(?:^|[;\n}])\s*(?:import|export)\s*(?:[\w${},\s*]+from\s*)?["']\.\/([^"']+\.js)["']/g)) queue.push(match[1])
}

const forbidden = ['vendor-analytics', 'vendor-markdown', 'vendor-richtext', 'vendor-editor', 'vendor-code-runner']
for (const name of forbidden) {
  const hit = [...initial].find((file) => file.startsWith(name))
  assert.equal(hit, undefined, `${name} is in the initial bundle (${[...initial].join(', ')})`)
}
assert.ok([...initial].some((file) => file.startsWith('vendor-react')), 'React should load from its own vendor chunk')
console.log(`initial bundle ok: ${[...initial].join(', ')}`)
