// @vitest-environment jsdom
import { MemoryRouter } from 'react-router-dom'
import { renderToStaticMarkup } from 'react-dom/server'
import { expect, it, vi } from 'vitest'

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

import { ContentBlockRenderer } from './ContentBlockRenderer'
import { StudentExperienceProvider } from '../../lib/studentExperience'

type Props = Parameters<typeof ContentBlockRenderer>[0]
const base: Props['block'] = { id: 91, block_type: 'exercise', position: 0, title: 'Example', body: 'Read this', video_url: null, filename: null, metadata: {} }
const cases: Record<string, Partial<Props['block']>> = {
  manual: { submission_type: 'manual_complete' },
  text: { submission_type: 'text_submission' },
  repo: { submission_type: 'repo_url_submission' },
  live: { submission_type: 'repo_and_live_url_submission' },
  github: { submission_type: 'prework_github_sync' },
  checkpoint: { block_type: 'checkpoint', submission_type: 'text_submission' },
  youtube: { block_type: 'video', video_url: 'https://youtu.be/abcdefg' },
  vimeo: { block_type: 'video', video_url: 'https://vimeo.com/123456' },
  recording: { block_type: 'recording', video_url: 'https://youtu.be/abcdefg' },
  hosted: { block_type: 'video', s3_video_key: 'synthetic' },
  check: { block_type: 'checkpoint', knowledge_check: { id: -1, prompt: 'Choose', options: ['One', 'Two'], correct_option: 0, explanation: 'One is right', attempt_count: 0, latest_attempt: null, objective_code: null } },
  feedback: { submission_type: 'repo_url_submission', submissions: [{ id: 1, text: 'answer', grade: 'R', feedback: 'Try again', graded_at: '2026-11-10T00:00:00Z', github_code_url: 'https://example.invalid/code', repo_url: 'https://example.invalid/repo', pr_url: 'https://example.invalid/pr', live_url: 'https://example.invalid/live', num_submissions: 1, created_at: '2026-11-09T00:00:00Z' }] },
}

// Only the four submission artifact links may differ from the pre-split DOM.
// In particular, Button's responsive lg:min-h-9 must remain visible to snapshots.
const oldArtifactClass = 'pressable inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-line bg-surface-raised px-2.5 py-1 text-xs font-medium text-ink-secondary hover:border-line-strong hover:text-ink'
const artifactLabels = new Set(['GitHub Code', 'Repo', 'PR', 'Live'])
function normalizeArtifactTargets(html: string) {
  const container = document.createElement('div')
  container.innerHTML = html
  for (const link of container.querySelectorAll('a[target="_blank"][rel="noopener noreferrer"]')) {
    if (link.className === oldArtifactClass && artifactLabels.has(link.textContent!.trim())) {
      link.classList.replace('min-h-9', 'min-h-11')
    }
  }
  return container
}

for (const [name, patch] of Object.entries(cases)) for (const v2 of [false, true]) for (const mode of ['student', 'staff', 'read-only']) {
  it(`preserves pre-split DOM: ${name}:${v2}:${mode}`, () => {
    const html = renderToStaticMarkup(<MemoryRouter><StudentExperienceProvider v2={v2}><ContentBlockRenderer block={{ ...base, ...patch }} cohortId={2} isStaff={mode === 'staff'} readOnly={mode === 'read-only'} /></StudentExperienceProvider></MemoryRouter>)
    expect(normalizeArtifactTargets(html).innerHTML.replaceAll('><', '>\n<')).toMatchSnapshot()
  })
}

it('normalizes only artifact links, preserving responsive Button target classes', () => {
  const artifacts = [...artifactLabels].map(label => `<a target="_blank" rel="noopener noreferrer" class="${oldArtifactClass}">${label}</a>`).join('')
  const dom = normalizeArtifactTargets(`${artifacts}<button class="min-h-11 lg:min-h-9">Details</button><a class="min-h-9">Other link</a>`)
  expect([...dom.querySelectorAll('a[target]')].every(link => link.classList.contains('min-h-11'))).toBe(true)
  expect(dom.querySelector('button')!.className).toBe('min-h-11 lg:min-h-9')
  expect(dom.querySelector('a:not([target])')!.className).toBe('min-h-9')
})
