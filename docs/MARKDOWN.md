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
| Push, web push and email bodies | any of the above | `MarkdownExcerpt` (API), applied when each is sent | same |

In-app notification bodies keep the original Markdown, and each surface strips it once when it shows or sends it. Stripping it before storing would strip it twice and turn a sender's escaped `\*\*stars\*\*` back into formatting.

Rows inside a link (Support queue "Recently resolved", Student workspace help requests) show the plain-text excerpt, because rendered links and code blocks can't sit inside another link.

## Two parsers, one syntax

**The canonical syntax is CommonMark plus GFM.** On the web it's rendered by react-markdown with remark-gfm (`web/src/components/shared/MarkdownRenderer.tsx`); on mobile by marked with GFM (`mobile/src/lib/lesson-markdown.ts`). These handle long-form text: lessons, updates, feedback, help replies and submissions.

**Messages use a smaller parser** (`web/src/lib/markdownCore.ts`, copied byte for byte to `mobile/src/lib/markdown-core.ts`). It exists because messages need mentions, chat-sized styling, and identical output on web and mobile without a DOM. It follows CommonMark's rules for the supported syntax below, so a message and a long-form text containing the same Markdown look the same.

Tests hold the two together:

- `markdownConformance.test.tsx` renders every construct in the supported syntax through both the message renderer and the long-form renderer and compares the resulting structure.
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

Emphasis follows CommonMark's flanking rules in both parsers. An underscore inside a word never starts or ends italics, so `snake_case`, `user_id` and `__init__` stay as typed, while `_italic_` with spaces or punctuation around it is italic. `*` can italicize part of a word (`un*believ*able`), which is why the serializer switches to `*` there.

### Escaping

A backslash before ASCII punctuation makes it literal (`\*not bold\*`). The message composer escapes what the sender typed literally so the reader sees the same characters. It escapes only what could become formatting: every `*` and backtick, an `_`, `~~` or `++` that could open formatting, `[` before `](`, entities like `&amp;`, and list, quote, heading and fence markers at the start of a line. `snake_case`, `C++` and Windows paths are stored as typed.

### Differences outside the supported syntax

These render differently in a message and in long-form text. They aren't in §9.3, and the two-mode editor will show them as locked Markdown (§9.6):

| Markdown | Long-form (lessons, updates, feedback) | Messages |
| --- | --- | --- |
| `# Heading`, `####`… | Heading | Plain text (pasted shell and Python comments start with `#`) |
| Tables, task lists `- [ ]` | Table, checkboxes | Plain text |
| `---` | Horizontal rule | Plain text |
| A line right after a list item, not indented | Joins the item (lazy continuation) | Ends the list |
| Raw HTML (`<div>`) | Shown as typed in written text; dropped in lessons (react-markdown never renders it) | Shown as typed |
| `++underline++` | Plain text | Underlined (the composer's legacy underline) |

## Code blocks

Every fenced block renders through `CodeBlock` (`web/src/components/shared/CodeBlock.tsx`; `MessageCodeBlock` on mobile): language label and Copy in a 36px header, monospace that scrolls sideways instead of wrapping, and the code and syntax colors from design spec §7. Single-line snippets in messages with no language drop the header and show Copy in the corner. Unlabeled fences are always blocks, never inline, and they aren't highlighted.

Syntax highlighting uses highlight.js core with Bash, CSS, JavaScript, JSON, Python, Ruby, SQL, TypeScript and HTML/XML registered. It's a separate 22 kB (gzip) chunk that loads only when a labeled code block is on screen. The highlighted HTML is sanitized with DOMPurify (only `span` with `class`) before it reaches the page.

## Safety

- Long-form Markdown never renders raw HTML: react-markdown ignores it in lessons, and in written text a remark plugin turns it into visible text. Legacy HTML bodies (from the old rich-text editors) go through DOMPurify.
- Links: react-markdown's URL filter drops `javascript:` and other unsafe protocols; messages accept only `http(s)` and `mailto` links (`normalizeLinkHref` on web, `normalizeMessageLink` on mobile); marked on mobile uses `safeExternalUrl`.

## Storage hygiene (API)

`MarkdownText.normalize` (`api/app/services/markdown_text.rb`) runs on `Message#body`, `Announcement#body`, `Submission#feedback` and `HelpRequest#staff_response` through Rails `normalizes`. It turns `\r\n` into `\n` and closes an unclosed code fence. `MarkdownExcerpt` turns Markdown into plain text for push, web push and email bodies.
