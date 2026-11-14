import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import ruby from 'highlight.js/lib/languages/ruby'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

/**
 * Syntax highlighting for <CodeBlock>, loaded on demand so pages without code
 * never download it. Only the languages CSG teaches are registered, and only
 * labeled fences are highlighted: unlabeled code stays plain (design spec §8).
 */
hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('python', python)
hljs.registerLanguage('ruby', ruby)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerAliases(['sh', 'shell', 'zsh', 'console', 'terminal'], { languageName: 'bash' })
hljs.registerAliases(['html', 'erb', 'svg'], { languageName: 'xml' })
hljs.registerAliases(['jsx'], { languageName: 'javascript' })
hljs.registerAliases(['tsx'], { languageName: 'typescript' })

/** Highlighted HTML (hljs escapes the code and emits only class-named spans), or null for unknown languages. */
export function highlightCode(code: string, language: string): string | null {
  const name = language.trim().toLowerCase()
  if (!name || !hljs.getLanguage(name)) return null
  return hljs.highlight(code, { language: name, ignoreIllegals: true }).value
}
