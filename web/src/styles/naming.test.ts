import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * One product name on the web: "CSG Learn". The native app's store name is out
 * of scope, but it must not appear in the web app; the retired web names must
 * not come back.
 */
const RETIRED = /CSG Connect|CSG Learning Hub|CSG Learning Platform|CSG Learning\b/

/** Catch URL-encoded variants too (for example a mailto subject). */
function safeDecode(line: string) {
  try {
    return decodeURIComponent(line)
  } catch {
    return line.replace(/%20/g, ' ')
  }
}

const webRoot = resolve(__dirname, '../..')

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry)
    return statSync(path).isDirectory() ? walk(path) : [path]
  })
}

const files = [
  ...walk(join(webRoot, 'src')).filter((file) => /\.(ts|tsx|css)$/.test(file) && !/\.test\.(ts|tsx)$/.test(file)),
  ...walk(join(webRoot, 'public')).filter((file) => /\.(json|html|js|txt|xml)$/.test(file)),
  join(webRoot, 'index.html'),
]

describe('product naming', () => {
  it('scans the web UI sources', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it('uses "CSG Learn" only (no CSG Connect / Learning Hub / Learning Platform / CSG Learning)', () => {
    const offending = files.flatMap((file) => readFileSync(file, 'utf8')
      .split('\n')
      .map((line, index) => ({ line, at: `${file.replace(`${webRoot}/`, '')}:${index + 1}` }))
      .filter(({ line }) => RETIRED.test(line) || RETIRED.test(safeDecode(line)))
      .map(({ line, at }) => `${at}: ${line.trim()}`))
    expect(offending).toEqual([])
  })
})
