import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Plugin } from 'vite'
import { createBrand } from './src/lib/brand'

type Brand = ReturnType<typeof createBrand>
const htmlEscape = (s: string) => s.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
export function renderBrandTemplate(source: string, brand: Brand, kind = 'html'): string {
  const replace = (text: string, escape: (s: string) => string) => text.replace(/%%(\w+)%%/g, (_, key: keyof Brand) => escape(brand[key]))
  const jsonEscape = (s: string) => JSON.stringify(s).slice(1, -1).replaceAll('<', '\\u003c')
  if (kind === 'json' || kind === 'js') return replace(source, jsonEscape)
  if (kind !== 'html') return replace(source, (s) => s)
  return replace(source.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g,
    (_, json: string) => `<script type="application/ld+json">${replace(json, jsonEscape)}</script>`), htmlEscape)
}
export function schoolBrandPlugin(env: Record<string, string>): Plugin {
  const brand = createBrand(env)
  const dir = resolve(__dirname, 'brand-public')
  const files = readdirSync(dir)
  const render = (name: string) => renderBrandTemplate(readFileSync(resolve(dir, name), 'utf8'), brand, name.split('.').pop())
  return {
    name: 'school-brand',
    transformIndexHtml: { order: 'pre', handler: (html) => renderBrandTemplate(html, brand) },
    generateBundle() {
      for (const name of files) this.emitFile({ type: 'asset', fileName: name, source: render(name) })
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const name = req.url?.split('?')[0].slice(1)
        if (!name || !files.includes(name)) return next()
        const types: Record<string, string> = { json: 'application/json', js: 'text/javascript', html: 'text/html', xml: 'application/xml', txt: 'text/plain' }
        res.setHeader('Content-Type', types[name.split('.').pop() || ''] || 'text/plain')
        res.end(render(name))
      })
    },
  }
}
