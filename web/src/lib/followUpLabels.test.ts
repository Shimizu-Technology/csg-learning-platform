import { describe, expect, it } from 'vitest'
import shared from '../../../fixtures/follow-up-labels.json'
import { FOLLOW_UP_OUTCOME_LABELS, FOLLOW_UP_STATUS_LABELS, FOLLOW_UP_TRIGGER_LABELS, followUpLabel } from './followUpLabels'

/* Web and mobile show the same words for follow-up plan values (fixtures/follow-up-labels.json). */
describe('follow-up labels match the shared fixture', () => {
  it('uses the shared reason, status and outcome words', () => {
    expect(FOLLOW_UP_TRIGGER_LABELS).toEqual(shared.triggers)
    expect(FOLLOW_UP_STATUS_LABELS).toEqual(shared.statuses)
    expect(FOLLOW_UP_OUTCOME_LABELS).toEqual(shared.outcomes)
  })

  it('reads stored values through the maps', () => {
    expect(followUpLabel('extended_absence')).toBe('Back after time away')
    expect(followUpLabel('no_change')).toBe('No change yet')
    expect(followUpLabel('something_new')).toBe('Something new')
  })
})
