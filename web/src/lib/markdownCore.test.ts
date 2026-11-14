import { describe, expect, it } from 'vitest'
import { markdownToPlainText, parseInline, parseMessageBlocks } from './markdownCore'
import { editorJsonToMarkdown } from './messageFormat'
import { lanceNov11Editor, lanceNov11Markdown } from './markdownFixtures'

const t = (text: string) => ({ type: 'text', text })
const code = (text: string) => ({ type: 'code', text })

describe('parseInline', () => {
  it('renders bold around inline code as bold code (U-0.9)', () => {
    expect(parseInline('Run **`bin/rails db:migrate`** now')).toEqual([
      t('Run '), { type: 'strong', children: [code('bin/rails db:migrate')] }, t(' now'),
    ])
  })

  it('keeps bold labels that contain inline code', () => {
    expect(parseInline('**What `git init` does:** it turns')).toEqual([
      { type: 'strong', children: [t('What '), code('git init'), t(' does:')] }, t(' it turns'),
    ])
  })

  it('never italicizes snake_case and still italicizes _words_ (M-10)', () => {
    expect(parseInline('user_id and first_name_last')).toEqual([t('user_id and first_name_last')])
    expect(parseInline('a _real_ word')).toEqual([t('a '), { type: 'emphasis', children: [t('real')] }, t(' word')])
    expect(parseInline('an *intra*word')).toEqual([t('an '), { type: 'emphasis', children: [t('intra')] }, t('word')])
  })

  it('treats backslash escapes and unmatched delimiters as text', () => {
    expect(parseInline('\\*\\*not bold\\*\\* and 2 * 3 and C++ and ++i')).toEqual([t('**not bold** and 2 * 3 and C++ and ++i')])
    expect(parseInline('\\`not code\\`')).toEqual([t('`not code`')])
  })

  it('matches backtick runs so code can contain backticks', () => {
    expect(parseInline('``a`b`` and ` `` `')).toEqual([code('a`b'), t(' and '), code('``')])
    expect(parseInline('an `unclosed span')).toEqual([t('an `unclosed span')])
  })

  it('parses links, autolinks and bare URLs without eating emphasis markers', () => {
    expect(parseInline('[the **guide**](https://example.com/a_(b)) and <https://x.dev>')).toEqual([
      { type: 'link', href: 'https://example.com/a_(b)', children: [t('the '), { type: 'strong', children: [t('guide')] }] },
      t(' and '),
      { type: 'link', href: 'https://x.dev', children: [t('https://x.dev')] },
    ])
    expect(parseInline('**https://example.com/a_b_c**.')).toEqual([
      { type: 'strong', children: [{ type: 'link', href: 'https://example.com/a_b_c', children: [t('https://example.com/a_b_c')] }] },
      t('.'),
    ])
  })

  it('supports strike and the legacy underline mark, nested with other marks', () => {
    expect(parseInline('~~old~~ ++under **both**++')).toEqual([
      { type: 'strike', children: [t('old')] }, t(' '),
      { type: 'underline', children: [t('under '), { type: 'strong', children: [t('both')] }] },
    ])
  })
})

describe('parseMessageBlocks fences and headings', () => {
  it('closes an unterminated fence at the end of the message instead of failing (M-10)', () => {
    expect(parseMessageBlocks('Try this:\n```js\nconst a = 1')).toEqual([
      { type: 'paragraph', text: 'Try this:' },
      { type: 'code', language: 'js', code: 'const a = 1' },
    ])
  })

  it('only opens fences at the start of a line', () => {
    expect(parseMessageBlocks('Type ``` to start a block, then keep writing.')).toEqual([
      { type: 'paragraph', text: 'Type ``` to start a block, then keep writing.' },
    ])
  })

  it('uses a longer closing fence and supports tilde fences', () => {
    expect(parseMessageBlocks('````md\n```js\nx\n```\n````\n~~~\nplain\n~~~')).toEqual([
      { type: 'code', language: 'md', code: '```js\nx\n```' },
      { type: 'code', language: '', code: 'plain' },
    ])
  })

  it('keeps a fence inside a numbered list item and the numbering', () => {
    expect(parseMessageBlocks('1. Run:\n   ```bash\n   git status\n   ```\n2. Then push')).toEqual([{
      type: 'orderedList', items: [
        { text: 'Run:', children: [{ type: 'code', language: 'bash', code: 'git status' }] },
        { text: 'Then push', children: [] },
      ],
    }])
  })

  it('keeps the start number of a list that resumes after a code block', () => {
    expect(parseMessageBlocks('1. One\n\n```\nx\n```\n\n2. Two')).toEqual([
      { type: 'orderedList', items: [{ text: 'One', children: [] }] },
      { type: 'code', language: '', code: 'x' },
      { type: 'orderedList', start: 2, items: [{ text: 'Two', children: [] }] },
    ])
  })

  it('renders ## and ### headings but leaves # lines as text', () => {
    expect(parseMessageBlocks('## Week 10\n### Tuesday ###\n# not a heading')).toEqual([
      { type: 'heading', level: 2, text: 'Week 10' },
      { type: 'heading', level: 3, text: 'Tuesday' },
      { type: 'paragraph', text: '# not a heading' },
    ])
  })

  it('normalizes Windows line endings', () => {
    expect(parseMessageBlocks('a\r\nb\r\n\r\n```\r\nx\r\n```')).toEqual([
      { type: 'paragraph', text: 'a\nb' },
      { type: 'code', language: '', code: 'x' },
    ])
  })
})

describe('markdownToPlainText', () => {
  it('strips syntax for previews and notifications (M-8)', () => {
    expect(markdownToPlainText('**What `git init` does:** it _turns_ [a folder](https://x.dev) into a repo.\n\n```bash\nls -a\n```\n\n1. One\n2. Two'))
      .toBe('What git init does: it turns a folder into a repo. ls -a One Two')
    expect(markdownToPlainText('Run **`bin/rails db:migrate`** and user_id stays')).toBe('Run bin/rails db:migrate and user_id stays')
  })
})

describe('Lance’s Nov 11 message (M-1 acceptance fixture)', () => {
  it('serializes the composer document to the expected Markdown', () => {
    expect(editorJsonToMarkdown(lanceNov11Editor)).toBe(lanceNov11Markdown)
  })

  it('parses back to bold labels with code, two command blocks, and a numbered list', () => {
    const blocks = parseMessageBlocks(editorJsonToMarkdown(lanceNov11Editor))
    expect(blocks.filter((block) => block.type === 'code')).toEqual([
      { type: 'code', language: 'bash', code: 'cd ~\nls -a' },
      { type: 'code', language: 'bash', code: 'git config --global init.defaultBranch main' },
    ])
    const list = blocks.find((block) => block.type === 'orderedList')
    expect(list && 'items' in list ? list.items.map((item) => parseInline(item.text)) : []).toEqual([
      [t('Make the project folder: '), code('mkdir javascript_practice')],
      [t('Move the repo into it: '), code('mv .git README.md javascript_practice/')],
      [t('Check it: '), code('ls -a'), t(' and '), code('git status'), t(' inside '), code('javascript_practice')],
    ])
    const label = blocks.find((block) => block.type === 'paragraph' && block.text.startsWith('**What'))
    expect(label && 'text' in label ? parseInline(label.text)[0] : null).toEqual({
      type: 'strong', children: [t('What '), code('git init'), t(' does:')],
    })
    const last = blocks.at(-1)
    expect(last && 'text' in last ? parseInline(last.text) : null).toEqual([{
      type: 'emphasis', children: [t('Run '), { type: 'strong', children: [code('--global')] }, t(' once; it applies to every repo.')],
    }])
    expect(JSON.stringify(blocks)).not.toMatch(/[–—]global/)
  })
})
