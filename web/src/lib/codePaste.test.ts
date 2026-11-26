import { describe, expect, it } from 'vitest'
import { fencedCodeInsertion, isInsideMarkdownFence, isMultiLinePaste, looksLikeCode, normalizePastedCode } from './codePaste'

const python = 'amount = 125\nbudget = 100\n\nif amount < budget:\n    print("Under budget")\nelse:\n    print("Over budget")'

describe('code paste detection', () => {
  it('keeps indented Python as code', () => {
    expect(looksLikeCode(python)).toBe(true)
    expect(looksLikeCode('def total(items):\n\treturn sum(items)')).toBe(true)
  })

  it('recognizes unindented code by its lines', () => {
    expect(looksLikeCode('first = "12"\nsecond = "3"\nprint(int(first) + int(second))')).toBe(true)
  })

  it('recognizes terminal commands, shell prompts, and error output as code', () => {
    expect(looksLikeCode('git status\ngit add .\ngit commit -m "Update README"\ngit push')).toBe(true)
    expect(looksLikeCode('git restore README.md\ngit checkout main\ngit pull')).toBe(true)
    expect(looksLikeCode('cd ~\nrm -rf .git')).toBe(true)
    expect(looksLikeCode('$ npm install\n$ npm run dev')).toBe(true)
    expect(looksLikeCode('PS C:\\Users\\lance\\project> node -v\nnode : The term \'node\' is not recognized as the name of a cmdlet\nAt line:1 char:1\n+ node -v\n+ ~~~~')).toBe(true)
    expect(looksLikeCode('error: Your local changes to the following files would be overwritten by checkout:\n        README.md\nPlease commit your changes or stash them before you switch branches.\nAborting')).toBe(true)
    expect(looksLikeCode('Traceback (most recent call last):\n  File "app.py", line 12, in <module>\nTypeError: unsupported operand type(s)')).toBe(true)
    expect(looksLikeCode('TypeError: Cannot read properties of undefined (reading \'map\')\n    at App (src/App.tsx:14:21)\n    at renderWithHooks (react-dom.js:14985:18)')).toBe(true)
    expect(looksLikeCode('npm ERR! code ENOENT\nnpm ERR! syscall open')).toBe(true)
    expect(looksLikeCode('$ git status\nOn branch main\nnothing to commit, working tree clean')).toBe(true)
  })

  it('leaves prose, single lines, bullets, and fenced markdown alone', () => {
    expect(looksLikeCode('Hi Ana,\n\nI finished the checkpoint early. Could we meet Tuesday instead?\nThanks!')).toBe(false)
    expect(looksLikeCode('Hi Leon,\nI got an error when I tried to push.\nCan you help me check it?')).toBe(false)
    expect(looksLikeCode('Hint: Read the prompt again.\nTry a smaller example.')).toBe(false)
    expect(looksLikeCode('docker works well on macOS\nwe can try it tomorrow')).toBe(false)
    expect(looksLikeCode(` at ${'a'.repeat(5000)} without a location\nsecond plain line`)).toBe(false)
    expect(looksLikeCode('1. First pull main\n2. Then run the tests')).toBe(false)
    expect(looksLikeCode('print("hello")')).toBe(false)
    expect(looksLikeCode('git status')).toBe(false)
    expect(looksLikeCode('Things to fix:\n  - the name\n  - the colon')).toBe(false)
    expect(looksLikeCode('```python\nprint(1)\n```')).toBe(false)
    expect(looksLikeCode('~~~text\n  a\n~~~')).toBe(false)
    expect(looksLikeCode('Things to fix:\nsee the notes (above)')).toBe(false)
    expect(looksLikeCode('foo()\nbar()')).toBe(true)
  })

  it('normalizes line endings and non-breaking spaces without touching indentation', () => {
    expect(normalizePastedCode('if x:\r\n\u00a0\u00a0\u00a0\u00a0y()\r\n\r\n')).toBe('if x:\n    y()')
    expect(isMultiLinePaste('one\n\ntwo')).toBe(true)
    expect(isMultiLinePaste('one\n')).toBe(false)
  })
})

describe('markdown fences for the message edit box', () => {
  it('knows when the cursor is inside a fence', () => {
    const text = 'hi\n```python\nx = 1\n```\nafter'
    expect(isInsideMarkdownFence(text, text.indexOf('x = 1'))).toBe(true)
    expect(isInsideMarkdownFence(text, text.indexOf('after'))).toBe(false)
    expect(isInsideMarkdownFence(text, 1)).toBe(false)
    expect(isInsideMarkdownFence('```\nopen', 6)).toBe(true)
  })

  it('does not treat triple backticks used inline as an opening fence', () => {
    const text = 'Run ```npm install``` first\nthen paste here'
    expect(isInsideMarkdownFence(text, text.length)).toBe(false)
    const tilde = '~~~ `x`\ncode'
    expect(isInsideMarkdownFence(tilde, tilde.length)).toBe(true)
  })

  it('puts pasted code on its own lines inside a fence', () => {
    expect(fencedCodeInsertion('', 0, 0, 'def f():\n    return 1')).toBe('```\ndef f():\n    return 1\n```\n')
    expect(fencedCodeInsertion('Look: ', 6, 6, 'a\n  b')).toBe('\n```\na\n  b\n```\n')
    expect(fencedCodeInsertion('x\n\nmore', 2, 2, 'a\n  b')).toBe('```\na\n  b\n```')
  })

  it('uses a longer fence when the code itself contains backticks', () => {
    expect(fencedCodeInsertion('', 0, 0, 'print("```")\n  x')).toBe('````\nprint("```")\n  x\n````\n')
  })
})
