import { readFileSync } from 'node:fs'
import { notificationDestination } from './notificationDestination'
import wireContract from '../../../mobile/src/lib/fixtures/notification-wire-contract.json'
import { describe, it, expect } from 'vitest'
import { toWebPath, toNativeHref, fromWebPath } from './recordDestination'
import cases from '../../../mobile/src/lib/fixtures/record-destination-contract.json'
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

it.each(cases.filter(row => 'input_web' in row))('parses query block anchors', row => {
  expect(toWebPath(fromWebPath(row.input_web))).toBe(row.web)
})
it.each(cases.filter(row => 'rejected_web' in row))('rejects multiple fragment delimiters', row => { expect(fromWebPath(row.rejected_web)).toBeNull() })

it('keeps the platform adapters identical', () => {
  expect(readFileSync('../mobile/src/lib/record-destination.ts', 'utf8').replace("'./api.generated'", "'../types/api.generated'")).toBe(readFileSync('src/lib/recordDestination.ts', 'utf8'))
})
it.each(wireContract)('uses the literal wire descriptor for $path', row => {
  expect(fromWebPath(row.destination_path)).toMatchObject(row.descriptor)
  expect(toWebPath(row.descriptor)).toBe(row.destination_path)
  expect(notificationDestination({ destination: { kind: 'thread', id: '9', context: {}, anchor: {} }, destination_path: row.destination_path, path: row.path, notifiable: { type: 'User', id: 1 } } as Parameters<typeof notificationDestination>[0])).toBe(row.destination_path)
})
