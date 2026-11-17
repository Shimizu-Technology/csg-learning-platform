// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import { LessonView } from './LessonView'
import { ContentBlockRenderer } from '../../components/shared/ContentBlockRenderer'
import { StudentExperienceProvider } from '../../lib/studentExperience'
import { renderToStaticMarkup } from 'react-dom/server'

vi.mock('../../lib/api', () => ({
  api: {
    getLesson: async () => ({
      data: {
        lesson: {
          id: 42,
          cohort_id: 1,
          module_id: 2,
          title: 'Loops',
          lesson_type: 'exercise',
          required: true,
          learner_status: 'awaiting_review',
          content_blocks: [{ id: 8, block_type: 'exercise', position: 0 }],
          objectives: [],
          capabilities: { read_only: false, can_submit: true, features: { student_experience_v2: false } },
          next_lesson: { id: 43, title: 'Functions' },
        },
      },
    }),
    getHelpRequests: async () => ({ data: { help_requests: [] } }),
  },
}))
vi.mock('../../contexts/AuthContext', () => ({ useAuthContext: () => ({ user: { id: 3 }, enrollments: [] }) }))
vi.mock('../../contexts/CohortContext', () => ({ useCohortContext: () => ({ selectedCohortId: 1, cohorts: [] }) }))
vi.mock('../../lib/recordRelated', () => ({ useRecordRelated: () => ({}), relatedRows: () => [] }))
vi.mock('../../components/shared/RubricPanel', () => ({ RubricPanel: () => null }))
vi.mock('../../components/student/ContextualHelp', () => ({ ContextualHelp: () => <button>Ask for help</button> }))
vi.mock('../../components/shared/CodeEditor', () => ({
  CodeEditor: ({ value }: { value: string }) => <textarea defaultValue={value} />,
  detectLanguage: () => 'python',
}))
vi.mock('../../components/shared/MarkdownRenderer', () => ({ MarkdownRenderer: () => null }))
vi.mock('../../components/shared/FeedbackBody', () => ({ FeedbackBody: () => null }))
vi.mock('../../lib/useMediaQuery', () => ({ useMediaQuery: () => false }))
vi.mock('../../contexts/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }))

// Snapshots recorded by temporarily running the unmodified files at 5fa85024.
// Only React's process-global useId suffix is normalized; all other HTML bytes match.
it('keeps the running-program Off lesson markup byte-identical to main 5fa85024', async () => {
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    await act(async () =>
      root.render(
        <StudentExperienceProvider v2={false}>
          <MemoryRouter initialEntries={['/lessons/42?cohort_id=1']}>
            <Routes>
              <Route path="/lessons/:id" element={<LessonView />} />
            </Routes>
          </MemoryRouter>
        </StudentExperienceProvider>
      )
    )
    expect(host.innerHTML.replace(/_r_[a-z0-9]+_/g, '_react_id_')).toMatchSnapshot()
  } finally {
    await act(async () => root.unmount())
  }
})
it('keeps Off submission and both manual controls byte-identical to main 5fa85024', () => {
  const base = {
    id: 8,
    block_type: 'exercise',
    position: 0,
    title: 'Practice',
    body: null,
    video_url: null,
    filename: null,
    metadata: {},
  }
  for (const submission_type of ['manual_complete', 'text_submission']) {
    const block = {
      ...base,
      submission_type,
      submissions: [
        {
          id: 1,
          text: 'very_long_python_identifier = "answer"',
          grade: null,
          feedback: null,
          graded_at: null,
          num_submissions: 1,
          created_at: '2026-11-17T00:00:00Z',
        },
      ],
    }
    expect(
      renderToStaticMarkup(
        <StudentExperienceProvider v2={false}>
          <ContentBlockRenderer cohortId={1} block={block} />
        </StudentExperienceProvider>
      ).replace(/_r_[a-z0-9]+_/g, '_react_id_')
    ).toMatchSnapshot(submission_type)
  }
})
