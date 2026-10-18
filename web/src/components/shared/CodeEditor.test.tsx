import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

const editorProps: Array<Record<string, unknown>> = []
vi.mock('@monaco-editor/react', () => ({
  default: (props: Record<string, unknown>) => {
    editorProps.push(props)
    return null
  },
}))

import { CodeEditor, detectLanguage, indentSizeFor } from './CodeEditor'

describe('CodeEditor indentation', () => {
  it('indents Python with 4 spaces and web languages with 2', () => {
    expect(indentSizeFor('python')).toBe(4)
    expect(indentSizeFor('ruby')).toBe(2)
    expect(indentSizeFor('javascript')).toBe(2)
  })

  it('passes the language indent to Monaco and labels it for learners', () => {
    editorProps.length = 0
    const html = renderToStaticMarkup(<CodeEditor value="" language="python" showKeyboardHelp />)
    const options = editorProps[0].options as Record<string, unknown>
    expect(options.tabSize).toBe(4)
    expect(options.insertSpaces).toBe(true)
    expect(options.detectIndentation).toBe(false)
    expect(html).toContain('Python · Tab = 4 spaces')
    expect(html).toContain('Esc')
    expect(html).toContain('Tab indents')
  })

  it('omits keyboard help for read-only editors', () => {
    const html = renderToStaticMarkup(<CodeEditor value="x" language="python" readOnly showKeyboardHelp />)
    expect(html).not.toContain('Tab indents')
  })

  it('detects pilot filenames', () => {
    expect(detectLanguage('budget_decision.py')).toBe('python')
    expect(detectLanguage('plan.md')).toBe('markdown')
  })
})
