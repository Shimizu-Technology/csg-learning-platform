import { build } from 'esbuild'
const { outputFiles } = await build({
  stdin: {
    contents: "export { createBrand } from './src/lib/brand.ts'; export { renderBrandTemplate } from './brand-build.ts'",
    resolveDir: fileURLToPath(new URL('..', import.meta.url)),
  },
  bundle: true, write: false, platform: 'node', format: 'esm',
  define: { 'import.meta.env': '{}' },
})
const { createBrand, renderBrandTemplate } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`)
const brand = createBrand()

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const redirectsPath = fileURLToPath(
  new URL('../brand-public/_redirects', import.meta.url),
)
const redirects = renderBrandTemplate(await readFile(redirectsPath, 'utf8'), brand, '_redirects')
  .split('\n')
  .map((line) => line.trim())
  .filter((line) => line && !line.startsWith('#'))
  .map((line) => {
    const [from, to, status] = line.split(/\s+/)
    return { from, to, status }
  })

const canonicalRule = {
  from: `${brand.legacyAppUrl}/*`,
  to: `${brand.appUrl}/:splat`,
  status: '301!',
}
const directFileRules = [
  '/robots.txt',
  '/sitemap.xml',
  '/manifest.json',
  '/sw.js',
]
const spaFallback = { from: '/*', to: '/index.html', status: '200' }

assert.deepEqual(
  redirects[0],
  canonicalRule,
  'the exact production hostname redirect must remain first',
)
assert.deepEqual(
  redirects.at(-1),
  spaFallback,
  'the SPA fallback must remain the final redirect rule',
)

for (const path of directFileRules) {
  const ruleIndex = redirects.findIndex(
    (rule) => rule.from === path && rule.to === path && rule.status === '200',
  )
  assert.ok(ruleIndex > 0, `${path} must be served directly`)
  assert.ok(
    ruleIndex < redirects.length - 1,
    `${path} must remain above the SPA fallback`,
  )
}

function applyCanonicalRedirect(requestUrl) {
  const request = new URL(requestUrl)
  const source = new URL(canonicalRule.from.replace('*', ''))

  if (request.origin !== source.origin) return null

  const splat = request.pathname.slice(source.pathname.length)
  const destination = canonicalRule.to.replace(':splat', splat)

  return {
    location: `${destination}${request.search}`,
    status: canonicalRule.status,
  }
}

assert.deepEqual(
  applyCanonicalRedirect(
    `${brand.legacyAppUrl}/cohorts/3/lesson?tab=notes`,
  ),
  {
    location:
      `${brand.appUrl}/cohorts/3/lesson?tab=notes`,
    status: '301!',
  },
  'the canonical redirect must preserve the path and query string',
)
assert.deepEqual(
  applyCanonicalRedirect(`${brand.legacyAppUrl}/`),
  { location: `${brand.appUrl}/`, status: '301!' },
  'the canonical redirect must handle the site root',
)

for (const isolatedHost of [
  `https://preview.example.org/sign-in`,
  `https://branch.example.org/sign-in`,
  `${brand.appUrl}/sign-in`,
]) {
  assert.equal(
    applyCanonicalRedirect(isolatedHost),
    null,
    `${new URL(isolatedHost).hostname} must not match the production hostname`,
  )
}

console.log('Netlify routing checks passed.')
