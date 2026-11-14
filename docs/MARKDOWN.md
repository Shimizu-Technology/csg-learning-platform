# Markdown in CSG Learn

Everything people write in CSG Learn is stored as Markdown and read back through one pipeline. This page records how it works and the rules every surface follows. The two-mode editor (design spec §9, W2 PR 2.2b) builds on it.

## Where text is written and read

| Text | Stored as | Web display | Mobile display |
| --- | --- | --- | --- |
| Messages and class chat | `messages.body` | `FormattedMessage` (message parser) | `FormattedMessage` (same parser) |
| Updates (announcements) | `announcements.body` | `MarkdownText` | `AuthoredContent written` |
| Grading feedback | `submissions.feedback` | `FeedbackBody` → `MarkdownText` | `AuthoredContent written` |
| Help-request replies | `help_requests.staff_response` | `MarkdownText` | `AuthoredContent written` |
| Text submissions (staff view) | `submissions.text` | Formatted (`MarkdownText`) or Source (code editor) | unchanged (code view) |
| Lesson text | `content_blocks.body` | `MarkdownRenderer` (lesson variant) | `AuthoredContent` |
| Previews: inbox rows, search, pins, notification cards | any of the above | `markdownToPlainText` / `markdownExcerpt` | same |
| Push, web push and email bodies (messages, updates, grading feedback) | any of the above | `MarkdownExcerpt` (API), applied when each is sent | same |

In-app notification bodies keep the original Markdown, and each surface strips it once when it shows or sends it. Stripping it before storing would strip it twice and turn a sender's escaped `\*\*stars\*\*` back into formatting.

Rows inside a link (Support queue "Recently resolved", Student workspace help requests) show the plain-text excerpt, because rendered links and code blocks can't sit inside another link.

## Three renderers, one syntax

**The canonical syntax is CommonMark plus GFM.** On the web it's rendered by react-markdown with remark-gfm (`web/src/components/shared/MarkdownRenderer.tsx`); on mobile by marked with GFM (`mobile/src/lib/lesson-markdown.ts`). These handle long-form text: lessons, updates, feedback, help replies and submissions.

**Messages use a smaller parser** (`web/src/lib/markdownCore.ts`, copied byte for byte to `mobile/src/lib/markdown-core.ts`). It exists because messages need mentions, chat-sized styling, and identical output on web and mobile without a DOM. Its inline rules are micromark's (the parser inside react-markdown): CommonMark's delimiter-run algorithm, with micromark's two refinements (a neighbouring `*`, `_` or `~` counts as a word character for emphasis, and the rule of three uses what is left of each run).

Tests hold them together:

- `markdownConformance.test.tsx` renders every construct in the supported syntax through all three renderers (the message renderer, react-markdown, and the mobile marked renderer compiled into the web test) and compares the resulting structure. It also round-trips composer paragraphs with overlapping marks through the serializer and checks that every renderer shows each character with the marks it was sent with, and compares the message parser with react-markdown on 400 seeded random emphasis strings.
- `messageFormat.native-parity.test.ts` fails if the web and mobile copies of the message parser differ, and compares their output on real message patterns.

## Supported syntax (design spec §9.3)

Both parsers render all of this the same way:

- Paragraphs. **A single newline is a line break** in everything people write (messages, updates, feedback, help replies, submissions). Lesson text keeps CommonMark's rule, where a single newline is a space, because lesson source is often hard-wrapped.
- `**bold**`, `_italic_` or `*italic*`, `` `inline code` ``, and bold or italic around inline code (`**`git init`**` is bold code).
- Fenced code blocks with ```` ``` ```` or `~~~` and an optional language. A fence must start its own line. A fence that's never closed runs to the end of the text, and the API closes it when the text is saved.
- Bulleted (`-`, `*`, `+`) and numbered (`1.`, `1)`) lists. A numbered list keeps its starting number, so a list split by a code block continues at 2.
- `> quotes`, `[links](https://…)`, `<https://…>` and bare `https://` or `www.` URLs.
- `##` and `###` headings. Messages and written text start one level down (`##` is an `h3`), because they always sit under a page or card title.
- `~~strike~~`.

### Italics and underscores

Emphasis follows CommonMark's flanking rules in every parser. An underscore inside a word never starts or ends italics, so `snake_case`, `user_id` and `my__dunder__name` stay as typed, while `_italic_` with spaces or punctuation around it is italic. A standalone `__init__` is bold in CommonMark (GitHub shows it the same way), so the composer escapes it. `*` can italicize part of a word (`un*believ*able`), which is why the serializer switches to `*` there.

### How the composer writes overlapping marks

Marks in the editor can overlap without nesting (italic `a`, bold italic `b`, bold `c`). The serializer opens the mark that lasts longest first and closes and reopens the others. Markdown parsers disagree about runs like `*****` where a closing run meets an opening run of the same character, so the serializer alternates `*` and `_` there: that example is written `*a**b***__c__`, which all three renderers read the same way.

Two things can't be written in CommonMark at all, and the composer can't fix them by choosing delimiters:

- A formatted span that starts or ends with punctuation or inline code right against a letter, like bold `x.` directly followed by `b`: a delimiter between punctuation and a letter only opens or closes in one direction.
- Two marks that start or end at the same point inside a word (`a` + strike-and-italic `ef`).

These are rare in practice. The 2.2b editor can warn about them. For text separated by spaces the round trip is exact: a one-off check of 100,000 random composer paragraphs (bold, italic, strike and code, Nov 15, 2026) found no differences between the three renderers or from what was sent. Inside a word, marked (mobile long-form only, not messages) still differs from CommonMark on a few close-and-reopen runs.

### Escaping

A backslash before ASCII punctuation makes it literal (`\*not bold\*`). The message composer escapes what the sender typed literally so the reader sees the same characters. It escapes only what could become formatting at that position: a `*` run that could open or close emphasis (`*word*`, `2*3*4`), every backtick, an `_`, `~~` or `++` that could open formatting, `[` before `](`, entities like `&amp;`, and list, quote, heading and fence markers at the start of a line. `2 * 3`, `a * b`, prices, `snake_case`, `C++` and Windows paths are stored as typed.

Common HTML entities (`&amp;`, `&lt;`, `&gt;`, `&quot;`, `&apos;`, `&nbsp;`, a few typographic ones and numeric references) read as their character in every renderer; `\&amp;` stays `&amp;`.

### Differences outside the supported syntax

These render differently in a message and in long-form text. They aren't in §9.3, and the two-mode editor will show them as locked Markdown (§9.6):

| Markdown | Long-form (lessons, updates, feedback) | Messages |
| --- | --- | --- |
| `# Heading`, `####`… | Heading | Plain text (pasted shell and Python comments start with `#`) |
| Tables, task lists `- [ ]` | Table, checkboxes | Plain text |
| `---` | Horizontal rule | Plain text |
| A line right after a list item, not indented | Joins the item (lazy continuation) | Ends the list |
| Raw HTML (`<div>`) | Shown as typed in written text, even when the text starts with a tag; dropped in lessons on the web (react-markdown never renders it) | Shown as typed |
| `++underline++` | Plain text | Underlined (the composer's legacy underline) |

## Code blocks

Every fenced block renders through `CodeBlock` (`web/src/components/shared/CodeBlock.tsx`; `MessageCodeBlock` on mobile): language label and Copy in a 36px header, monospace that scrolls sideways instead of wrapping, and the code and syntax colors from design spec §7. Single-line snippets in messages with no language drop the header and show Copy in the corner. Unlabeled fences are always blocks, never inline, and they aren't highlighted.

Syntax highlighting uses highlight.js core with Bash, CSS, JavaScript, JSON, Python, Ruby, SQL, TypeScript and HTML/XML registered. It's a separate 22 kB (gzip) chunk that loads only when a labeled code block comes within a screen of the viewport (IntersectionObserver). The highlighted HTML is sanitized with DOMPurify (only `span` with `class`) before it reaches the page.

## Safety

- Long-form Markdown never renders raw HTML: react-markdown ignores it in lessons, and in written text a remark plugin turns it into visible text. Only lessons check for legacy HTML bodies (from the old rich-text editors), which go through DOMPurify on the web and the native HTML renderer on mobile. Written text (messages, updates, feedback, help replies, submissions) never takes that path, so an update that starts with `<div>` shows the tag.
- Links: react-markdown's URL filter drops `javascript:` and other unsafe protocols; messages accept only `http(s)` and `mailto` links (`normalizeLinkHref` on web, `normalizeMessageLink` on mobile); marked on mobile uses `safeExternalUrl`.

## Storage hygiene (API)

`MarkdownText.normalize` (`api/app/services/markdown_text.rb`) runs on `Message#body`, `Announcement#body`, `Submission#feedback` and `HelpRequest#staff_response` through Rails `normalizes`. It turns `\r\n` into `\n` and closes a code fence left open at the top level. It never changes valid Markdown: it recognizes list and quote prefixes and CommonMark indentation, matches closing fences leniently, and leaves an open fence inside a list item or quote alone (CommonMark ends it with its container). It's idempotent.

## Plain-text excerpts

Previews and notification bodies are read from the parsed structure, never by stripping syntax with regular expressions:

- Web and mobile `markdownExcerpt` walk the message parser's tree (`markdownToPlainText` with `longForm`, which also reads `#` and `####` headings, `---` rules and GFM tables the way long-form text renders them).
- The API's `MarkdownExcerpt` walks a CommonMark + GFM tree from the `commonmarker` gem.

Both keep inline code text (`<div>` and `a\*b` inside code stay as written), keep an autolink's URL, decode entities, keep escaped literals literal, show HTML typed into the text as typed (a block that starts with an HTML tag, like `<div>`, is kept exactly as typed, entities included, because that's how CommonMark and the written renderers show it), and keep the first line of each code block. `fixtures/markdown-excerpts.json` holds the input and expected excerpt pairs that the Ruby, web and mobile tests all read. One known difference: comrak (inside `commonmarker`) also strikes through single tildes (`~a~`), which the web renderer leaves as typed, so an API excerpt can drop those tildes.

## Changes from the previous renderer

Measured against production on Nov 15, 2026 (read-only): only 2 messages from the last 90 days contain a mid-word `*` or HTML-like text, and one native app install exists (the admin's TestFlight build, app 1.0.0). Stored data isn't rewritten. What reads differently:

- **Intraword asterisks.** A message typed before the composer escaped asterisks, like `a*b*c`, now shows `b` in italics (CommonMark). `2 * 3` and other spaced asterisks are unchanged.
- **Text that starts with HTML.** Updates, feedback and help replies that start with a tag show the tags as typed instead of rendering them.
- **Entities and email autolinks.** `&amp;` in a message reads as `&`; `<help@example.com>` is a link; `<mailto:…>` keeps `mailto:` in its label, as on the web long-form renderer.
- **Excerpts** keep `<div>` and other typed tags instead of deleting them, and keep backslashes inside code.

The native message parser and long-form renderer changed with the web ones. The TestFlight build that follows this merge has to include them; older builds keep the previous parser.
