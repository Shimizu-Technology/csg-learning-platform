import type { JSONContent } from '@tiptap/core'

/**
 * Shared Markdown fixtures for the message parser, the long-form renderer and
 * (in 2.2b) the two-mode editor's round-trip tests.
 */

const text = (value: string, ...marks: string[]): JSONContent => (
  marks.length ? { type: 'text', text: value, marks: marks.map((type) => ({ type })) } : { type: 'text', text: value }
)
const paragraph = (...content: JSONContent[]): JSONContent => ({ type: 'paragraph', content })
const codeBlock = (language: string, code: string): JSONContent => ({ type: 'codeBlock', attrs: { language }, content: [text(code)] })
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content: [paragraph(...content)] })

/**
 * Leon's Nov 11, 2026 reply to Lance (git init in the home folder), rebuilt
 * from the Brain Dump notes as the composer would hold it: bold labels with
 * inline code inside, two fenced command blocks, and a numbered list.
 */
export const lanceNov11Editor: JSONContent = {
  type: 'doc',
  content: [
    paragraph(text('Good news first: your push worked. The repo has your README and "first commit".')),
    paragraph(
      text('What ', 'bold'), text('git init', 'bold', 'code'), text(' does:', 'bold'),
      text(' it turns the current folder into a Git repo by adding a hidden '), text('.git', 'code'),
      text(' folder. You ran GitHub\'s "create a new repo" commands from your home folder, so '),
      text('/home/lhsin', 'code'), text(' became a repo. Rails hid this before because '),
      text('rails new', 'code'), text(' runs it for you.'),
    ),
    paragraph(text('See it:', 'bold'), text(' from your home folder, run')),
    codeBlock('bash', 'cd ~\nls -a'),
    paragraph(text('Fix it', 'bold'), text(' (keeps your commit and the remote):')),
    { type: 'orderedList', content: [
      item(text('Make the project folder: '), text('mkdir javascript_practice', 'code')),
      item(text('Move the repo into it: '), text('mv .git README.md javascript_practice/', 'code')),
      item(text('Check it: '), text('ls -a', 'code'), text(' and '), text('git status', 'code'), text(' inside '), text('javascript_practice', 'code')),
    ] },
    paragraph(text('One more setting', 'bold'), text(' so new repos start on '), text('main', 'code'), text(':')),
    codeBlock('bash', 'git config --global init.defaultBranch main'),
    paragraph(text('Run ', 'italic'), text('--global', 'italic', 'bold', 'code'), text(' once; it applies to every repo.', 'italic')),
  ],
}

export const lanceNov11Markdown = [
  'Good news first: your push worked. The repo has your README and "first commit".',
  '',
  '**What `git init` does:** it turns the current folder into a Git repo by adding a hidden `.git` folder. You ran GitHub\'s "create a new repo" commands from your home folder, so `/home/lhsin` became a repo. Rails hid this before because `rails new` runs it for you.',
  '',
  '**See it:** from your home folder, run',
  '',
  '```bash',
  'cd ~',
  'ls -a',
  '```',
  '',
  '**Fix it** (keeps your commit and the remote):',
  '',
  '1. Make the project folder: `mkdir javascript_practice`',
  '2. Move the repo into it: `mv .git README.md javascript_practice/`',
  '3. Check it: `ls -a` and `git status` inside `javascript_practice`',
  '',
  '**One more setting** so new repos start on `main`:',
  '',
  '```bash',
  'git config --global init.defaultBranch main',
  '```',
  '',
  '_Run **`--global`** once; it applies to every repo._',
].join('\n')

/**
 * Patterns real CSG messages use (from production message bodies, anonymized):
 * the parser must keep rendering each of them the same way.
 */
export const realMessagePatterns = [
  'Hi! I ran `git init` in my home folder by accident. How may this be fixed?',
  'Welcome to week 10! This week is **JavaScript**. Post questions here.',
  'Good news first: your push worked.\n\n**What `git init` does:** it turns the current folder into a repo.\n\n```bash\ncd ~\nls -a\n```\n\n1. Move `.git` into your project folder\n2. Run `git status` there',
  'Reminders for tonight:\n- Bring your laptop charger\n- Pull the latest `main`\n- Read https://docs.github.com/en/get-started before class.',
  '1. Open the terminal\n2. Run `bundle install`\n3. Start the server with `bin/dev`',
  '@Alex Rivera can you post your error here?',
  '@everyone office hours moved to 6:00 PM.',
  'Check [the Rails guide](https://guides.rubyonrails.org/getting_started.html) and the screenshot.',
  '> Is the loops exercise due Friday or Sunday?\n\nSunday at midnight.',
  'My method:\n\n```ruby\ndef full_name\n  "#{first_name} #{last_name}"\nend\n```\nIt prints nil.',
  'Use snake_case for Ruby methods like `first_name` and user_id.',
  'Line one\nLine two\nLine three',
  '**bold** _italic_ ~~strike~~ ++underline++',
  'See www.codeschoolofguam.com, or email us.',
  // Typed before the composer escaped asterisks. Since the CommonMark parser
  // (Nov 2026) the middle letter is italic; 2 * 3 stays as typed.
  'Legacy a*b*c and 2 * 3 = 6',
]

/**
 * Composer paragraphs whose marks overlap instead of nesting, plus literal
 * characters that look like Markdown. The serializer must write Markdown that
 * the message parser, react-markdown and marked all read back as sent.
 */
export const overlappingMarkParagraphs: JSONContent[] = [
  paragraph(text('a', 'italic'), text('b', 'italic', 'bold'), text('c', 'bold')),
  paragraph(text('Read '), text('the docs ', 'italic'), text('right now', 'italic', 'bold'), text(' today', 'bold')),
  paragraph(text('Run ', 'bold'), text('git init', 'bold', 'code'), text(' first', 'bold'), text(' then push')),
  paragraph(text('Both at once', 'bold', 'italic'), text(' then bold', 'bold'), text(' then plain')),
  paragraph(text('Both at once', 'bold', 'italic'), text(' then italic', 'italic')),
  paragraph(text('old', 'strike'), text(' and bold', 'strike', 'bold'), text(' bold', 'bold')),
  paragraph(text('Use ', 'italic'), text('--global', 'italic', 'code'), text(' once', 'italic'), text(' and ', 'bold'), text('main', 'bold', 'code')),
  paragraph(text('un'), text('believ', 'italic'), text('able and '), text('snake_case', 'italic'), text(' names')),
  paragraph(text('2 * 3 = 6, a * b, $5 * 2 and *not italic* or **not bold** typed as is')),
  // Literal underscores at the edges of marked text must not close a generated `_` or `__`.
  paragraph(text('foo_', 'bold'), text('bar', 'italic')),
  paragraph(text('_private', 'italic'), text(' then plain')),
  paragraph(text('trailing_', 'italic'), text(' then plain')),
  paragraph(text('mid_ dle', 'italic'), text(' and '), text('a_ b', 'bold')),
  paragraph(text('Use '), text('snake_case names', 'bold'), text(' and '), text('__init__', 'italic'), text(' methods')),
  paragraph(text('x', 'italic'), text('_y'), text(' and '), text('z_', 'bold'), text('_w')),
  paragraph(text('end', 'italic'), text('next'), text(' and '), text('a~~ b', 'strike'), text(' done')),
]

/**
 * Marks CommonMark can't close or open where they were placed: a closing
 * delimiter between punctuation and a letter, or an opening one between a
 * letter and punctuation. The serializer moves that punctuation outside the
 * mark (docs/MARKDOWN.md); `read` is what every renderer shows.
 */
export const unflankedPunctuationParagraphs: { paragraph: JSONContent; markdown: string; read: string }[] = [
  { paragraph: paragraph(text('foo_', 'bold', 'italic'), text('bar', 'bold')), markdown: '**_foo_\\_bar**', read: 'f:bi|o:bi|o:bi|_:b|b:b|a:b|r:b' },
  { paragraph: paragraph(text('end.', 'italic'), text('next')), markdown: '_end_.next', read: 'e:i|n:i|d:i|.:|n:|e:|x:|t:' },
  { paragraph: paragraph(text('see'), text('.env', 'bold'), text(' file')), markdown: 'see.**env** file', read: 's:|e:|e:|.:|e:b|n:b|v:b| |f:|i:|l:|e:' },
  { paragraph: paragraph(text('a', 'italic'), text('b!', 'bold', 'italic'), text('c', 'italic')), markdown: '_a**b**!c_', read: 'a:i|b:bi|!:i|c:i' },
]
