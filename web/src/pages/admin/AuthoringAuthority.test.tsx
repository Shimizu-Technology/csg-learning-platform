// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { ContentManagement } from './ContentManagement'
import { LessonEditor } from './LessonEditor'
import { NewLessonModal } from './NewLessonModal'
import { NewExerciseModal } from './NewExerciseModal'
import { CourseResourcesPanel } from './CourseResourcesPanel'

const session = vi.hoisted(() => ({ user: { id: 7, role: 'instructor', is_staff: true, is_admin: false } }))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => session }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))
vi.mock('../../contexts/UploadContext', () => ({ useUpload: () => ({ uploads: [], attachUpload: vi.fn(), completeDeferredUpload: vi.fn() }) }))
vi.mock('../../components/shared/CodeEditor', () => ({ CodeEditor: ({ value, readOnly }: { value: string; readOnly?: boolean }) => <pre data-readonly={readOnly}>{value}</pre>, detectLanguage: () => 'ruby' }))
vi.mock('../../components/shared/RichTextEditor', () => ({ RichTextEditor: () => <textarea aria-label="Rich text editor" /> }))

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const block = { id: 10, block_type: 'exercise', title: 'Practice', position: 0, body: 'Saved instructions', solution: 'puts "staff solution"', filename: 'exercise.rb', video_url: null, metadata: {}, submission_type: 'text_submission' }
const lesson = { id: 2, curriculum_id: 1, module_id: 3, title: 'Shared exercise', release_day: 0, required: true, lesson_type: 'exercise', archived_at: null, updated_at: '2026-10-22T00:00:00Z', content_blocks: [block], objectives: [], content_blocks_count: 1 }
const archived = { ...lesson, id: 4, title: 'Archived exercise', archived_at: '2026-10-21T00:00:00Z' }
const curriculum = { id: 1, name: 'Shared curriculum', status: 'draft', modules: [{ id: 3, curriculum_id: 1, name: 'Module one', module_type: 'prework', position: 0, schedule_days: 'weekdays', week_count: 1, lessons: [lesson, archived] }] }
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  session.user = { id: 7, role: 'instructor', is_staff: true, is_admin: false }
  container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container)
  vi.spyOn(api, 'getCurricula').mockResolvedValue({ data: { curricula: [curriculum] }, error: null } as never)
  vi.spyOn(api, 'getCurriculum').mockResolvedValue({ data: { curriculum }, error: null } as never)
  vi.spyOn(api, 'getLesson').mockResolvedValue({ data: { lesson }, error: null } as never)
  vi.spyOn(api, 'getLearningObjectives').mockResolvedValue({ data: { learning_objectives: [] }, error: null })
  vi.spyOn(api, 'getRubrics').mockResolvedValue({ data: { rubrics: [] }, error: null })
  vi.spyOn(api, 'getCurriculumResources').mockResolvedValue({ data: { resources: [] }, error: null })
})
afterEach(async () => { await act(async () => root.unmount()); document.querySelectorAll('[data-state="closing"]').forEach((ghost) => ghost.dispatchEvent(new Event('animationend', { bubbles: true }))); container.remove(); vi.restoreAllMocks() })
const render = async (node: React.ReactNode) => act(async () => root.render(<MemoryRouter>{node}</MemoryRouter>))
const buttons = () => Array.from(container.querySelectorAll('button'))

describe('shared authoring authority', () => {
  it('keeps the instructor library browsable without creation, scheduling, restore, or edit controls', async () => {
    await render(<ContentManagement />)
    expect(container.textContent).toContain('Only admins can change the shared course library.')
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-expanded]')!.click())
    expect(container.textContent).toContain('Shared exercise')
    expect(container.querySelector('[aria-label="Preview Shared exercise as a student"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Edit Shared exercise"]')).toBeNull()
    expect(container.querySelector('select')).toBeNull()
    expect(buttons().some((b) => /^(New curriculum|Exercise|Restore|Add|Week)$|Add first/.test(b.textContent || ''))).toBe(false)
  })
  it('keeps the admin library authoring controls', async () => {
    session.user = { ...session.user, role: 'admin', is_admin: true }
    await render(<ContentManagement />)
    await act(async () => container.querySelector<HTMLButtonElement>('[aria-expanded]')!.click())
    expect(container.querySelector('[aria-label="Edit Shared exercise"]')).not.toBeNull()
    expect(buttons().some((b) => b.textContent === 'Restore')).toBe(true)
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
  })
  it.each(['', '?preview=true'])('renders an instructor direct editor URL%s as saved read-only content with solutions', async (query) => {
    await act(async () => root.render(<MemoryRouter initialEntries={[`/admin/lessons/2/edit${query}`]}><Routes><Route path="/admin/lessons/:id/edit" element={<LessonEditor />} /></Routes></MemoryRouter>))
    expect(container.textContent).toContain('Only admins can change the shared course library.')
    expect(container.textContent).toContain('Saved instructions')
    expect(container.querySelector('input, textarea, [contenteditable="true"]')).toBeNull()
    expect(buttons().some((b) => /Save|Edit|Archive|Restore/.test(b.textContent || ''))).toBe(false)
    await act(async () => buttons().find((b) => b.textContent === 'Solution')!.click())
    expect(container.textContent).toContain('staff solution')
    expect(container.querySelector('pre[data-readonly="true"]')).not.toBeNull()
    expect(container.textContent).not.toContain('Submit for Review')
  })
  it('closes an existing authoring modal when the session loses admin authority', async () => {
    session.user = { ...session.user, role: 'admin', is_admin: true }
    await render(<ContentManagement />)
    await act(async () => buttons().find((b) => b.textContent?.includes('New curriculum'))!.click())
    expect(document.querySelector('[role="dialog"] form')).not.toBeNull()
    session.user = { ...session.user, role: 'instructor', is_admin: false }
    await render(<ContentManagement />)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(container.textContent).toContain('Only admins can change the shared course library.')
  })
  it('renders the admin editor with save and settings', async () => {
    session.user = { ...session.user, role: 'admin', is_admin: true }
    await act(async () => root.render(<MemoryRouter initialEntries={['/admin/lessons/2/edit']}><Routes><Route path="/admin/lessons/:id/edit" element={<LessonEditor />} /></Routes></MemoryRouter>))
    expect(buttons().some((b) => b.textContent === 'Save Changes')).toBe(true)
    expect(container.querySelector('input')).not.toBeNull()
  })
  it('denies both new-content modals even when directly mounted for an instructor', async () => {
    const props = { moduleName: 'Module one', scheduleDays: 'weekdays', weekCount: 1, defaultPosition: 0, defaultWeek: 1, defaultDayIndex: 0, saving: false, onClose: vi.fn(), onCreate: vi.fn() }
    for (const Modal of [NewLessonModal, NewExerciseModal]) {
      await render(<Modal {...props} />)
      expect(document.body.textContent).toContain('Only admins can change the shared course library.')
      expect(document.querySelector('input, textarea')).toBeNull()
      expect(props.onCreate).not.toHaveBeenCalled()
    }
  })
  it('hides ZIP upload and pending cleanup for instructors but retains download', async () => {
    vi.mocked(api.getCurriculumResources).mockResolvedValue({ data: { resources: [true, false].map((ready, index) => ({ id: `file-${index}`, download_id: index + 8, title: 'Course bundle', filename: 'course.zip', category: 'download', description: null, url: '', ready })) }, error: null })
    await render(<CourseResourcesPanel curriculumId={1} draft />)
    expect(container.querySelector('input')).toBeNull()
    expect(buttons().map((b) => b.textContent)).toEqual(['Download ZIP'])
  })
})
