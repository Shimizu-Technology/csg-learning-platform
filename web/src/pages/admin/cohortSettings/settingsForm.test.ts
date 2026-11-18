import { expect, it } from 'vitest'
import { formatPaceWeeks, paceWeeksProblem, parsePaceWeeks } from './settingsForm'

it('reads pace choices and refuses text that has none or isn’t whole weeks', () => {
  expect(parsePaceWeeks('6, 3,4 4')).toEqual([3, 4, 6])
  expect(paceWeeksProblem('3, 4, 6')).toBeNull()
  expect(paceWeeksProblem(', ,')).toMatch(/at least one pace/)
  expect(paceWeeksProblem('')).toMatch(/at least one pace/)
  expect(paceWeeksProblem('3.5')).toMatch(/whole numbers/)
  expect(paceWeeksProblem('3weeks, 4')).toMatch(/whole numbers/)
  expect(formatPaceWeeks([3, 4, 6])).toBe('3, 4, 6')
  expect(formatPaceWeeks(null)).toBe('')
})
