import wireContract from '../fixtures/notification-wire-contract.json'
import { mobileNotificationPath } from '../notification-path'
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

it.each(cases.filter(row => 'input_web' in row))('parses query block anchors', row => {
  expect(toWebPath(fromWebPath(row.input_web))).toBe(row.web)
})
it.each(cases.filter(row => 'rejected_web' in row))('rejects multiple fragment delimiters', row => { expect(fromWebPath(row.rejected_web)).toBeNull() })

it.each(wireContract)('uses the literal wire descriptor for $path', row => { expect(fromWebPath(row.destination_path)).toMatchObject(row.descriptor); expect(mobileNotificationPath(row.descriptor)).toBe(row.new_destination) })
it.each(cases.filter(row => 'native_inputs' in row))('preserves legacy native context', row => {
  for (const input of row.native_inputs!) expect(mobileNotificationPath(input)).toBe(row.native_expected ?? row.native)
})
it('keeps updates cohort context without an announcement', () => { expect(mobileNotificationPath('/updates?cohort_id=2')).toBe('/updates?cohort_id=2') })
it('handles cohort_file and duplicate or invalid query parameters identically to the API', () => {
  expect(toWebPath(fromWebPath('/admin/cohorts/4?tab=files&student=18&file=42'))).toBe('/admin/cohorts/4?tab=files&student=18&file=42')
  expect(toNativeHref(fromWebPath('/admin/cohorts/4?tab=files&student=18&file=42'))).toBe('/staff/files?cohort_id=4&student=18&file=42')
  expect(toWebPath(fromWebPath('/admin/cohorts/4?tab=files&tab=other&file=42'))).toBe('/admin/cohorts/4')
  expect(toWebPath(fromWebPath('/admin/cohorts/4?tab=files&file=42&file=43'))).toBe('/admin/cohorts/4')
  expect(toWebPath(fromWebPath('/admin/cohorts/4?tab=files&student=18&student=19&file=42'))).toBe('/admin/cohorts/4')
  expect(toWebPath(fromWebPath('/admin/cohorts/4?tab=files&student=bad&file=42'))).toBe('/admin/cohorts/4')
})
