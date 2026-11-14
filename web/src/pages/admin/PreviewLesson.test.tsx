// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { PreviewLesson } from './CohortStudentView'
import { api } from '../../lib/api'
import type { CohortStudentView } from '../../types/api'
vi.mock('../../lib/api', () => ({ api: { getLesson: vi.fn() } }))
vi.mock('../../components/shared/ContentBlockRenderer', () => ({ ContentBlockRenderer: ({ readOnly }: { readOnly: boolean }) => <p>{readOnly ? 'Read only block' : 'Writable block'}</p> }))
it('handles unavailable, loading, error, and read-only lesson states using only the read API', async () => {
  const host = document.createElement('div'); const root = createRoot(host)
  const data = (available: boolean) => ({ cohort: { id: 1 }, dashboard: { modules: [{ lessons: [{ id: 12, available }] }] } }) as CohortStudentView
  try {
    await act(async () => root.render(<PreviewLesson key="unavailable" lessonId={12} data={data(false)} />))
    expect(host.textContent).toContain('not available'); expect(api.getLesson).not.toHaveBeenCalled()
    vi.mocked(api.getLesson).mockReturnValue(new Promise(() => {}))
    await act(async () => root.render(<PreviewLesson key="loading" lessonId={12} data={data(true)} />))
    expect(host.querySelector('[role="status"]')).toBeTruthy()
    vi.mocked(api.getLesson).mockResolvedValue({ data: null, error: 'Read failed' })
    await act(async () => root.render(<PreviewLesson key="error" lessonId={12} data={data(true)} />))
    expect(host.textContent).toContain('Read failed')
    vi.mocked(api.getLesson).mockResolvedValue({ data: { lesson: { title: 'Lesson preview', content_blocks: [{ id: 1, block_type: 'text' }] } } as never, error: null })
    await act(async () => root.render(<PreviewLesson key="ready" lessonId={12} data={data(true)} />))
    expect(host.textContent).toContain('Lesson preview'); expect(host.textContent).toContain('Read only block')
    expect(host.querySelector('button,form')).toBeNull()
    expect(api.getLesson).toHaveBeenLastCalledWith(12, 1)
  } finally { await act(async () => root.unmount()) }
})
