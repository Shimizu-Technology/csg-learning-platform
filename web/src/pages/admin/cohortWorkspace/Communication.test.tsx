// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import { expect, it, vi } from 'vitest'
import type { CohortDetail, CohortHome } from '../../../types/api'
import { Communication } from './Communication'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
it.each(['loading', 'unavailable', 'empty'] as const)(
  'distinguishes %s updates and offers retry on failure',
  async (state) => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host),
      retry = vi.fn()
    const home = state === 'empty' ? ({ recent_announcements: [] } as unknown as CohortHome) : null
    try {
      await act(async () =>
        root.render(
          <MemoryRouter>
            <Communication
              cohort={{ id: 1 } as CohortDetail}
              home={home}
              messages={false}
              announcements
              loading={state === 'loading'}
              error={state === 'unavailable' ? 'Updates unavailable' : null}
              onRetry={retry}
            />
          </MemoryRouter>,
        ),
      )
      if (state === 'loading') {
        expect(host.textContent).toContain('Loading cohort updates')
        expect(host.textContent).not.toContain('No updates for this cohort yet.')
      } else if (state === 'unavailable') {
        expect(host.querySelector('[role="alert"]')?.textContent).toContain('Updates unavailable')
        expect(host.textContent).not.toContain('No updates for this cohort yet.')
        await act(async () => host.querySelector('button')!.click())
        expect(retry).toHaveBeenCalledOnce()
      } else {
        expect(host.textContent).toContain('No updates for this cohort yet.')
        expect(host.querySelector('[role="alert"]')).toBeNull()
      }
    } finally {
      await act(async () => root.unmount())
      host.remove()
    }
  },
)
