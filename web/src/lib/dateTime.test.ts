import { describe, expect, it } from 'vitest'
import { toDateTimeInputValueInTimeZone } from './dateTime'

describe('toDateTimeInputValueInTimeZone', () => {
  it('renders an instant as a Guam wall-clock value', () => {
    expect(toDateTimeInputValueInTimeZone('2030-07-10T08:00:00.000Z', 'Pacific/Guam'))
      .toBe('2030-07-10T18:00')
  })

  it('preserves the selected zone when daylight saving offsets differ', () => {
    expect(toDateTimeInputValueInTimeZone('2026-03-09T01:00:00.000Z', 'America/Los_Angeles'))
      .toBe('2026-03-08T18:00')
  })

  it('returns an empty value for an invalid timestamp', () => {
    expect(toDateTimeInputValueInTimeZone('not-a-date', 'Pacific/Guam')).toBe('')
  })
})
