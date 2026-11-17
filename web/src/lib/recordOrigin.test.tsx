// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { backLinkText, originFromParams, originLabel, useBackLink, type BackLink } from './recordOrigin'

describe('originLabel', () => {
  it.each([
    ['/admin', 'Today'],
    ['/dashboard', 'Today'],
    ['/admin/grading', 'Grading'],
    ['/admin/grading?filter=redo&cohort_id=3', 'Grading · Redo'],
    ['/admin/grading?filter=all', 'Grading · All submissions'],
    ['/admin/support?view=resolved', 'Support'],
    ['/admin/students?cohort_id=2', 'Students'],
    ['/admin/cohorts', 'Cohorts'],
    ['/admin/cohorts/3', 'Cohort'],
    ['/admin/cohorts/3?tab=activity', 'Activity'],
    ['/admin/cohorts/3/students/9/work', 'Student page'],
    ['/admin/cohorts/3/modules/2/grading?view=grid', 'Module grading'],
    ['/admin/submissions/812', 'Submission'],
    ['/admin/help-requests/4', 'Help request'],
    ['/admin/interventions/5', 'Follow-up plan'],
    ['/materials?cohort_id=3', 'Learn'],
    ['/modules/7', 'Module'],
    ['/messages/dm/12', 'conversation'],
    ['/announcements?scope=manage', 'Updates'],
    ['/announcements?tab=inbox&inbox_page=3', 'Notifications'],
  ])('names %s "%s"', (path, label) => {
    expect(originLabel(path)).toBe(label)
  })

  it('returns null for pages it does not know', () => {
    expect(originLabel('/somewhere/else')).toBeNull()
  })
})

describe('backLinkText', () => {
  it('adds "Back to" once', () => {
    expect(backLinkText('Today')).toBe('Back to Today')
    expect(backLinkText('Back to matrix cell')).toBe('Back to matrix cell')
  })
})

describe('originFromParams', () => {
  it('derives the label from the validated path, never from the URL', () => {
    expect(originFromParams('?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo')).toEqual({ returnTo: '/admin/grading?filter=redo', returnLabel: 'Grading · Redo' })
    expect(originFromParams('?from=%2Fadmin')).toEqual({ returnTo: '/admin', returnLabel: 'Today' })
    expect(originFromParams('?return_to=%2Fsomewhere&return_label=Phishing')).toEqual({ returnTo: '/somewhere', returnLabel: 'Back' })
  })

  it.each([
    '//evil.example/admin',
    'https://evil.example/admin',
    'javascript:alert(1)',
    '/\\evil.example',
    '%2F%2Fevil.example',
    '/%2F%2Fevil.example',
    '/sign-in?redirect=/admin',
    '/admin\u0000',
  ])('rejects the unsafe origin %s', (value) => {
    expect(originFromParams(`?return_to=${encodeURIComponent(value)}`)).toBeNull()
  })

  it('accepts only Activity paths when the page says so', () => {
    expect(originFromParams('?return_to=%2Fadmin%2Fsupport', 'activity')).toBeNull()
    expect(originFromParams('?return_to=%2Fadmin%2Factivity', 'activity')).toEqual({ returnTo: '/admin/activity', returnLabel: 'Activity' })
  })
})

describe('useBackLink', () => {
  let container: HTMLDivElement
  let root: Root
  let result: BackLink
  const fallback = { returnTo: '/admin/support', returnLabel: 'Support' }

  beforeEach(() => {
    sessionStorage.clear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })
  afterEach(() => {
    act(() => root.unmount())
    container.remove()
  })

  function Probe({ accept }: { accept?: 'any' | 'activity' }) {
    result = useBackLink(fallback, { accept })
    return null
  }
  function render(entry: string | { pathname: string; search?: string; state?: unknown }, accept?: 'any' | 'activity') {
    // A new key per entry remounts the router, so each call starts at its own URL.
    act(() => root.render(<MemoryRouter key={JSON.stringify([entry, accept])} initialEntries={[entry]}><Probe accept={accept} /></MemoryRouter>))
    return result
  }

  it('uses the label the linking page sent as router state', () => {
    expect(render({ pathname: '/admin/help-requests/4', state: { returnTo: '/admin/cohorts/3', returnLabel: 'Cohort 3' } })).toEqual({ to: '/admin/cohorts/3', label: 'Back to Cohort 3', fallback: false })
  })

  it('prefers router state when it names the same page as return_to', () => {
    expect(render({ pathname: '/admin/submissions/8', search: '?return_to=%2Fadmin%2Fgrading%3Ffilter%3Dredo', state: { returnTo: '/admin/grading?filter=redo', returnLabel: 'Grading · Redo' } }).label).toBe('Back to Grading · Redo')
  })

  it.each([
    ['%2Fadmin', 'Back to Today'],
    ['%2Fadmin%2Fgrading%3Ffilter%3Dredo', 'Back to Grading · Redo'],
    ['%2Fadmin%2Fcohorts%2F3', 'Back to Cohort'],
    ['%2Fadmin%2Factivity', 'Back to Activity'],
    ['%2Fmessages%2Fdm%2F4', 'Back to conversation'],
  ])('labels return_to=%s as "%s"', (returnTo, label) => {
    expect(render(`/admin/help-requests/4?return_to=${returnTo}`).label).toBe(label)
  })

  it('falls back to the parent with no origin', () => {
    expect(render('/admin/help-requests/4')).toEqual({ to: '/admin/support', label: 'Back to Support', fallback: true })
  })

  it('falls back when return_to or router state is unsafe', () => {
    expect(render('/admin/help-requests/4?return_to=%2F%2Fevil.example').to).toBe('/admin/support')
    expect(render('/admin/help-requests/4?return_to=https%3A%2F%2Fevil.example%2Fadmin').to).toBe('/admin/support')
    expect(render({ pathname: '/admin/help-requests/4', state: { returnTo: '//evil.example', returnLabel: 'Today' } })).toEqual({ to: '/admin/support', label: 'Back to Support', fallback: true })
  })

  it('ignores non-Activity return_to on pages that only honour Activity', () => {
    expect(render('/admin/cohorts/3?return_to=%2Fadmin%2Fsupport', 'activity').label).toBe('Back to Support')
    expect(render('/admin/cohorts/3?return_to=%2Fadmin%2Factivity', 'activity').label).toBe('Back to Activity')
  })
  it('legacy inbox state is a safe return origin for every record', () => {
    let result: BackLink | undefined
    function Record() { result = useBackLink({ returnTo: '/materials', returnLabel: 'Learn' }); return null }
    act(() => root.render(<MemoryRouter initialEntries={[{ pathname: '/lessons/2', state: { from: '/announcements?tab=inbox&inbox_page=3' } }]}><Record /></MemoryRouter>))
    expect(result).toMatchObject({ to: '/announcements?tab=inbox&inbox_page=3', label: 'Back to Notifications' })
  })

})
