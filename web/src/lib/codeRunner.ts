export type CodeRunnerLanguage = 'ruby' | 'javascript'

/** An automated check: code that runs after the student's code and fails by raising. */
export interface CodeRunnerCheck {
  id: string
  name: string
  code: string
}

export interface CodeRunnerConfig {
  enabled: boolean
  language: CodeRunnerLanguage
  /** Prefills the student's editor before they have a draft or a submission. */
  starterCode?: string
  checks?: CodeRunnerCheck[]
}

export const CODE_RUNNER_TIMEOUT_MS = 3000
/** The API's limits on submission_config.runner (ContentBlock). */
export const CODE_RUNNER_LIMITS = {
  checks: 20,
  starterCode: 20_000,
  checkId: 64,
  checkName: 120,
  checkCode: 10_000,
} as const

export function isRunnableLanguage(language: string): language is CodeRunnerLanguage {
  return language === 'ruby' || language === 'javascript'
}

export function codeRunnerLanguageFromEditor(language: string): CodeRunnerLanguage | null {
  if (language === 'ruby') return 'ruby'
  if (language === 'javascript' || language === 'typescript') return 'javascript'
  return null
}

function normalizeChecks(value: unknown): CodeRunnerCheck[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((check) => {
    if (!check || typeof check !== 'object') return []
    const { id, name, code } = check as Record<string, unknown>
    return typeof id === 'string' && typeof name === 'string' && typeof code === 'string' ? [{ id, name, code }] : []
  })
}

export function normalizeCodeRunnerConfig(
  config: unknown,
  fallbackLanguage: CodeRunnerLanguage = 'ruby'
): CodeRunnerConfig {
  if (!config || typeof config !== 'object') {
    return {
      enabled: false,
      language: fallbackLanguage,
      starterCode: '',
      checks: [],
    }
  }

  const runner = (config as { runner?: unknown }).runner
  if (!runner || typeof runner !== 'object') {
    return {
      enabled: false,
      language: fallbackLanguage,
      starterCode: '',
      checks: [],
    }
  }

  const candidate = runner as Record<string, unknown>
  return {
    enabled: Boolean(candidate.enabled),
    language: isRunnableLanguage(String(candidate.language)) ? candidate.language as CodeRunnerLanguage : fallbackLanguage,
    starterCode: typeof candidate.starter_code === 'string' ? candidate.starter_code : '',
    checks: normalizeChecks(candidate.checks),
  }
}

/** The runner's checks when they would run: the runner is on and has at least one. */
export function activeRunnerChecks(runner: CodeRunnerConfig): CodeRunnerCheck[] {
  return runner.enabled ? runner.checks ?? [] : []
}

export function buildSubmissionConfigWithRunner(
  existingConfig: Record<string, unknown> | undefined,
  runner: CodeRunnerConfig
): Record<string, unknown> {
  const starterCode = runner.starterCode ?? ''
  const checks = runner.checks ?? []
  return {
    ...(existingConfig || {}),
    runner: {
      enabled: runner.enabled,
      language: runner.language,
      ...(starterCode.trim() ? { starter_code: starterCode } : {}),
      ...(checks.length ? { checks: checks.map(({ id, name, code }) => ({ id, name, code })) } : {}),
    },
  }
}

/** A new check id, unique among `existing`. */
export function newCheckId(existing: CodeRunnerCheck[]): string {
  const taken = new Set(existing.map((check) => check.id))
  for (let index = existing.length + 1; ; index += 1) {
    const id = `check-${index}`
    if (!taken.has(id)) return id
  }
}
