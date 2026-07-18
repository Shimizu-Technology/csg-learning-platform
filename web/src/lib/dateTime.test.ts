import { describe, expect, it } from 'vitest'
import { toDateTimeInputValueInTimeZone, toLocalDateTimeInputValue } from './dateTime'

describe('toDateTimeInputValueInTimeZone', () => {
  it('renders an instant as a Guam wall-clock value', () => {
    expect(toDateTimeInputValueInTimeZone('2030-07-10T08:00:00.000Z', 'Pacific/Guam'))
      .toBe('2030-07-10T18:00')
  })

  it('uses the target date offset on both sides of daylight saving time', () => {
    expect(toDateTimeInputValueInTimeZone('2026-01-15T20:00:00.000Z', 'America/Los_Angeles'))
      .toBe('2026-01-15T12:00')
    expect(toDateTimeInputValueInTimeZone('2026-07-15T19:00:00.000Z', 'America/Los_Angeles'))
      .toBe('2026-07-15T12:00')
  })

  it('returns an empty value for an invalid timestamp', () => {
    expect(toDateTimeInputValueInTimeZone('not-a-date', 'Pacific/Guam')).toBe('')
  })
})

describe('toLocalDateTimeInputValue', () => {
  it('uses the browser time zone when rendering an instant', () => {
    const instant = '2026-11-02T01:00:00.000Z'
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone

    expect(toLocalDateTimeInputValue(instant))
      .toBe(toDateTimeInputValueInTimeZone(instant, timeZone))
  })
})
