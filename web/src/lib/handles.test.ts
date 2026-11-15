import { describe, expect, it } from 'vitest'
import { handleProblem, normalizeHandle } from './handles'

describe('handles', () => {
  it('normalizes what people type', () => {
    expect(normalizeHandle('  @Alex_R ')).toBe('alex_r')
    expect(normalizeHandle('')).toBe('')
  })

  it('matches the API rules', () => {
    expect(handleProblem('')).toBeNull()
    expect(handleProblem('Alex_R')).toBeNull()
    expect(handleProblem('a'.repeat(30))).toBeNull()
    expect(handleProblem('ab')).toBe('Use 3 to 30 characters.')
    expect(handleProblem('a'.repeat(31))).toBe('Use 3 to 30 characters.')
    expect(handleProblem('_alex')).toMatch(/starting with a letter or number/)
    expect(handleProblem('alex.r')).toMatch(/lowercase letters/)
    expect(handleProblem('álex')).toMatch(/lowercase letters/)
    expect(handleProblem('@everyone')).toBe('@everyone is reserved. Choose another handle.')
  })
})
