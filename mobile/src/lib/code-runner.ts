export type CodeRunnerLanguage = 'ruby' | 'javascript';

export interface CodeRunnerConfig {
  enabled: boolean;
  language: CodeRunnerLanguage;
}

export function codeRunnerLanguageForFilename(filename: string): CodeRunnerLanguage {
  const extension = filename.trim().split('.').pop()?.toLowerCase();
  return ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx'].includes(extension || '') ? 'javascript' : 'ruby';
}

export function normalizeCodeRunnerConfig(config: unknown, fallback: CodeRunnerLanguage): CodeRunnerConfig {
  const runner = config && typeof config === 'object' ? (config as { runner?: unknown }).runner : null;
  if (!runner || typeof runner !== 'object') return { enabled: false, language: fallback };
  const candidate = runner as { enabled?: unknown; language?: unknown };
  return {
    enabled: candidate.enabled === true,
    language: candidate.language === 'ruby' || candidate.language === 'javascript' ? candidate.language : fallback,
  };
}

// Starter code and automated checks are authored on the web; keep them when the phone edits the runner.
export function submissionConfigWithRunner(existing: Record<string, unknown> | undefined, runner: CodeRunnerConfig, isTextSubmission: boolean) {
  const current = existing?.runner && typeof existing.runner === 'object' ? existing.runner as Record<string, unknown> : {};
  return {
    ...(existing || {}),
    runner: {
      ...current,
      enabled: isTextSubmission && runner.enabled,
      language: runner.language,
    },
  };
}
