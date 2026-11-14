/** Editor language from an exercise filename or admin hint (shared by the code editor and grading). */
export function detectLanguageFromName(name: string): string | null {
  if (name.includes('.rb') || name.includes('ruby') || name.includes('rails')) return 'ruby'
  if (name.includes('.py') || name.includes('python')) return 'python'
  if (name.includes('.tsx') || name.includes('.ts') || name.includes('typescript')) return 'typescript'
  if (name.includes('.jsx')) return 'javascript'
  if (name.includes('.json') || name.includes('json')) return 'json'
  if (name.includes('.js') || name.includes('javascript')) return 'javascript'
  if (name.includes('.html') || name.includes('html')) return 'html'
  if (name.includes('.css') || name.includes('css')) return 'css'
  if (name.includes('.sql') || name.includes('sql')) return 'sql'
  if (name.includes('.sh') || name.includes('bash') || name.includes('shell')) return 'shell'
  if (name.endsWith('.md') || name.includes('markdown')) return 'markdown'
  return null
}

/** The language a filename or admin hint names, or null when neither names one (no Ruby fallback). */
export function namedLanguage(filename?: string | null, hint?: string | null): string | null {
  return (filename ? detectLanguageFromName(filename.toLowerCase()) : null) || (hint ? detectLanguageFromName(hint.toLowerCase()) : null)
}
