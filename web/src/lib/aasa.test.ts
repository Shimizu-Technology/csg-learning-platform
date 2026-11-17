import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { expect, it } from 'vitest'
const association = JSON.parse(readFileSync('public/.well-known/apple-app-site-association', 'utf8'))
const paths: string[] = association.applinks.details[0].paths
const matches = (pattern: string, path: string) => new RegExp('^' + pattern.split('*').map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$').test(path)
const claims = (path: string) => { for (const rule of paths) if (matches(rule.replace(/^NOT /, ''), path)) return !rule.startsWith('NOT '); return false }
it('claims no public Route in App, including any future public route', () => {
  const source = ts.createSourceFile('App.tsx', readFileSync('src/App.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const publicPaths: string[] = []
  function walk(node: ts.Node) {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(source) === 'Routes') {
      for (const child of node.children) if (ts.isJsxSelfClosingElement(child) && child.tagName.getText(source) === 'Route') {
        const attr = child.attributes.properties.find(a => ts.isJsxAttribute(a) && a.name.getText(source) === 'path')
        if (attr && ts.isJsxAttribute(attr) && attr.initializer && ts.isStringLiteral(attr.initializer) && attr.initializer.text !== '*') publicPaths.push(attr.initializer.text)
      }
    }
    ts.forEachChild(node, walk)
  }
  walk(source)
  expect(publicPaths).toEqual(expect.arrayContaining(['/', '/privacy', '/terms', '/account-deletion', '/courses', '/courses/:slug']))
  for (const path of publicPaths) for (const url of [path, path.replace(/\/$/, '') + '/new-public-child']) expect(claims(url), url).toBe(false)
  expect(paths).not.toContain('/*')
})
it.each(['/courses', '/courses/python-fundamentals'])('keeps public course browsing in Safari: %s', path => expect(claims(path)).toBe(false))
it.each(['/lessons/42', '/modules/7', '/messages/dm/3', '/meetings', '/admin/submissions/7'])('keeps native learning links %s', path => expect(claims(path)).toBe(true))
