import { describe, expect, it } from 'vitest'
import { learnerModuleTypeLabel } from './learnerLabels'

describe('learnerModuleTypeLabel', () => {
  it('shows course packages as a focused course, not "workshop"', () => {
    expect(learnerModuleTypeLabel('workshop')).toBe('Focused course')
  })

  it('names the other module types for learners', () => {
    expect(learnerModuleTypeLabel('live_class')).toBe('Live class')
    expect(learnerModuleTypeLabel('prework')).toBe('Prework')
    expect(learnerModuleTypeLabel('recording')).toBe('Class recordings')
  })

  it('falls back to readable text for unknown or missing types', () => {
    expect(learnerModuleTypeLabel('office_hours')).toBe('Office hours')
    expect(learnerModuleTypeLabel('')).toBe('Module')
    expect(learnerModuleTypeLabel(undefined)).toBe('Module')
  })
})
