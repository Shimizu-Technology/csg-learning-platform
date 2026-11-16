// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { learnerBreadcrumb, RecordHeader, shareablePath, staffBreadcrumb, type Crumb } from './RecordHeader'

const clipboard = vi.hoisted(() => ({ copyText: vi.fn<(text: string) => Promise<boolean>>() }))
vi.mock('../../lib/clipboard', () => clipboard)

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  clipboard.copyText.mockReset().mockResolvedValue(true)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

function Where() {
  const location = useLocation()
  return <output data-testid="where">{`${location.pathname}${location.search}`}</output>
}

function render(breadcrumb: Crumb[], at = '/admin/submissions/812?cohort_id=3&return_to=%2Fadmin%2Fgrading&queue=redo', extra: Partial<Parameters<typeof RecordHeader>[0]> = {}) {
  act(() => root.render(
    <MemoryRouter initialEntries={[at]}>
      <Routes><Route path="*" element={<><RecordHeader back={{ to: '/admin/grading?filter=redo', label: 'Back to Grading · Redo', fallback: false }} breadcrumb={breadcrumb} type="Submission #812 · attempt 1" title="Make decisions" {...extra} /><Where /></>} /></Routes>
    </MemoryRouter>,
  ))
}

const crumbs = () => [...container.querySelectorAll('nav[aria-label="Breadcrumb"] li')].map((item) => ({
  text: item.textContent,
  href: item.querySelector('a')?.getAttribute('href') ?? null,
  current: item.querySelector('[aria-current="page"]') !== null,
}))

describe('breadcrumbs', () => {
  it.each([
    ['submission', 'Make decisions'],
    ['help request', 'Help request'],
    ['follow-up plan', 'Follow-up plan'],
  ])('staff see Cohort › Student › %s', (_type, record) => {
    render(staffBreadcrumb({ cohort: { label: 'Cohort 3', to: '/admin/cohorts/3' }, student: { label: 'Alex Rivera', to: '/admin/cohorts/3/students/9/overview' }, record }))
    expect(crumbs()).toEqual([
      { text: 'Cohort 3', href: '/admin/cohorts/3', current: false },
      { text: 'Alex Rivera', href: '/admin/cohorts/3/students/9/overview', current: false },
      { text: record, href: null, current: true },
    ])
  })

  it('staff see Cohort › Student on a student workspace, and skip steps with no name yet', () => {
    render(staffBreadcrumb({ cohort: { label: 'Cohort 3', to: '/admin/cohorts/3' }, record: 'Alex Rivera' }))
    expect(crumbs().map((crumb) => crumb.text)).toEqual(['Cohort 3', 'Alex Rivera'])
    render(staffBreadcrumb({ cohort: null, student: { label: 'Alex Rivera', to: null }, record: 'Make decisions' }))
    expect(crumbs()).toEqual([{ text: 'Alex Rivera', href: null, current: false }, { text: 'Make decisions', href: null, current: true }])
  })

  it('learners see Cohort › Learn › Module › Lesson', () => {
    render(learnerBreadcrumb({ cohort: { label: 'Cohort 3', to: '/cohorts/3' }, learn: '/materials?cohort_id=3', module: { label: 'Week 10', to: '/modules/7?cohort_id=3' }, lesson: 'Loops and iteration' }), '/lessons/4?cohort_id=3')
    expect(crumbs()).toEqual([
      { text: 'Cohort 3', href: '/cohorts/3', current: false },
      { text: 'Learn', href: '/materials?cohort_id=3', current: false },
      { text: 'Week 10', href: '/modules/7?cohort_id=3', current: false },
      { text: 'Loops and iteration', href: null, current: true },
    ])
  })

  it('is an ordered list in a labelled nav, hidden on phones where the Back link carries it', () => {
    render(staffBreadcrumb({ cohort: { label: 'Cohort 3', to: '/admin/cohorts/3' }, record: 'Alex Rivera' }))
    const nav = container.querySelector('nav[aria-label="Breadcrumb"]')!
    expect(nav.querySelector('ol')).not.toBeNull()
    expect(nav.className).toContain('hidden')
    expect(nav.className).toContain('sm:block')
    expect(nav.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1)
  })
})

describe('header', () => {
  it('shows the back link, type line, title and context, with 44px targets', () => {
    render([], undefined, { status: <span>Waiting</span>, context: <span>Alex Rivera</span> })
    const back = container.querySelector<HTMLAnchorElement>('[data-back-link]')!
    expect(back.textContent).toBe('Back to Grading · Redo')
    expect(back.getAttribute('href')).toBe('/admin/grading?filter=redo')
    expect(back.className).toContain('min-h-11')
    expect(container.querySelector('[data-record-type]')?.textContent).toBe('Submission #812 · attempt 1')
    expect(container.querySelector('h1')?.textContent).toBe('Make decisions')
    expect(container.textContent).toContain('Waiting')
    expect(container.textContent).toContain('Alex Rivera')
  })

  it('follows the back link in place', () => {
    render([])
    act(() => container.querySelector<HTMLAnchorElement>('[data-back-link]')!.click())
    expect(container.querySelector('[data-testid="where"]')?.textContent).toBe('/admin/grading?filter=redo')
  })

  it('renders an h2 when the page already has an h1', () => {
    render([], undefined, { headingLevel: 2 })
    expect(container.querySelector('h1')).toBeNull()
    expect(container.querySelector('h2')?.textContent).toBe('Make decisions')
  })

  it('shows queue position with named previous and next buttons', () => {
    const onNext = vi.fn()
    render([], undefined, { queue: { position: '3 of 9', onNext, nextLabel: 'Next submission', previousLabel: 'Previous submission' } })
    expect(container.textContent).toContain('3 of 9')
    const previous = container.querySelector<HTMLButtonElement>('button[aria-label="Previous submission"]')!
    expect(previous.disabled).toBe(true)
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Next submission"]')!.click())
    expect(onNext).toHaveBeenCalledOnce()
  })
})

describe('copy link', () => {
  it('copies the record without where this viewer came from and confirms in place', async () => {
    render([])
    const button = container.querySelector<HTMLButtonElement>('[data-copy-link]')!
    expect(button.textContent).toBe('Copy link')
    await act(async () => button.click())
    expect(clipboard.copyText).toHaveBeenCalledWith(`${window.location.origin}/admin/submissions/812?cohort_id=3`)
    expect(button.textContent).toBe('Link copied')
    expect(container.querySelector('[role="status"]')?.textContent).toBe('Link copied')
  })

  it('says so when the copy fails', async () => {
    clipboard.copyText.mockResolvedValue(false)
    render([])
    await act(async () => container.querySelector<HTMLButtonElement>('[data-copy-link]')!.click())
    expect(container.textContent).toContain("Couldn't copy the link. Copy it from the address bar instead.")
  })

  it('copies an explicit path, or hides when there is nothing to share', async () => {
    render([], '/announcements/7?tab=inbox', { copyPath: '/announcements/7' })
    await act(async () => container.querySelector<HTMLButtonElement>('[data-copy-link]')!.click())
    expect(clipboard.copyText).toHaveBeenCalledWith(`${window.location.origin}/announcements/7`)
    render([], undefined, { copyPath: false })
    expect(container.querySelector('[data-copy-link]')).toBeNull()
  })

  it('strips every origin key from the shareable path', () => {
    expect(shareablePath({ pathname: '/admin/submissions/1', search: '?return_to=%2Fadmin&from=%2Fadmin&queue=all&queue_cohort_id=3&student_id=4' })).toBe('/admin/submissions/1?student_id=4')
  })

  it('keeps only each record type\'s identity and scope, dropping sign-in tickets, tokens, redirects and junk', () => {
    const junk = '__clerk_ticket=sekrit&token=abc&redirect_url=https%3A%2F%2Fevil.example&utm_source=mail&return_to=%2Fadmin&foo=bar'
    const cases: [string, string, string, string][] = [
      ['/lessons/12', `?cohort_id=3&${junk}`, '#block-44', '/lessons/12?cohort_id=3#block-44'],
      ['/lessons/12', `?${junk}`, '#comments', '/lessons/12'],
      ['/admin/submissions/812', `?cohort_id=3&${junk}`, '', '/admin/submissions/812?cohort_id=3'],
      ['/admin/help-requests/5', `?cohort_id=3&${junk}`, '', '/admin/help-requests/5?cohort_id=3'],
      ['/admin/interventions/9', `?${junk}`, '', '/admin/interventions/9'],
      ['/admin/cohorts/3', `?tab=activity&${junk}`, '', '/admin/cohorts/3?tab=activity'],
      ['/admin/cohorts/3/students/7/work', `?objective=2&plan_id=x&${junk}`, '', '/admin/cohorts/3/students/7/work?objective=2'],
      ['/admin/cohorts/3/modules/4/grading', `?view=queue&review=812&student=7&filter=all&${junk}`, '', '/admin/cohorts/3/modules/4/grading?view=queue&filter=all&student=7&review=812'],
      ['/admin/something-new', `?${junk}`, '', '/admin/something-new'],
    ]
    for (const [pathname, search, hash, expected] of cases) {
      const shared = shareablePath({ pathname, search, hash })
      expect(shared, pathname).toBe(expected)
      expect(shared).not.toMatch(/clerk|token|redirect|utm|return_to|foo|evil/)
    }
    // A repeated or non-numeric scope is dropped rather than guessed.
    expect(shareablePath({ pathname: '/lessons/12', search: '?cohort_id=3&cohort_id=4' })).toBe('/lessons/12')
    expect(shareablePath({ pathname: '/admin/submissions/812', search: '?cohort_id=3%20OR%201' })).toBe('/admin/submissions/812')
  })
})
