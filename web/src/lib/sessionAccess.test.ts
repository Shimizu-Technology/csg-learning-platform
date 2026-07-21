import { describe, expect, it } from 'vitest'
import { isAccessDeniedResponse } from './sessionAccess'

describe('isAccessDeniedResponse', () => {
  it('recognizes invite-only and archived account denials', () => {
    expect(isAccessDeniedResponse({ status: 403, errorCode: 'account_not_authorized' })).toBe(true)
    expect(isAccessDeniedResponse({ status: 403, errorCode: 'account_archived' })).toBe(true)
  })

  it('does not turn ordinary authorization or authentication failures into account denials', () => {
    expect(isAccessDeniedResponse({ status: 403, errorCode: undefined })).toBe(false)
    expect(isAccessDeniedResponse({ status: 401, errorCode: 'account_not_authorized' })).toBe(false)
  })
})
