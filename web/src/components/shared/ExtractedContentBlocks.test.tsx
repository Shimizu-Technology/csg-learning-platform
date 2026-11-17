// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'

vi.mock('./LazyMarkdownEditor', async () => ({ LazyMarkdownEditor: (await import('./MarkdownEditor')).MarkdownEditor }))
vi.mock('../../contexts/ToastContext', () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}))
vi.mock('./MarkdownRenderer', () => ({ MarkdownRenderer: ({ starterLinks, content, variant }: { content?: string; variant?: string; starterLinks?: { lessonReturn: { url: string; label?: string | null }; hint: string; newTab?: boolean } }) => (starterLinks ? <div data-starter-hint={starterLinks.hint} data-starter-return={starterLinks.lessonReturn.url} data-starter-label={starterLinks.lessonReturn.label ?? ''} data-starter-new-tab={String(Boolean(starterLinks.newTab))} /> : <div data-markdown-variant={variant}>{content}</div>) }))
vi.mock('./CodeEditor', () => ({ CodeEditor: ({ value, readOnly, busy, onChange }: { value: string; readOnly?: boolean; busy?: boolean; onChange?: (value: string) => void }) => <pre data-editor={readOnly || busy ? 'readonly' : 'editable'} onClick={() => onChange?.(`${value}\n# edited`)}>{value}</pre>, detectLanguage: () => 'python' }))
vi.mock('./FeedbackBody', () => ({ FeedbackBody: ({ feedback }: { feedback: string }) => <div data-feedback="">{feedback}</div> }))
vi.mock('./CodeRunner', () => ({ CodeRunner: () => null }))
vi.mock('./VideoPlayer', () => ({ VideoPlayer: ({ trackProgress, onSaveProgress, onCompleted }: { trackProgress?: boolean; onSaveProgress: (data: object) => void; onCompleted: () => void }) => <div data-video="playable" data-tracking={String(trackProgress)}><button onClick={() => onSaveProgress({ last_position_seconds: 10, total_watched_seconds: 10, duration_seconds: 20 })}>Simulate video progress</button><button onClick={onCompleted}>Simulate video ended</button></div> }))
vi.mock('./GradeDisplay', () => ({ GradeDisplay: () => null }))

import { api } from '../../lib/api'
import { VideoBlock } from './VideoBlock'
import { KnowledgeCheckBlock } from './KnowledgeCheckBlock'
import { ManualCompleteBlock } from './ManualCompleteBlock'
import { SubmissionBlock } from './SubmissionBlock'
import { useContentBlockController } from './useContentBlockController'
import type { ContentBlockRendererProps } from './contentBlockTypes'

const block = { id: 71, block_type: 'exercise', position: 0, title: 'Practice', body: null, video_url: null, filename: null, metadata: {} }
let root: ReturnType<typeof createRoot> | undefined
let container: HTMLDivElement
function mount(Component: typeof ManualCompleteBlock, patch: Partial<ContentBlockRendererProps['block']>, onProgressUpdate = vi.fn()) {
  const props = { block: { ...block, ...patch }, cohortId: 2, onProgressUpdate }
  function Subject() { const controller = useContentBlockController(props); return <Component {...props} controller={controller} /> }
  container = document.createElement('div'); document.body.append(container)
  root = createRoot(container)
  act(() => root!.render(<Subject />))
  return onProgressUpdate
}
async function click(text: string) {
  const button = Array.from(container.querySelectorAll('button')).find(node => node.textContent === text)!
  expect(button).toBeDefined()
  await act(async () => button.click())
}
afterEach(() => { act(() => root?.unmount()); container?.remove(); vi.restoreAllMocks() })

it('ManualCompleteBlock saves completion and undo in the same cohort', async () => {
  const save = vi.spyOn(api, 'updateProgress').mockResolvedValue({ data: null, error: null })
  const updated = mount(ManualCompleteBlock, { submission_type: 'manual_complete' })
  await click('Mark complete')
  expect(save).toHaveBeenLastCalledWith(71, 'completed', 2)
  await click('Mark not done')
  expect(save).toHaveBeenLastCalledWith(71, 'not_started', 2)
  expect(updated).toHaveBeenCalledTimes(2)
})
it('KnowledgeCheckBlock saves the selected answer and shows its explanation', async () => {
  const check = { id: 19, prompt: 'Choose', options: ['One', 'Two'], attempt_count: 0, latest_attempt: null, objective_code: null }
  const attempt = vi.spyOn(api, 'attemptKnowledgeCheck').mockResolvedValue({ error: null, data: { knowledge_check: { ...check, attempt_count: 1, latest_attempt: { id: 1, selected_option: 0, correct: true, correct_option: 0, explanation: 'One is right', created_at: '2026-11-18T00:00:00Z' } }, progress: { status: 'completed' } } } as never)
  const updated = mount(KnowledgeCheckBlock, { block_type: 'checkpoint', knowledge_check: check })
  await click('One'); await click('Check answer')
  expect(attempt).toHaveBeenCalledWith(19, 0, 2)
  expect(container.textContent).toContain('One is right')
  expect(updated).toHaveBeenCalledTimes(1)
})
it('SubmissionBlock submits the edited text with the same payload', async () => {
  const submit = vi.spyOn(api, 'createSubmission').mockResolvedValue({ data: null, error: null })
  const updated = mount(SubmissionBlock, { submission_type: 'text_submission' })
  await act(async () => container.querySelector('pre')!.click())
  await click('Submit')
  expect(submit).toHaveBeenCalledWith({ cohort_id: 2, content_block_id: 71, text: '\n# edited' })
  expect(updated).toHaveBeenCalledTimes(1)
})
it('VideoBlock saves hosted playback progress in the same cohort', async () => {
  const save = vi.spyOn(api, 'updateContentBlockVideoProgress').mockResolvedValue({ error: null, data: { video_progress: { completed: true } } } as never)
  const updated = mount(VideoBlock, { block_type: 'video', s3_video_key: 'synthetic' })
  await click('Simulate video progress')
  expect(save).toHaveBeenCalledWith(71, { last_position_seconds: 10, total_watched_seconds: 10, duration_seconds: 20 }, 2)
  expect(updated).toHaveBeenCalledTimes(1)
})
