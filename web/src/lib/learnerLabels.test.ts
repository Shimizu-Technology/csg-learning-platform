import { describe, expect, it } from 'vitest'
import { blockHeaderParts, blockTypeLabel, learnerModuleTypeLabel } from './learnerLabels'

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

describe('blockHeaderParts', () => {
  it('drops the type when the title already starts with it', () => {
    expect(blockHeaderParts('checkpoint', 'Checkpoint 1 — budget decision')).toEqual({ typeLabel: null, title: 'Checkpoint 1 — budget decision' })
    expect(blockHeaderParts('exercise', 'exercise: loops')).toEqual({ typeLabel: null, title: 'exercise: loops' })
    expect(blockHeaderParts('code_challenge', 'Code challenge 2')).toEqual({ typeLabel: null, title: 'Code challenge 2' })
  })

  it('keeps the type for other titles', () => {
    expect(blockHeaderParts('exercise', 'E3 — two-item receipt')).toEqual({ typeLabel: 'Exercise', title: 'E3 — two-item receipt' })
    // A longer word that only begins with the type is not a repeat.
    expect(blockHeaderParts('text', 'Textbook reading')).toEqual({ typeLabel: 'Text', title: 'Textbook reading' })
  })

  it('shows only the type when there is no title', () => {
    expect(blockHeaderParts('checkpoint', '  ')).toEqual({ typeLabel: 'Checkpoint', title: null })
    expect(blockTypeLabel('code_challenge')).toBe('Code challenge')
  })
})
