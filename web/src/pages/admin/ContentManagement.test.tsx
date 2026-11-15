// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const session = vi.hoisted(() => ({ user: { is_admin: true } as { is_admin: boolean } }))
const mocks = vi.hoisted(() => ({ createModule: vi.fn(), createExercise: vi.fn(), updateCurriculum: vi.fn(), createCurriculum: vi.fn(), deleteCurriculum: vi.fn(), confirm: vi.fn(), getAccessibleCohorts: vi.fn(), getCurricula: vi.fn(), getCurriculum: vi.fn(), updateModule: vi.fn(), reorderModules: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => session }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: mocks.error, success: mocks.success }) }))
vi.mock('../../contexts/UploadContext', () => ({ useUpload: () => ({ attachUpload: vi.fn() }) }))
vi.mock('./CourseResourcesPanel', () => ({ CourseResourcesPanel: () => null }))
vi.mock('./NewExerciseModal', () => ({ NewExerciseModal: (props: { defaultWeek: number; defaultDayIndex: number; onCreate: (data: { title: string }) => Promise<void> }) => <><div data-testid="exercise-placement">{props.defaultWeek}:{props.defaultDayIndex}</div><button onClick={() => void props.onCreate({ title: "New exercise" })}>Create test exercise</button></> }))
import { ContentManagement } from './ContentManagement'

let container: HTMLDivElement
let root: Root
const lessons = [0, 2, 4].map((release_day, index) => ({ id: index + 1, title: `Exercise ${index + 1}`, release_day, position: index, content_blocks_count: 1, lesson_type: 'exercise', archived_at: null, updated_at: '2026-10-22' }))
const module = { id: 10, name: 'Foundations', module_type: 'live_class', position: 0, schedule_days: 'mwf', week_count: 1, updated_at: '2026-10-22', lessons }
beforeEach(() => {
  vi.clearAllMocks()
  session.user = { is_admin: true }
  mocks.confirm.mockResolvedValue(true)
  mocks.getAccessibleCohorts.mockResolvedValue({ data: { cohorts: [] } })
  mocks.getCurricula.mockResolvedValue({ data: { curricula: [{ id: 1, name: 'Python', status: 'active', modules_count: 1 }] } })
  mocks.getCurriculum.mockResolvedValue({ data: { curriculum: { id: 1, name: 'Python', status: 'active', modules: [module] } } })
  mocks.updateModule.mockResolvedValue({ data: { module: { schedule_days: 'weekdays', updated_at: '2026-10-23' } } })
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.restoreAllMocks() })
const button = (text: string) => Array.from(container.querySelectorAll('button')).find(item => item.textContent?.includes(text))!
async function mount() { await act(async () => root.render(<MemoryRouter><ContentManagement /></MemoryRouter>)); await act(async () => button('Foundations').click()) }
async function changeSchedule() {
  const select = container.querySelector<HTMLSelectElement>('select[aria-label="Schedule pattern for Foundations"]')!
  await act(async () => { select.value = 'weekdays'; select.dispatchEvent(new Event('change', { bubbles: true })) })
}
it('confirms added slots, keeps exercise days, and exposes empty-day authoring only after expansion', async () => {
  const confirm = mocks.confirm
  await mount(); mocks.getCurriculum.mockResolvedValue({ data: { curriculum: { id: 1, name: 'Python', status: 'active', modules: [{ ...module, schedule_days: 'weekdays' }] } } }); await changeSchedule()
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ description: 'Adds Tuesday/Thursday slots. Existing exercises keep their days.' }))
  expect(mocks.updateModule).toHaveBeenCalledWith(10, { schedule_days: 'weekdays', base_updated_at: '2026-10-22' })
  expect(Array.from(container.querySelectorAll('h4')).map(item => item.textContent)).toEqual(['Day 1 · Monday', 'Day 3 · Wednesday', 'Day 5 · Friday'])
  expect(button('Show empty days (2)').getAttribute('aria-expanded')).toBe('false')
  await act(async () => button('Show empty days (2)').click())
  const tuesday = Array.from(container.querySelectorAll('h4')).find(item => item.textContent?.includes('Tuesday'))!.parentElement!.parentElement!
  await act(async () => tuesday.querySelector<HTMLButtonElement>('button')!.click())
  expect(container.querySelector('[data-testid="exercise-placement"]')?.textContent).toBe('1:1')
  await act(async () => button('Hide empty days').click())
  expect(container.textContent).not.toContain('Tuesday')
  expect(container.textContent).toContain('Exercise 3')
})
it('cancels schedule changes before writing and surfaces server narrowing errors', async () => {
  mocks.confirm.mockResolvedValue(false)
  await mount(); await changeSchedule()
  expect(mocks.updateModule).not.toHaveBeenCalled()
  mocks.confirm.mockResolvedValue(true)
  mocks.updateModule.mockResolvedValue({ error: 'Schedule days would exclude 2 restorable lessons' })
  await changeSchedule()
  expect(mocks.error).toHaveBeenCalledWith('Schedule days would exclude 2 restorable lessons')
  expect(container.querySelector<HTMLSelectElement>('select[aria-label="Schedule pattern for Foundations"]')!.value).toBe('mwf')
})


it('sends complete module permutations for keyboard and drag reordering and keeps server errors visible', async () => {
  mocks.getCurriculum.mockResolvedValue({ data: { curriculum: { id: 1, name: 'Python', status: 'active', modules: [module, { ...module, id: 20, name: 'Next', position: 1 }] } } })
  mocks.reorderModules.mockResolvedValue({ error: 'Order could not be saved' })
  await mount()
  const down = container.querySelector<HTMLButtonElement>('button[aria-label="Move Foundations down"]')!
  await act(async () => { down.focus(); down.click() })
  expect(mocks.reorderModules).toHaveBeenLastCalledWith(1, [20, 10])
  expect(mocks.error).toHaveBeenCalledWith('Order could not be saved')
  const source = container.querySelector('[aria-label="Drag Next"]')!
  const target = container.querySelector('[aria-label="Drag Foundations"]')!.parentElement!.parentElement!
  const transfer = { type: '', value: '', setData(type: string, value: string) { this.type = type; this.value = value }, getData(type: string) { return type === this.type ? this.value : '' } }
  await act(async () => {
    const start = new Event('dragstart', { bubbles: true }); Object.defineProperty(start, 'dataTransfer', { value: transfer }); source.dispatchEvent(start)
    const drop = new Event('drop', { bubbles: true }); Object.defineProperty(drop, 'dataTransfer', { value: transfer }); target.dispatchEvent(drop)
  })
  expect(transfer.type).toBe('application/x-csg-module-id')
  expect(mocks.reorderModules).toHaveBeenLastCalledWith(1, [20, 10])
})

it('refocuses the moved module in the available direction after reload', async () => {
  const next = { ...module, id: 20, name: 'Next', position: 1 }
  mocks.getCurriculum.mockResolvedValueOnce({ data: { curriculum: { id: 1, name: 'Python', status: 'active', modules: [module, next] } } })
  mocks.getCurriculum.mockResolvedValue({ data: { curriculum: { id: 1, name: 'Python', status: 'active', modules: [next, module] } } })
  mocks.reorderModules.mockResolvedValue({ data: {} })
  await mount()
  const down = container.querySelector<HTMLButtonElement>('button[aria-label="Move Foundations down"]')!
  await act(async () => { down.focus(); down.click() })
  expect(document.activeElement).toBe(container.querySelector('button[aria-label="Move Foundations up"]'))
})
it('cancels reordering before saving when active self-paced learners are affected', async () => {
  mocks.getCurriculum.mockResolvedValue({ data: { curriculum: { id: 1, name: 'Python', status: 'active', active_self_paced_learners: true, modules: [module, { ...module, id: 20, name: 'Next' }] } } })
  const confirm = mocks.confirm.mockResolvedValue(false)
  await mount()
  await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Move Foundations down"]')!.click())
  expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ description: "Reordering changes active self-paced learners' next lesson. Save this order?" }))
  expect(mocks.reorderModules).not.toHaveBeenCalled()
})
it('shows Edit to an instructor only on curricula an admin gave them editing access for, in Calendar and Sequence', async () => {
  session.user = { is_admin: false }
  const granted = { can_edit: true, reason: 'granted', message: null, grants: [], shared_with: [] }
  const editButton = () => container.querySelector('[aria-label="Edit Exercise 1"]')
  const cases = [
    { editing: granted, badge: 'You can edit', canEdit: true },
    { editing: { ...granted, can_edit: false, reason: 'shared' }, badge: 'Read only: shared with other cohorts', canEdit: false },
    { editing: { ...granted, can_edit: false, reason: 'no_grant', grants: [] }, badge: null, canEdit: false },
  ]
  for (const { editing, badge, canEdit } of cases) {
    act(() => root.unmount()); root = createRoot(container)
    mocks.getCurriculum.mockResolvedValue({ data: { curriculum: { id: 1, name: 'Python', status: 'active', modules: [module], editing } } })
    await mount()
    for (const view of ['Calendar', 'Sequence']) {
      await act(async () => button(view).click())
      expect(button(view).getAttribute('aria-pressed')).toBe('true')
      if (badge) expect(container.textContent).toContain(badge)
      expect(Boolean(editButton()), `${editing.reason} instructor, ${view}`).toBe(canEdit)
      expect(container.querySelector('[aria-label="Preview Exercise 1 as a student"]')).toBeTruthy()
    }
    expect(container.querySelector('select[aria-label="Schedule pattern for Foundations"]')).toBeNull()
  }
})

it('scrolls a curriculum search deep link after loading while preserving module URL state', async () => {
  const scroll = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  await act(async () => root.render(<MemoryRouter initialEntries={['/admin/content?open=10#curriculum-1']}><ContentManagement /></MemoryRouter>))
  expect(scroll).toHaveBeenCalledWith({ block: 'start' })
  expect(button('Foundations').getAttribute('aria-expanded')).toBe('true')
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

it('loads only selected detail and lists Active, Draft, Archived in separate groups', async () => {
  mocks.getCurricula.mockResolvedValue({ data: { curricula: [
    { id: 3, name: 'Archived course', status: 'archived', modules_count: 0 },
    { id: 2, name: 'Draft course', status: 'draft', modules_count: 0 },
    { id: 1, name: 'Python', status: 'active', modules_count: 1 }
  ] } })
  await mount()
  expect(mocks.getCurriculum.mock.calls.map(call => call[0])).toEqual([1])
  const rail = container.querySelector('nav[aria-label="Curricula"]')!
  expect(Array.from(rail.querySelectorAll('button[aria-current], button.my-1')).map(b => b.textContent?.split('0 modules')[0].split('1 modules')[0])).toEqual(['Python', 'Draft course', 'Archived course'])
  await act(async () => Array.from(rail.querySelectorAll('button')).find(b => b.textContent === 'Draft')!.click())
  expect(rail.textContent).not.toContain('Archived course')
  expect(rail.textContent).toContain('Draft course')
})

it('renders visible editor and preview anchors with return context and readable block counts', async () => {
  await mount()
  const edit = container.querySelector<HTMLAnchorElement>('a[aria-label="Edit Exercise 1"]')!
  const preview = container.querySelector<HTMLAnchorElement>('a[aria-label="Preview Exercise 1 as a student"]')!
  expect(edit.getAttribute('href')).toBe('/admin/lessons/1/edit')
  expect(preview.getAttribute('href')).toContain('preview=true')
  expect(container.textContent).toContain('1 block')
  expect(container.textContent).not.toContain('1b')
})

it('defaults self-paced curricula to a sortable sequence and restores open/week URL state', async () => {
  mocks.getAccessibleCohorts.mockResolvedValue({ data: { cohorts: [{ id: 4, name: 'Self-paced', curriculum_id: 1, course_delivery: 'self_paced' }] } })
  await act(async () => root.render(<MemoryRouter initialEntries={['/admin/content?curriculum=1&pane=detail&open=10&week=10:1']}><ContentManagement /></MemoryRouter>))
  expect(button('Sequence').getAttribute('aria-pressed')).toBe('true')
  expect(button('Foundations').getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelector('section[aria-label="Lesson sequence"]')).not.toBeNull()
  expect(container.querySelector('select')?.textContent).toContain('All cohorts')
  expect(container.querySelector('button[title="Add a new week"]')).toBeNull()
})

it('uses the shared confirmation for deletion and retains the curriculum on server refusal', async () => {
  mocks.deleteCurriculum.mockResolvedValue({ error: 'Curriculum has learner files' })
  await mount()
  mocks.confirm.mockResolvedValue(false)
  await act(async () => button('Delete curriculum').click())
  expect(mocks.deleteCurriculum).not.toHaveBeenCalled()
  mocks.confirm.mockResolvedValue(true)
  await act(async () => button('Delete curriculum').click())
  expect(mocks.deleteCurriculum).toHaveBeenCalledWith(1)
  expect(mocks.error).toHaveBeenCalledWith('Curriculum has learner files')
  expect(container.textContent).toContain('Python')
})

it('restores a later saved week from the URL with real lesson links', async () => {
  mocks.getCurriculum.mockResolvedValue({ data: { curriculum: { id: 1, name: 'Python', status: 'active', modules: [{ ...module, lessons: [...lessons, { ...lessons[0], id: 99, title: 'Week fourteen exercise', release_day: 91 }] }] } } })
  await act(async () => root.render(<MemoryRouter initialEntries={['/admin/content?curriculum=1&pane=detail&open=10&week=10:14']}><ContentManagement /></MemoryRouter>))
  expect(container.querySelector('button[role="tab"][aria-selected="true"]')?.textContent).toBe('Week 14')
  expect(container.querySelector('a[aria-label="Edit Week fourteen exercise"]')?.getAttribute('href')).toBe('/admin/lessons/99/edit')
})

function LocationProbe() {
  const location = useLocation()
  const navigate = useNavigate()
  return <><output data-testid="url">{location.pathname}{location.search}{location.hash}</output>
    {location.pathname.includes('/lessons/') && <button onClick={() => navigate((location.state as { returnTo: string }).returnTo)}>Return to content</button>}
  </>
}
async function renderAt(url: string) {
  await act(async () => root.render(<MemoryRouter initialEntries={[url]}><LocationProbe /><Routes>
    <Route path="/admin/content" element={<ContentManagement />} />
    <Route path="/admin/lessons/:id/edit" element={<LocationProbe />} />
  </Routes></MemoryRouter>))
}
const urlText = () => container.querySelector('[data-testid="url"]')!.textContent!
async function inputValue(input: HTMLInputElement, value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

it.each(['?curriculum=999&pane=detail', '#curriculum-999'])('replaces an unknown curriculum and falls back without requesting it: %s', async suffix => {
  await renderAt('/admin/content' + suffix)
  expect(urlText()).not.toContain('999')
  expect(container.querySelector('h2[tabindex="-1"]')?.textContent).toBe('Python')
  expect(mocks.getCurriculum.mock.calls.map(call => call[0])).toEqual([1])
  expect(container.textContent).not.toContain('Retry')
})
it('clears an unknown cohort after accessible cohorts load', async () => {
  await renderAt('/admin/content?cohort=999&pane=detail')
  expect(urlText()).not.toContain('cohort=')
  expect(container.querySelector('nav')?.textContent).toContain('Python')
  expect(container.querySelector('select')?.value).toBe('')
})
it('aborts a late reload and preserves the selection when switching curricula', async () => {
  const summaries = [{ id: 1, name: 'Python', status: 'active' }, { id: 2, name: 'Self paced', status: 'active' }]
  mocks.getCurricula.mockResolvedValue({ data: { curricula: summaries } })
  const detail = (id: number) => ({ data: { curriculum: { ...summaries[id - 1], modules: [module, { ...module, id: 20, name: 'Next' }] } } })
  mocks.getCurriculum.mockImplementation(async (id: number) => detail(id))
  mocks.reorderModules.mockResolvedValue({ data: {} })
  await renderAt('/admin/content?curriculum=1&pane=detail')
  let release!: (value: unknown) => void
  mocks.getCurriculum.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
  await act(async () => container.querySelector<HTMLButtonElement>('[aria-label="Move Foundations down"]')!.click())
  const signal = mocks.getCurriculum.mock.calls.at(-1)![1] as AbortSignal
  await act(async () => button('Self paced').click())
  expect(signal.aborted).toBe(true)
  await act(async () => release(detail(1)))
  expect(container.querySelector('h2[tabindex="-1"]')?.textContent).toBe('Self paced')
  expect(container.textContent).not.toContain('Retry')
})
it('fetches a curriculum deep link once and consumes its hash', async () => {
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: vi.fn() })
  await renderAt('/admin/content?open=10#curriculum-1')
  expect(mocks.getCurriculum).toHaveBeenCalledTimes(1)
  expect(urlText()).toContain('curriculum=1')
  expect(urlText()).not.toContain('#')
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})
it('keeps next exercise placement based on all lessons and allows collapsing search results', async () => {
  await renderAt('/admin/content?curriculum=1&pane=detail&open=10')
  await inputValue(container.querySelector('input[type="search"][class*="mt-1"]')!, 'Exercise 1')
  await act(async () => button('Exercise').click())
  expect(container.querySelector('[data-testid="exercise-placement"]')?.textContent).toBe('2:0')
  await act(async () => button('Foundations').click())
  expect(button('Foundations').getAttribute('aria-expanded')).toBe('false')
})
it('uses global usage aggregates even when no cohorts are accessible', async () => {
  mocks.getCurricula.mockResolvedValue({ data: { curricula: [{ id: 1, name: 'Python', status: 'active', cohorts_count: 3, course_delivery_modes: ['self_paced'] }] } })
  await renderAt('/admin/content?curriculum=1&pane=detail&open=10')
  expect(button('Sequence').getAttribute('aria-pressed')).toBe('true')
  expect(container.querySelector('nav')?.textContent).toContain('3 cohorts')
})
it('returns from the editor with filters, open module and saved week intact', async () => {
  const initial = '/admin/content?curriculum=1&pane=detail&open=10&week=10:1&status=active'
  await renderAt(initial)
  await act(async () => container.querySelector<HTMLAnchorElement>('a[aria-label="Edit Exercise 1"]')!.click())
  expect(urlText()).toBe('/admin/lessons/1/edit')
  await act(async () => button('Return to content').click())
  expect(urlText()).toBe(initial)
  expect(button('Foundations').getAttribute('aria-expanded')).toBe('true')
  expect(container.querySelector('a[aria-label="Edit Exercise 1"]')).not.toBeNull()
})
it('jumps to a newly created curriculum and removes filters hiding it', async () => {
  const created = { id: 9, name: 'Created course', status: 'draft', modules: [] }
  mocks.createCurriculum.mockResolvedValue({ data: { curriculum: created } })
  await renderAt('/admin/content?status=active&pane=detail')
  mocks.getCurricula.mockResolvedValue({ data: { curricula: [created] } })
  mocks.getCurriculum.mockResolvedValue({ data: { curriculum: created } })
  await act(async () => button('New curriculum').click())
  await inputValue(container.querySelector('input[placeholder="e.g. Full Stack Web Development"]') || container.querySelector('[aria-modal] input')!, 'Created course')
  await act(async () => container.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(mocks.createCurriculum).toHaveBeenCalled()
  expect(urlText()).toContain('curriculum=9')
  expect(urlText()).not.toContain('status=active')
  expect(container.querySelector('h2[tabindex="-1"]')?.textContent).toBe('Created course')
})

it('does not intercept shortcuts already handled or while a modal is open', async () => {
  await renderAt('/admin/content?curriculum=1&pane=detail')
  const handled = new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true, cancelable: true })
  handled.preventDefault()
  await act(async () => window.dispatchEvent(handled))
  expect(urlText()).toContain('pane=detail')
  await act(async () => button('New curriculum').click())
  await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', metaKey: true, bubbles: true, cancelable: true })))
  expect(urlText()).toContain('pane=detail')
})
it('closes the curriculum menu on Escape and outside pointer down', async () => {
  await renderAt('/admin/content?curriculum=1&pane=detail')
  const summary = container.querySelector<HTMLElement>('summary[aria-label="More curriculum actions"]')!
  const menu = summary.parentElement as HTMLDetailsElement
  menu.open = true
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
  expect(menu.open).toBe(false)
  expect(document.activeElement).toBe(summary)
  menu.open = true
  await act(async () => container.dispatchEvent(new Event('pointerdown', { bubbles: true })))
  expect(menu.open).toBe(false)
  expect(menu.textContent).not.toContain('Learner files')
})
it('resets explicit view choice when choosing a different curriculum', async () => {
  mocks.getCurricula.mockResolvedValue({ data: { curricula: [
    { id: 1, name: 'Python', status: 'active' },
    { id: 2, name: 'Self paced', status: 'active', course_delivery_modes: ['self_paced'] }
  ] } })
  mocks.getCurriculum.mockImplementation(async (id: number) => ({ data: { curriculum: { id, name: id === 1 ? 'Python' : 'Self paced', status: 'active', modules: [] } } }))
  await renderAt('/admin/content?curriculum=1&pane=detail&view=calendar')
  await act(async () => button('Self paced').click())
  expect(urlText()).not.toContain('view=')
  expect(button('Sequence').getAttribute('aria-pressed')).toBe('true')
})

it('does not refocus the heading on reload and restores focus to Edit after saving', async () => {
  mocks.updateCurriculum.mockResolvedValue({ data: {} })
  await renderAt('/admin/content?curriculum=1&pane=detail')
  await act(async () => button('Edit curriculum').click())
  await act(async () => container.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  await act(async () => new Promise(resolve => requestAnimationFrame(() => resolve(undefined))))
  expect(document.activeElement).toBe(button('Edit curriculum'))
})
it('consumes a module hash once while keeping its expanded state', async () => {
  const scroll = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  await renderAt('/admin/content?curriculum=1&pane=detail&open=10#module-10')
  expect(urlText()).not.toContain('#')
  expect(button('Foundations').getAttribute('aria-expanded')).toBe('true')
  expect(scroll).toHaveBeenCalledTimes(1)
  await act(async () => button('Sequence').click())
  expect(scroll).toHaveBeenCalledTimes(1)
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})

it('opens and scrolls the saved new module, then opens the created exercise editor with return context', async () => {
  const scroll = vi.fn()
  Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', { configurable: true, value: scroll })
  const createdModule = { ...module, id: 30, name: 'Created module', lessons: [] }
  mocks.createModule.mockResolvedValue({ data: { module: createdModule } })
  await renderAt('/admin/content?curriculum=1&pane=detail&status=active')
  await act(async () => button('New module').click())
  await inputValue(container.querySelector('[aria-modal] input')!, 'Created module')
  mocks.getCurriculum.mockResolvedValue({ data: { curriculum: { id: 1, name: 'Python', status: 'active', modules: [module, createdModule] } } })
  await act(async () => container.querySelector<HTMLFormElement>('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
  expect(button('Created module').getAttribute('aria-expanded')).toBe('true')
  expect(urlText()).toContain('open=30')
  expect(urlText()).not.toContain('status=')
  expect(urlText()).not.toContain('#')
  expect(scroll).toHaveBeenCalledWith({ block: 'center' })
  mocks.createExercise.mockResolvedValue({ data: { lesson: { id: 88, title: 'New exercise' } } })
  const section = button('Created module').closest('[id="module-30"]')!
  await act(async () => Array.from(section.querySelectorAll('button')).find(b => b.textContent?.trim() === 'Exercise')!.click())
  await act(async () => button('Create test exercise').click())
  expect(mocks.createExercise).toHaveBeenCalledWith(30, expect.objectContaining({ title: 'New exercise' }))
  expect(urlText()).toBe('/admin/lessons/88/edit')
  await act(async () => button('Return to content').click())
  expect(button('Created module').getAttribute('aria-expanded')).toBe('true')
  delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView
})
