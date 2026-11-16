import { TestRouter as MemoryRouter } from '../../test/TestRouter'
// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { Route, Routes } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../lib/api'
import { ContentManagement } from './ContentManagement'
import { LessonEditor } from './LessonEditor'
import { NewLessonModal } from './NewLessonModal'
import { NewExerciseModal } from './NewExerciseModal'
import { CourseResourcesPanel } from './CourseResourcesPanel'

const session = vi.hoisted(() => ({ user: { id: 7, role: 'instructor', is_staff: true, is_admin: false } }))
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => vi.fn() }))
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
  vi.spyOn(api, 'getCohorts').mockResolvedValue({ data: { cohorts: [] }, error: null })
  vi.spyOn(api, 'getCurricula').mockResolvedValue({ data: { curricula: [curriculum] }, error: null } as never)
  vi.spyOn(api, 'getCurriculum').mockResolvedValue({ data: { curriculum }, error: null } as never)
  vi.spyOn(api, 'getLesson').mockResolvedValue({ data: { lesson }, error: null } as never)
  // Instructors open the block editor; the API says they can't save (no editing access).
  vi.spyOn(api, 'getLessonBlockEditor').mockResolvedValue({ data: {
    lesson: { ...lesson, position: 0, requires_submission: true, submission_type: 'text_submission', prev_lesson: null, next_lesson: null },
    block_activity: [], context: { curriculum: { id: 1, name: 'Shared curriculum' }, module: { id: 3, name: 'Module one', release_days: [] }, used_in: [], submissions_count: 0, waiting_count: 0, open_help_count: 0 },
    access: { can_edit: false, reason: 'no_grant', message: null, grants: [], shared_with: [] },
  }, error: null } as never)
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
    await act(async () => buttons().find(b => b.textContent?.includes('Module one'))!.click())
    expect(container.textContent).toContain('Shared exercise')
    expect(container.querySelector('[aria-label="Preview Shared exercise as a student"]')).not.toBeNull()
    expect(container.querySelector('[aria-label="Edit Shared exercise"]')).toBeNull()
    expect(container.querySelector('select[aria-label^="Schedule pattern"]')).toBeNull()
    expect(buttons().some((b) => /^(New curriculum|Exercise|Restore|Add|Week)$|Add first/.test(b.textContent || ''))).toBe(false)
  })
  it('keeps the admin library authoring controls', async () => {
    session.user = { ...session.user, role: 'admin', is_admin: true }
    await render(<ContentManagement />)
    await act(async () => buttons().find(b => b.textContent?.includes('Module one'))!.click())
    expect(container.querySelector('[aria-label="Edit Shared exercise"]')).not.toBeNull()
    expect(buttons().some((b) => b.textContent === 'Restore')).toBe(true)
    expect(container.querySelector('input[type="file"]')).not.toBeNull()
  })
  it.each(['', '?preview=true'])('renders an instructor direct editor URL%s as saved read-only content with solutions', async (query) => {
    await act(async () => root.render(<MemoryRouter initialEntries={[`/admin/lessons/2/edit${query}`]}><Routes><Route path="/admin/lessons/:id/edit" element={<LessonEditor />} /></Routes></MemoryRouter>))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(container.textContent).toContain('Only admins can edit lessons. Ask an admin to give you editing access for your cohort.')
    expect(container.textContent).toContain('Saved instructions')
    expect(container.querySelector('input, textarea, [contenteditable="true"]')).toBeNull()
    expect(buttons().some((b) => /Save|Edit|Archive|Restore/.test(b.textContent || ''))).toBe(false)
    await act(async () => buttons().find((b) => b.textContent === 'Solution')!.click())
    expect(container.textContent).toContain('staff solution')
    // Solutions are read in the shared code block, not an editor.
    expect(container.querySelector('.code-block [data-line-numbers]')).not.toBeNull()
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
  it('renders the admin block editor with every block and settings', async () => {
    session.user = { ...session.user, role: 'admin', is_admin: true }
    const blockSummary = { ...block, effective_submission_type: 'text_submission', submission_type_explicit: 'text_submission', submission_config: {}, s3_video_key: null, objective_ids: [], rubric: null, knowledge_check: null, has_s3_video: false, completion_required: true }
    vi.spyOn(api, 'getLessonBlockEditor').mockResolvedValue({ data: {
      lesson: { ...lesson, position: 0, requires_submission: true, submission_type: 'text_submission', updated_at: '2026-10-22T00:00:00.000000Z', content_blocks: [blockSummary], prev_lesson: null, next_lesson: null },
      block_activity: [{ content_block_id: 10, submissions: 0, progress: 0, watched: 0, check_attempts: 0 }],
      context: { curriculum: { id: 1, name: 'Shared curriculum' }, module: { id: 3, name: 'Module one', release_days: [{ release_day: 0, week: 1, day_name: 'Monday' }] }, used_in: [], submissions_count: 0, waiting_count: 0, open_help_count: 0 },
      access: { can_edit: true, reason: 'admin', message: null, grants: [], shared_with: [] },
    }, error: null } as never)
    await act(async () => root.render(<MemoryRouter initialEntries={['/admin/lessons/2/edit']}><Routes><Route path="/admin/lessons/:id/edit" element={<LessonEditor />} /></Routes></MemoryRouter>))
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
    expect(container.querySelector('article[aria-label="Exercise block, 1 of 1"]')).not.toBeNull()
    expect(container.querySelector('aside[aria-label="Settings"]')).not.toBeNull()
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
