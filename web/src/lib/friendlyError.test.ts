import { describe, expect, it } from 'vitest'
import { friendlySaveError } from './friendlyError'

describe('friendlySaveError', () => {
  it('replaces transport and server errors with recoverable copy', () => {
    const network = friendlySaveError({ error: 'Failed to fetch', errorKind: 'network' })
    expect(network).toContain("couldn't reach CSG Learn")
    expect(network).toContain('draft is saved on this device')
    expect(network).not.toContain('Failed to fetch')

    const server = friendlySaveError({ error: 'Internal Server Error', errorKind: 'server', status: 500 })
    expect(server).toContain('Something went wrong on our side')
    expect(server).not.toContain('Internal Server Error')
    expect(friendlySaveError({ error: 'Request timed out.', errorKind: 'timeout' })).toContain('took too long')
  })

  it('keeps human validation messages from the API', () => {
    expect(friendlySaveError({ error: 'Week 2 submissions are closed', errorKind: 'forbidden', status: 403 })).toBe('Week 2 submissions are closed')
    expect(friendlySaveError({ error: null })).toContain("couldn't save your work")
  })
})
