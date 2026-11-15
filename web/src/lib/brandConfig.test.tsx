import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import ts from 'typescript'
import { afterEach, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { brand, createBrand } from './brand'
import { renderBrandTemplate } from '../../brand-build'

afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
it('preserves deployed defaults and escapes generated metadata', () => {
  expect(brand).toMatchObject({ schoolName: 'Code School of Guam', productName: 'CSG Learn', supportEmail: 'codeschoolofguam@gmail.com', logoSrc: '/CSG-Logo.png' })
  const custom = createBrand({ VITE_SCHOOL_NAME: 'A "School" <test>', VITE_PRODUCT_NAME: 'Example Learn' })
  expect(renderBrandTemplate('<title>%%schoolName%%</title>', custom)).toBe('<title>A &quot;School&quot; &lt;test&gt;</title>')
  expect(JSON.parse(renderBrandTemplate('{"name":"%%schoolName%%"}', custom, 'json')).name).toBe(custom.schoolName)
})
it('renders a component using build overrides', async () => {
  vi.stubEnv('VITE_PRODUCT_NAME', 'Example Learn')
  vi.stubEnv('VITE_SCHOOL_NAME', 'Example School')
  vi.resetModules()
  const { BrandLink } = await import('../components/brand/PublicChrome')
  const html = renderToStaticMarkup(<MemoryRouter><BrandLink /></MemoryRouter>)
  expect(html).toContain('Example Learn home')
  expect(html).toContain('Example School')
  expect(html).not.toContain('Code School of Guam')
})
it('keeps application brand literals in brand.ts (fixtures explicitly allowed)', () => {
  const offenders: string[] = []
  const root = resolve(__dirname, '..')
  function visit(dir: string) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = resolve(dir, entry.name)
      if (entry.isDirectory()) { if (entry.name !== '__snapshots__') visit(path); continue }
      if (!/\.tsx?$/.test(path) || /\.test\.|\/lib\/(brand|markdownFixtures)\.ts$/.test(path)) continue
      const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true)
      function check(node: ts.Node) {
        if ((ts.isStringLiteralLike(node) || ts.isJsxText(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && /\bCode School\b|CSG Learn|codeschoolofguam\.com|codeschoolofguam@gmail\.com/.test(node.getText(source))) offenders.push(path)
        ts.forEachChild(node, check)
      }
      check(source)
    }
  }
  visit(root)
  const webRoot = resolve(root, '..')
  for (const file of ['index.html', ...readdirSync(resolve(webRoot, 'brand-public')).map((name) => `brand-public/${name}`)]) {
    if (/\bCode School\b|CSG Learn|codeschoolofguam\.com|codeschoolofguam@gmail\.com/.test(readFileSync(resolve(webRoot, file), 'utf8'))) offenders.push(file)
  }
  expect(offenders).toEqual([])
})
it('validates URLs, trims values and escapes each output context', () => {
  expect(createBrand({ VITE_SCHOOL_NAME: ' Example ', VITE_APP_URL: ' https://example.org/ ' })).toMatchObject({ schoolName: 'Example', appUrl: 'https://example.org' })
  for (const key of ['VITE_APP_URL', 'VITE_LEGACY_APP_URL', 'VITE_SCHOOL_SITE_URL', 'VITE_SCHOOL_COURSES_URL']) {
    for (const value of ['not a URL', 'javascript:alert(1)', 'http://example.org', 'https://example.org/\n/evil']) {
      expect(() => createBrand({ [key]: value })).toThrow(key)
    }
    expect(() => createBrand({ [key]: '   ' })).not.toThrow()
  }
  expect(() => createBrand({ VITE_APP_URL: 'https://example.org/path' })).toThrow('origin')
  const custom = createBrand({ VITE_PRODUCT_NAME: "School's \\ Learn", VITE_APP_URL: 'https://example.org' })
  const literal = renderBrandTemplate("'%%productName%%'", custom, 'js')
  expect(Function('return ' + literal)()).toBe(custom.productName)
  expect(renderBrandTemplate('<loc>%%siteUrl%%</loc>', createBrand({ VITE_SCHOOL_SITE_URL: 'https://example.org/?a=1&b=2' }), 'xml')).toContain('&amp;')
  expect(() => renderBrandTemplate('%%appUrl%%', { ...custom, appUrl: 'https://example.org/\n/evil' }, '_redirects')).toThrow()
})
it('preserves the original single-quoted service worker fallback snippet', () => {
  const worker = renderBrandTemplate(readFileSync(resolve(__dirname, '../../brand-public/sw.js'), 'utf8'), createBrand(), 'js')
  expect(worker).toContain("data = { title: 'CSG Learn', body: event.data.text() };")
  expect(worker).toContain("const title = data.title || 'CSG Learn';")
})
