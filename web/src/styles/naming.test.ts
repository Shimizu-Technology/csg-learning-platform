import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import glossary from '../../../fixtures/glossary.json'
import { isLabelLike, proseLiterals, scanUiFiles, titleCaseWords, uiSources, type UiText } from '../test/uiTextScan'

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

/*
 * The glossary (redesign README §2, `fixtures/glossary.json`): retired names
 * must not appear in UI copy. The scanner (src/test/uiTextScan.ts) reads JSX
 * text, copy-like props and attributes, toasts, label functions, and every
 * string literal with a space in it. It is a heuristic: a pass means "no
 * known retired names", not proof.
 *
 * Adding an exception: when the word means something else in that file (block
 * a user, a Markdown code block, an upload part), add
 * `'<file> <term>': '<why>'` below, where <term> is the `term` from
 * glossary.json. Exceptions that no longer match fail the test.
 */
const TERM_EXCEPTIONS: Record<string, string> = {
  'src/pages/Legal.tsx Record (developer word)': 'Legal text: "learning records" is the defined data category in the privacy policy and terms',
  'src/components/auth/CommunityStandardsGate.tsx Record (developer word)': 'Quotes the privacy policy category "learning records"',
  'src/pages/student/Profile.tsx Record (developer word)': 'Account deletion request: "class records" matches the privacy policy wording',
  'src/pages/admin/Moderation.tsx Record (developer word)': 'Account deletion checklist uses the privacy policy category "learning records"',
  'src/pages/admin/TeamManagement.tsx Record (developer word)': 'Archiving a teammate: "messages and records remain" is the data-retention promise',
  'src/components/admin/StudentAccess.tsx Record (developer word)': 'Removing an enrollment: "learning and support records" is the data-retention promise',
  'src/pages/admin/LessonEditor.tsx Block counts for learners': 'Staff-only block lesson editor: "block" is the authoring term for pieces of a lesson (README §2), never a learner progress count',
  'src/pages/admin/lessonEditor/BlockCard.tsx Block counts for learners': 'Staff-only block lesson editor: "block" is the authoring term for pieces of a lesson (README §2), never a learner progress count',
  'src/pages/admin/lessonEditor/Inspector.tsx Block counts for learners': 'Staff-only block lesson editor: "block" is the authoring term for pieces of a lesson (README §2), never a learner progress count',
}

const ENUM_HUMANIZERS = new Set(['src/lib/glossary.ts', 'src/lib/learnerLabels.ts', 'src/lib/schoolTime.ts', 'src/lib/pushNotifications.ts'])

const sources = uiSources(webRoot, 'src')
const uiText = scanUiFiles(webRoot, sources)
const copy: UiText[] = [...new Map([...uiText, ...sources.flatMap((file) => proseLiterals(readFileSync(join(webRoot, file), 'utf8'), file))]
  .map((item) => [`${item.file}:${item.line}:${item.text}`, item])).values()]

describe('glossary', () => {
  const retired = glossary.retired.map((entry) => ({ ...entry, regex: new RegExp(entry.pattern, entry.flags) }))

  it('finds the copy it checks', () => {
    expect(uiText.length).toBeGreaterThan(1500)
    expect(copy.some((item) => item.text === 'Today')).toBe(true)
  })

  it('uses one name per concept: no retired names in UI copy', () => {
    const offending = copy.flatMap((item) => retired
      .filter((entry) => entry.regex.test(item.text) && !TERM_EXCEPTIONS[`${item.file} ${entry.term}`])
      .map((entry) => `${item.file}:${item.line} "${item.text.slice(0, 120)}" uses ${entry.term}; use ${entry.use}`))
    expect(offending.sort().join('\n')).toBe('')
  })

  it('keeps every exception in use', () => {
    const stale = Object.keys(TERM_EXCEPTIONS).filter((key) => {
      const [file, ...rest] = key.split(' ')
      const entry = retired.find((item) => item.term === rest.join(' '))
      return !entry || !copy.some((item) => item.file === file && entry.regex.test(item.text))
    })
    expect(stale).toEqual([])
  })

  it('shows stored values through a label, never as raw enum text', () => {
    const offending = sources.filter((file) => !ENUM_HUMANIZERS.has(file))
      .flatMap((file) => readFileSync(join(webRoot, file), 'utf8').split('\n')
        .map((line, index) => ({ line, at: `${file}:${index + 1}` }))
        .filter(({ line }) => /replaceAll\(\s*['"]_['"]\s*,\s*['"] ['"]\s*\)|replace\(\s*\/_\/g\s*,\s*['"] ['"]\s*\)/.test(line))
        .map(({ at }) => `${at}: use humanize() or a label map from lib/glossary`))
    expect(offending.join('\n')).toBe('')
  })
})

/*
 * Sentence case for every title, button, tab, label and menu item (README §2,
 * U-6.6): "Save changes", not "Save Changes". Proper nouns, product names and
 * the names of places in the app ("Back to Today") keep their capitals; see
 * PROPER_NOUNS in src/test/uiTextScan.ts. Add a word there when it is a name.
 */
describe('sentence case', () => {
  it('detects Title Case', () => {
    expect(titleCaseWords('Save Changes')).toEqual(['Changes'])
    expect(titleCaseWords('Add team member')).toEqual([])
    expect(titleCaseWords('Back to Today')).toEqual([])
    expect(titleCaseWords('Week 2 · Loops')).toEqual([])
    expect(titleCaseWords('Message Audreana', new Set([...['Audreana']]))).toEqual([])
  })

  it('writes labels, buttons, headings and titles in sentence case', () => {
    const offending = uiText.filter(isLabelLike)
      .map((item) => ({ item, words: titleCaseWords(item.text) }))
      .filter(({ words }) => words.length > 0)
      .map(({ item, words }) => `${item.file}:${item.line} "${item.text}" (${words.join(', ')})`)
    expect(offending.join('\n')).toBe('')
  })
})
