import { describe, it, expect } from 'vitest'
import { toWebPath, toNativeHref } from './recordDestination'
import cases from '../../../mobile/src/lib/fixtures/record-destination-contract.json'
describe('record destination contract', () => {
  it.each(cases)('adapts $descriptor.kind', ({ descriptor, web, native }) => {
    expect(toWebPath(descriptor)).toBe(web)
    expect(toNativeHref(descriptor)).toBe(native)
  })
  it.each([null, {}, {kind: 'unknown'}, {kind: 'lesson', id: '../2'}, {kind: 'dm', id: 0}])('rejects invalid descriptors %s', value => {
    expect(toWebPath(value)).toBeNull()
    expect(toNativeHref(value)).toBeNull()
  })
})
