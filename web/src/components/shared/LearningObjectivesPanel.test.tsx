// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { LessonObjective } from '../../types/api'
import { LearningObjectivesPanel } from './LearningObjectivesPanel'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const objective: LessonObjective = {
  alignment_id: 1,
  id: 2,
  code: 'TERM.1',
  title: 'Navigate folders',
  description: 'Use the terminal with intention.',
  success_criteria: 'I can move into a requested folder and confirm where I am.',
  active: true,
  content_block_id: 3,
  content_block_title: 'Terminal practice',
}

afterEach(() => {
  vi.unstubAllGlobals()
})

function stubMinWidth640(matches: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 640px)' ? matches : false,
    media: query,
    addEventListener() {},
    removeEventListener() {},
  }))
}

describe('LearningObjectivesPanel', () => {
  it('shows student-facing success criteria and the aligned task before work', () => {
    const html = renderToStaticMarkup(<LearningObjectivesPanel objectives={[objective]} />)

    expect(html).toContain('What success looks like')
    expect(html).not.toContain('TERM.1')
    expect(html).toContain('For Terminal practice')
    expect(html).toContain('I can move into a requested folder')
  })

  it('does not expose inactive curriculum objectives to students', () => {
    const html = renderToStaticMarkup(<LearningObjectivesPanel objectives={[{ ...objective, active: false }]} />)

    expect(html).toBe('')
  })

  it('starts collapsed below 640px and toggles open and closed via summary', async () => {
    stubMinWidth640(false)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<LearningObjectivesPanel objectives={[objective]} />))
      const details = host.querySelector<HTMLDetailsElement>('details')!
      const summary = host.querySelector<HTMLElement>('summary')!
      expect(details.open).toBe(false)

      await act(async () => { summary.click() })
      expect(details.open).toBe(true)

      await act(async () => { summary.click() })
      expect(details.open).toBe(false)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })

  it('starts open at 640px and wider', async () => {
    stubMinWidth640(true)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    try {
      await act(async () => root.render(<LearningObjectivesPanel objectives={[objective]} />))
      expect(host.querySelector<HTMLDetailsElement>('details')?.open).toBe(true)
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  })
})
