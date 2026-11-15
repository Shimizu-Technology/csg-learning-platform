import { toWebPath, toNativeHref, fromWebPath } from '../record-destination'
import cases from '../fixtures/record-destination-contract.json'
describe('record destination contract', () => {
  it.each(cases)('adapts $descriptor.kind', ({ descriptor, web, native }) => {
    expect(toWebPath(descriptor)).toBe(web)
    expect(toNativeHref(descriptor)).toBe(native)
    expect(toWebPath(fromWebPath(web))).toBe(web)
    expect(toNativeHref(fromWebPath(web))).toBe(native)
  })
  it.each([null, {}, {kind: 'unknown'}, {kind: 'lesson', id: '../2'}, {kind: 'dm', id: 0}])('rejects invalid descriptors %s', value => {
    expect(toWebPath(value)).toBeNull()
    expect(toNativeHref(value)).toBeNull()
  })
})
