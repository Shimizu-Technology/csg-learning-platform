// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ getCurricula: vi.fn(), getCurriculum: vi.fn(), updateModule: vi.fn(), error: vi.fn(), success: vi.fn() }))
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
  mocks.getCurricula.mockResolvedValue({ data: { curricula: [{ id: 1 }] } })
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
  const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
  await mount(); await changeSchedule()
  expect(confirm).toHaveBeenCalledWith('Adds Tuesday/Thursday slots. Existing exercises keep their days.')
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
  vi.spyOn(window, 'confirm').mockReturnValue(false)
  await mount(); await changeSchedule()
  expect(mocks.updateModule).not.toHaveBeenCalled()
  vi.mocked(window.confirm).mockReturnValue(true)
  mocks.updateModule.mockResolvedValue({ error: 'Schedule days would exclude 2 restorable lessons' })
  await changeSchedule()
  expect(mocks.error).toHaveBeenCalledWith('Schedule days would exclude 2 restorable lessons')
  expect(container.querySelector<HTMLSelectElement>('select')!.value).toBe('mwf')
})
