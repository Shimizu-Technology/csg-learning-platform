// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

import { applySurface, invitationDestination, PRODUCT_NAME, SURFACE_THEME_COLORS, surfaceForPath } from './brand'

const indexHtml = readFileSync(resolve(__dirname, '../../index.html'), 'utf8')

const PATHS: Array<[string, 'public' | 'app']> = [
  ['/', 'public'],
  ['/sign-in', 'public'],
  ['/sign-in/factor-one', 'public'],
  ['/sign-up', 'public'],
  ['/courses', 'public'],
  ['/privacy', 'public'],
  ['/terms', 'public'],
  ['/account-deletion', 'public'],
  ['/dashboard', 'app'],
  ['/materials', 'app'],
  ['/sign-insurance', 'app'],
  ['/admin', 'app'],
  ['/messages/dm/3', 'app'],
]

describe('surfaces', () => {
  it.each(PATHS)('%s uses the %s surface', (path, surface) => {
    expect(surfaceForPath(path)).toBe(surface)
  })

  it('index.html boot script classifies routes exactly like surfaceForPath', () => {
    const source = indexHtml.match(/var PUBLIC_SURFACE = (\/.+\/);/)?.[1]
    expect(source).toBeTruthy()
    const pattern = new Function(`return ${source}`)() as RegExp
    for (const [path, surface] of PATHS) {
      expect(pattern.test(path) ? 'public' : 'app', path).toBe(surface)
    }
  })

  it('sets data-surface and the theme-color meta for the status bar', () => {
    applySurface('/sign-in')
    expect(document.documentElement.dataset.surface).toBe('public')
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(SURFACE_THEME_COLORS.public)
    applySurface('/dashboard')
    expect(document.documentElement.dataset.surface).toBe('app')
    expect(document.querySelectorAll('meta[name="theme-color"]')).toHaveLength(1)
    expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe('#ffffff')
  })

  it('matches the CSG site cream on public surfaces', () => {
    expect(SURFACE_THEME_COLORS.public).toBe('#faf7f0')
    expect(indexHtml).toContain("isPublic ? '#faf7f0' : '#ffffff'")
  })
})

describe('invitation links', () => {
  it('sends a sign-up ticket to the sign-up page with the query intact', () => {
    expect(invitationDestination('?__clerk_ticket=abc&__clerk_status=sign_up')).toBe('/sign-up?__clerk_ticket=abc&__clerk_status=sign_up')
  })

  it('sends returning users to sign-in', () => {
    expect(invitationDestination('?__clerk_ticket=abc&__clerk_status=sign_in')).toBe('/sign-in?__clerk_ticket=abc&__clerk_status=sign_in')
  })

  it('defaults to sign-up when the status is missing', () => {
    expect(invitationDestination('?__clerk_ticket=abc')).toBe('/sign-up?__clerk_ticket=abc')
  })

  it('ignores ordinary visits', () => {
    expect(invitationDestination('')).toBeNull()
    expect(invitationDestination('?utm_source=csg-site')).toBeNull()
  })
})

describe('index.html', () => {
  it('uses the one product name in title and meta', () => {
    expect(indexHtml).toContain(`<title>${PRODUCT_NAME} | Code School of Guam</title>`)
    expect(indexHtml).toContain('viewport-fit=cover')
    expect(indexHtml).toContain('apple-mobile-web-app-status-bar-style" content="default"')
  })

  it('renders a branded boot shell with a reload offer instead of a blank page', () => {
    expect(indexHtml).toMatch(/<div id="root">\s*<div id="boot-shell"/)
    expect(indexHtml).toContain('Reload')
    expect(indexHtml).toMatch(/setTimeout\([\s\S]*boot-slow[\s\S]*8000\)/)
  })
})

describe('first-load budget', () => {
  it('does not preload the display font (it delayed LCP on slow 3G)', () => {
    expect(indexHtml).not.toMatch(/rel\s*=\s*['"]?preload['"]?[\s\S]{0,200}newsreader|font\.rel = 'preload'/i)
  })
})
