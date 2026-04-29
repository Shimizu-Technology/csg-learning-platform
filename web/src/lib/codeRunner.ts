export type CodeRunnerLanguage = 'ruby' | 'javascript'

export interface CodeRunnerConfig {
  enabled: boolean
  language: CodeRunnerLanguage
  timeout_ms: number
}

export const DEFAULT_CODE_RUNNER_TIMEOUT_MS = 3000

export function isRunnableLanguage(language: string): language is CodeRunnerLanguage {
  return language === 'ruby' || language === 'javascript'
}

export function normalizeCodeRunnerLanguage(language: string | null | undefined): CodeRunnerLanguage {
  return language === 'javascript' ? 'javascript' : 'ruby'
}

export function codeRunnerLanguageFromEditor(language: string): CodeRunnerLanguage | null {
  if (language === 'ruby') return 'ruby'
  if (language === 'javascript' || language === 'typescript') return 'javascript'
  return null
}

export function normalizeCodeRunnerConfig(
  config: unknown,
  fallbackLanguage: CodeRunnerLanguage = 'ruby'
): CodeRunnerConfig {
  if (!config || typeof config !== 'object') {
    return {
      enabled: false,
      language: fallbackLanguage,
      timeout_ms: DEFAULT_CODE_RUNNER_TIMEOUT_MS,
    }
  }

  const runner = (config as { runner?: unknown }).runner
  if (!runner || typeof runner !== 'object') {
    return {
      enabled: false,
      language: fallbackLanguage,
      timeout_ms: DEFAULT_CODE_RUNNER_TIMEOUT_MS,
    }
  }

  const candidate = runner as Partial<CodeRunnerConfig>
  return {
    enabled: Boolean(candidate.enabled),
    language: isRunnableLanguage(String(candidate.language)) ? candidate.language as CodeRunnerLanguage : fallbackLanguage,
    timeout_ms: DEFAULT_CODE_RUNNER_TIMEOUT_MS,
  }
}

export function buildSubmissionConfigWithRunner(
  existingConfig: Record<string, unknown> | undefined,
  runner: CodeRunnerConfig
): Record<string, unknown> {
  return {
    ...(existingConfig || {}),
    runner: {
      enabled: runner.enabled,
      language: runner.language,
      timeout_ms: DEFAULT_CODE_RUNNER_TIMEOUT_MS,
    },
  }
}
