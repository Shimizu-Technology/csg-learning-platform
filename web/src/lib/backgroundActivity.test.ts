import { describe, expect, it } from 'vitest'
import { isVisiblePage, shouldPollMessages } from './backgroundActivity'

describe('background activity policy', () => {
  it('sends active-session work only for visible pages', () => {
    expect(isVisiblePage('visible')).toBe(true)
    expect(isVisiblePage('hidden')).toBe(false)
  })

  it('uses message polling only as a visible realtime fallback', () => {
    expect(shouldPollMessages('visible', 'disconnected')).toBe(true)
    expect(shouldPollMessages('visible', 'error')).toBe(true)
    expect(shouldPollMessages('visible', 'connected')).toBe(false)
    expect(shouldPollMessages('hidden', 'disconnected')).toBe(false)
  })
})
