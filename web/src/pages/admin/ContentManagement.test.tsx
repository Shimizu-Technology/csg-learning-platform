// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ deleteCurriculum: vi.fn(), confirm: vi.fn(), getCohorts: vi.fn(), getCurricula: vi.fn(), getCurriculum: vi.fn(), updateModule: vi.fn(), reorderModules: vi.fn(), error: vi.fn(), success: vi.fn() }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => mocks.confirm }))
vi.mock('../../lib/api', () => ({ api: mocks }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { is_admin: true } }) }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ error: mocks.error, success: mocks.success }) }))
vi.mock('../../contexts/UploadContext', () => ({ useUpload: () => ({ attachUpload: vi.fn() }) }))
vi.mock('./CourseResourcesPanel', () => ({ CourseResourcesPanel: () => null }))
vi.mock('./NewExerciseModal', () => ({ NewExerciseModal: (props: { defaultWeek: number; defaultDayIndex: number }) => <div data-testid="exercise-placement">{props.defaultWeek}:{props.defaultDayIndex}</div> }))
import { ContentManagement } from './ContentManagement'

let container: HTMLDivElement
let root: Root
const lessons = [0, 2, 4].map((release_day, index) => ({ id: index + 1, title: `Exercise ${index + 1}`, release_day, position: index, content_blocks_count: 1, lesson_type: 'exercise', archived_at: null, updated_at: '2026-10-22' }))
const module = { id: 10, name: 'Foundations', module_type: 'live_class', position: 0, schedule_days: 'mwf', week_count: 1, updated_at: '2026-10-22', lessons }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.confirm.mockResolvedValue(true)
  mocks.getCohorts.mockResolvedValue({ data: { cohorts: [] } })
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
  mocks.getCohorts.mockResolvedValue({ data: { cohorts: [{ id: 4, name: 'Self-paced', curriculum_id: 1, course_delivery: 'self_paced' }] } })
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
