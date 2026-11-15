import type { ResolvedTheme } from './themeColors'

/**
 * Monaco takes hex colours, not CSS variables. These mirror the code tokens
 * in index.css (asserted in theme.test.ts), so the editor matches <CodeBlock>.
 */
export const MONACO_COLORS = {
  light: { background: '#f6f7f9', foreground: '#1e293b', lineNumber: '#5f6b7f', lineHighlight: '#eef0f3', selection: '#bfdbfe', keyword: '#8a2a8f', string: '#166534', number: '#9a4a06', comment: '#5f6b7f', type: '#9c292b', function: '#1d4ed8' },
  dark: { background: '#0f141b', foreground: '#dbe2ea', lineNumber: '#7f8a9c', lineHighlight: '#151b23', selection: '#1e3a5f', keyword: '#d7a6f5', string: '#8fdca8', number: '#f5c04a', comment: '#8d98aa', type: '#ec9496', function: '#8dbdff' },
} as const

export const MONACO_THEME_NAMES: Record<ResolvedTheme, string> = { light: 'csg-light', dark: 'csg-dark' }

type MonacoLike = { editor: { defineTheme: (name: string, data: unknown) => void } }

export function defineMonacoThemes(monaco: MonacoLike) {
  for (const theme of ['light', 'dark'] as const) {
    const c = MONACO_COLORS[theme]
    const hex = (value: string) => value.replace('#', '')
    monaco.editor.defineTheme(MONACO_THEME_NAMES[theme], {
      base: theme === 'dark' ? 'vs-dark' : 'vs',
      inherit: true,
      rules: [
        { token: 'keyword', foreground: hex(c.keyword) },
        { token: 'string', foreground: hex(c.string) },
        { token: 'number', foreground: hex(c.number) },
        { token: 'comment', foreground: hex(c.comment), fontStyle: 'italic' },
        { token: 'type', foreground: hex(c.type) },
        { token: 'function', foreground: hex(c.function) },
      ],
      colors: {
        'editor.background': c.background,
        'editor.foreground': c.foreground,
        'editorLineNumber.foreground': c.lineNumber,
        'editor.lineHighlightBackground': c.lineHighlight,
        'editor.selectionBackground': c.selection,
        'editorGutter.background': c.background,
      },
    })
  }
}
