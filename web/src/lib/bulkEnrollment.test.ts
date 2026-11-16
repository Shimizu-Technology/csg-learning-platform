import { describe, it, expect } from 'vitest'
import { parseEnrollmentRows } from './bulkEnrollment'
describe('bulk enrollment preview', () => {
  it('normalizes emails and marks duplicates and invalid rows', () => {
    expect(parseEnrollmentRows('A@example.test\na@example.test\ninvalid').map(r => r.error)).toEqual([undefined, 'Duplicate in upload', 'Invalid email'])
  })
  it('parses CSV headers, BOM, commas and quoted names', () => {
    expect(parseEnrollmentRows('\uFEFFemail,last_name,first_name\r\na@example.test,"Last, Jr",First')).toEqual([{ email: 'a@example.test', first_name: 'First', last_name: 'Last, Jr', error: undefined }])
  })
  it('rejects unclosed quotes', () => { expect(parseEnrollmentRows('a@example.test,"oops')[0].error).toBe('Unclosed CSV quote') })
})
