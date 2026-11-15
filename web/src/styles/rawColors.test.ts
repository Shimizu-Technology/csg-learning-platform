import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/*
 * Raw colours lint (U-6.1, design spec §7). Components use colour roles only
 * (bg-surface-raised, text-ink, border-line, text-danger-ink, bg-media …),
 * so every screen works in light and dark. This fails on:
 *
 * - Tailwind palette utilities: bg-surface-raised, text-ink-secondary, bg-danger-solid,
 *   ring-black/5, from-sky-400 …
 * - the old numbered ramps that only had light values: text-primary-ink,
 *   bg-action-primary, bg-warning-soft, text-success-ink …
 * - arbitrary colour values: bg-[#fff], text-[rgb(0_0_0)] …
 * - hex colours in TypeScript, except files that mirror tokens for a
 *   third-party API and are checked against index.css by their own test.
 *
 * Adding an exception: only for something that can't take a role (a
 * third-party widget's API, for example). Add `'<file>': '<why>'` below.
 */
const HEX_ALLOWED: Record<string, string> = {
  'src/lib/themeColors.ts': 'theme-color meta values for the browser chrome; asserted against index.css in theme.test.ts',
  'src/lib/clerkAppearance.ts': "Clerk's appearance API takes colour strings, not CSS variables; asserted against index.css in clerkAppearance.test.ts",
  'src/lib/theme.ts': 'Monaco theme colours (its API needs hex); asserted against index.css in theme.test.ts',
}

const PALETTE = 'white|black|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose'
const RAMPS = 'ruby|primary|success|warning|danger|info|pending'
const UTILITIES = 'bg|text|border(?:-[trblxyse])?|ring(?:-offset)?|outline|divide|from|via|to|fill|stroke|decoration|placeholder|accent|caret|shadow|inset-shadow|drop-shadow'

const RAW_CLASS = new RegExp(
  `(?<![\\w-])(?:${UTILITIES})-(?:(?:${PALETTE})(?:-\\d{2,3})?|(?:${RAMPS})-\\d{2,3})(?:\\/\\d+)?(?![\\w-])`,
  'g',
)
const ARBITRARY_COLOR = new RegExp(`(?<![\\w-])(?:${UTILITIES})-\\[(?:#|rgb|hsl|oklch|color:)[^\\]]*\\]`, 'g')
const HEX = /['"`]#[0-9a-fA-F]{3,8}['"`]/g

const root = resolve(__dirname, '../..')

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sources(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) && !path.includes(`${join('src', 'test')}`) ? [path] : []
  })
}

export function findRawColors(source: string, allowHex = false) {
  const lines = source.split('\n')
  const hits: string[] = []
  lines.forEach((line, index) => {
    // "#812" in a comment is a record number, not a colour.
    const comment = /^\s*(\/\/|\/?\*)/.test(line)
    for (const pattern of allowHex || comment ? [RAW_CLASS, ARBITRARY_COLOR] : [RAW_CLASS, ARBITRARY_COLOR, HEX]) {
      for (const match of line.matchAll(pattern)) hits.push(`${index + 1}: ${match[0]}`)
    }
  })
  return hits
}

describe('raw colours lint', () => {
  it('finds raw palette, ramp, arbitrary and hex colours, and leaves roles alone', () => {
    expect(findRawColors('className="bg-white text-slate-600 hover:bg-red-600/90 ring-black/5"').map((hit) => hit.split(': ')[1]))
      .toEqual(['bg-white', 'text-slate-600', 'bg-red-600/90', 'ring-black/5'])
    expect(findRawColors("tone: 'bg-warning-50 text-success-700 border-ruby-200 bg-primary-600'")).toHaveLength(4)
    expect(findRawColors('className="bg-[#fff] text-[rgb(0_0_0)]"')).toHaveLength(2)
    expect(findRawColors("const color = '#1e1e1e'")).toHaveLength(1)
    expect(findRawColors("const color = '#1e1e1e'", true)).toHaveLength(0)
    expect(findRawColors('className="bg-surface-raised text-ink border-line text-danger-ink bg-warning-soft bg-action-primary text-on-action bg-media/80 ring-ink/5 text-primary-ink"')).toEqual([])
    // Words that only look like colours are not utilities.
    expect(findRawColors('const whiteSpace = "white-space"; label="Black History Month"; id="text-whitelist"')).toEqual([])
  })

  it('no component uses a raw colour', () => {
    const failures: string[] = []
    for (const file of sources(join(root, 'src'))) {
      const name = relative(root, file).replaceAll('\\', '/')
      const hits = findRawColors(readFileSync(file, 'utf8'), name in HEX_ALLOWED)
      failures.push(...hits.map((hit) => `${name}:${hit}`))
    }
    expect(failures, 'Use a colour role from index.css (bg-surface-raised, text-ink-secondary, text-danger-ink …)').toEqual([])
  })

  it('keeps every hex exception in use', () => {
    for (const file of Object.keys(HEX_ALLOWED)) {
      expect(readFileSync(join(root, file), 'utf8'), file).toMatch(HEX)
    }
  })

  it('keeps raw colours in index.css inside the token blocks', () => {
    const css = readFileSync(join(root, 'src/index.css'), 'utf8')
    const outside = css
      // Token declarations (--csg-*, --color-*, shadows) may hold literal colours.
      .replace(/^\s*--[\w-]+:[^;]*;/gm, '')
      // The self-hosted font notice and comments.
      .replace(/\/\*[\s\S]*?\*\//g, '')
    expect(outside.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/g) || []).toEqual([])
    // @apply lines follow the same rule as class names.
    const applied = [...css.matchAll(/@apply ([^;]+);/g)].map((match) => match[1]).join(' ')
    expect(findRawColors(applied)).toEqual([])
  })
})
