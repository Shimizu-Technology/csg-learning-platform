import { describe, expect, it } from 'vitest'
import { activeRunnerChecks, buildSubmissionConfigWithRunner, newCheckId, normalizeCodeRunnerConfig } from './codeRunner'

describe('code runner config', () => {
  it('reads starter code and well-formed checks, dropping malformed ones', () => {
    const config = normalizeCodeRunnerConfig({
      runner: { enabled: true, language: 'javascript', starter_code: 'let x', checks: [{ id: 'a', name: 'A', code: 'assert(x)' }, { id: 1 }, 'bad'] },
    })
    expect(config).toEqual({ enabled: true, language: 'javascript', starterCode: 'let x', checks: [{ id: 'a', name: 'A', code: 'assert(x)' }] })
    expect(normalizeCodeRunnerConfig(null, 'ruby')).toEqual({ enabled: false, language: 'ruby', starterCode: '', checks: [] })
    expect(activeRunnerChecks({ ...config, enabled: false })).toEqual([])
  })

  it('writes starter code and checks back, keeping other keys and leaving out empty ones', () => {
    expect(buildSubmissionConfigWithRunner({ other: 1 }, { enabled: true, language: 'ruby', starterCode: 'x = 1', checks: [{ id: 'a', name: 'A', code: 'assert true' }] }))
      .toEqual({ other: 1, runner: { enabled: true, language: 'ruby', starter_code: 'x = 1', checks: [{ id: 'a', name: 'A', code: 'assert true' }] } })
    expect(buildSubmissionConfigWithRunner(undefined, { enabled: false, language: 'ruby', starterCode: '  ', checks: [] }))
      .toEqual({ runner: { enabled: false, language: 'ruby' } })
  })

  it('makes check ids that are unique in the list', () => {
    expect(newCheckId([])).toBe('check-1')
    expect(newCheckId([{ id: 'check-2', name: '', code: '' }])).toBe('check-3')
    expect(newCheckId([{ id: 'check-2', name: '', code: '' }, { id: 'x', name: '', code: '' }])).toBe('check-3')
  })
})
