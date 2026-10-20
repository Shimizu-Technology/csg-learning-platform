import { describe, expect, it } from 'vitest'
import { isHafaStarterLink, lessonReturnUrl, withLessonReturn } from './hafaStarterLinks'

const PAYLOAD = 'z.FcxBCsIwEIXhq4S3UhAP0AvozgMYF0ETMpjOhOl0UUrBQ3jCnqTJ8vH9vBVGViIGPJQiWzASdvvv7xLpZE5nxgVf4k9L6mJZ-k5U4oThuaIGy01yLEWudWn2FrZ21HMltpPHvaNLKqO7zWH0OHvG9toO'
const STARTER = `https://code.shimizu-technology.com/?lang=python#project=${PAYLOAD}&starter=csg-python-pilot%3Aorientation`
const LESSON = { url: 'https://learn.codeschoolofguam.com/lessons/419?cohort_id=5#block-901', label: 'Orientation — your first run' }

function hashParams(href: string) {
  return new URLSearchParams(new URL(href).hash.slice(1))
}

describe('isHafaStarterLink', () => {
  it('recognizes Hafa Code project and starter links', () => {
    expect(isHafaStarterLink(STARTER)).toBe(true)
    expect(isHafaStarterLink(`https://code.shimizu-technology.com/#project=${PAYLOAD}`)).toBe(true)
    expect(isHafaStarterLink('https://code.shimizu-technology.com/?lang=python&starter=csg-python-pilot:project')).toBe(true)
  })

  it('ignores other links, look-alike hosts and unsafe schemes', () => {
    for (const href of [
      undefined,
      '',
      'https://code.shimizu-technology.com/',
      'https://code.shimizu-technology.com/?lang=python',
      `http://code.shimizu-technology.com/#project=${PAYLOAD}`,
      `https://code.shimizu-technology.com.evil.example/#project=${PAYLOAD}`,
      `https://code.shimizu-technology.com@evil.example/#project=${PAYLOAD}`,
      `https://user:pass@code.shimizu-technology.com/#project=${PAYLOAD}`,
      `https://code.shimizu-technology.com:8443/#project=${PAYLOAD}`,
      `javascript:alert(1)//https://code.shimizu-technology.com/#project=${PAYLOAD}`,
      `/relative#project=${PAYLOAD}`,
      'https://example.com/#project=abc&starter=x',
    ]) {
      expect(isHafaStarterLink(href), String(href)).toBe(false)
    }
  })
})

describe('withLessonReturn', () => {
  it('appends the lesson URL and title to the hash without changing the starter', () => {
    const href = withLessonReturn(STARTER, LESSON)
    expect(href.startsWith(`${STARTER}&return=`)).toBe(true)
    const params = hashParams(href)
    expect(params.get('project')).toBe(PAYLOAD)
    expect(params.get('starter')).toBe('csg-python-pilot:orientation')
    expect(params.get('return')).toBe(LESSON.url)
    expect(params.get('returnLabel')).toBe('Orientation — your first run')
    expect(new URL(href).search).toBe('?lang=python')
  })

  it('creates a hash when the starter is in the query string', () => {
    const href = withLessonReturn('https://code.shimizu-technology.com/?lang=python&starter=csg-python-pilot:project', LESSON)
    expect(href).toMatch(/^https:\/\/code\.shimizu-technology\.com\/\?lang=python&starter=csg-python-pilot:project#return=/)
    expect(hashParams(href).get('return')).toBe(LESSON.url)
  })

  it('ignores surrounding whitespace in an authored href', () => {
    const href = withLessonReturn(`  ${STARTER}\n`, LESSON)
    expect(href.startsWith(`${STARTER}&return=`)).toBe(true)
    expect(hashParams(href).get('returnLabel')).toBe(LESSON.label)
  })

  it('leaves links that already name a return untouched', () => {
    const inHash = `${STARTER}&return=https%3A%2F%2Flearn.codeschoolofguam.com%2Flessons%2F7`
    const inQuery = `https://code.shimizu-technology.com/?lang=python&return=https%3A%2F%2Flearn.codeschoolofguam.com%2Flessons%2F7#project=${PAYLOAD}`
    expect(withLessonReturn(inHash, LESSON)).toBe(inHash)
    expect(withLessonReturn(inQuery, LESSON)).toBe(inQuery)
  })

  it('leaves non-starter links untouched', () => {
    for (const href of ['https://code.shimizu-technology.com/', 'https://example.com/#project=abc', 'mailto:help@example.com', 'javascript:alert(1)']) {
      expect(withLessonReturn(href, LESSON)).toBe(href)
    }
  })

  it('does not add an unsafe or missing return', () => {
    expect(withLessonReturn(STARTER, null)).toBe(STARTER)
    expect(withLessonReturn(STARTER, { url: 'javascript:alert(1)', label: 'x' })).toBe(STARTER)
    expect(withLessonReturn(STARTER, { url: '/lessons/1', label: 'x' })).toBe(STARTER)
  })

  it('cleans the label and omits an empty one', () => {
    expect(hashParams(withLessonReturn(STARTER, { url: LESSON.url, label: '  Lesson\n2 \u0007 values  ' })).get('returnLabel')).toBe('Lesson 2 values')
    expect(hashParams(withLessonReturn(STARTER, { url: LESSON.url, label: ' ' })).has('returnLabel')).toBe(false)
    expect(hashParams(withLessonReturn(STARTER, { url: LESSON.url, label: 'x'.repeat(200) })).get('returnLabel')).toHaveLength(80)
  })
})

describe('lessonReturnUrl', () => {
  it('keeps origin, path, cohort_id and the block anchor only', () => {
    expect(lessonReturnUrl({ origin: 'https://learn.codeschoolofguam.com', pathname: '/lessons/419', search: '?cohort_id=5&token=secret' }, 'block-901'))
      .toBe('https://learn.codeschoolofguam.com/lessons/419?cohort_id=5#block-901')
    expect(lessonReturnUrl({ origin: 'https://learn.codeschoolofguam.com', pathname: '/lessons/419', search: '?token=secret' }))
      .toBe('https://learn.codeschoolofguam.com/lessons/419')
  })

  it('drops a malformed cohort id or anchor', () => {
    expect(lessonReturnUrl({ origin: 'http://localhost:5451', pathname: '/lessons/1', search: '?cohort_id=5%26x%3D1' }, 'block 1"><script>'))
      .toBe('http://localhost:5451/lessons/1')
  })
})
