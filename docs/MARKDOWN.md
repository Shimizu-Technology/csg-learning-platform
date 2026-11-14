# Markdown in CSG Learn

Everything people write in CSG Learn is stored as Markdown and read back through one pipeline. This page records how it works and the rules every surface follows. The two-mode editor (design spec §9, W2 PR 2.2b) builds on it; see [Writing it: the two-mode editor](#writing-it-the-two-mode-editor).

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

- `markdownConformance.test.tsx` renders every construct in the supported syntax through all three renderers (the message renderer, react-markdown, and the mobile marked renderer compiled into the web test) and compares the resulting structure. It also round-trips composer paragraphs with overlapping marks through the serializer and checks that every renderer shows each character with the marks it was sent with, round-trips 600 seeded random composer paragraphs (bold, italic and strike over letters, `_`, `.` and spaces), and compares the message parser with react-markdown on 400 seeded random emphasis strings.
- `messageFormat.native-parity.test.ts` fails if the web and mobile copies of the message parser differ, and compares their output on real message patterns.

## Supported syntax (design spec §9.3)

Both parsers render all of this the same way:

- Paragraphs. **A single newline is a line break** in everything people write (messages, updates, feedback, help replies, submissions). Lesson text keeps CommonMark's rule, where a single newline is a space, because lesson source is often hard-wrapped.
- `**bold**`, `_italic_` or `*italic*`, `` `inline code` ``, and bold or italic around inline code (`**`git init`**` is bold code).
- Fenced code blocks with ```` ``` ```` or `~~~` and an optional language. A fence must start its own line. A fence that's never closed runs to the end of the text, as CommonMark does, and it's stored as typed. A fence in a list item ends with the item (``- ```rb`` followed by an unindented `- Next step` is two items).
- Bulleted (`-`, `*`, `+`) and numbered (`1.`, `1)`) lists. A numbered list keeps its starting number, so a list split by a code block continues at 2.
- `> quotes`, `[links](https://…)`, `<https://…>` and bare `https://` or `www.` URLs.
- `##` and `###` headings. Messages and written text start one level down (`##` is an `h3`), because they always sit under a page or card title.
- `~~strike~~`.

### Italics and underscores

Emphasis follows CommonMark's flanking rules in every parser. An underscore inside a word never starts or ends italics, so `snake_case`, `user_id` and `my__dunder__name` stay as typed, while `_italic_` with spaces or punctuation around it is italic. A standalone `__init__` is bold in CommonMark (GitHub shows it the same way), so the composer escapes it. `*` can italicize part of a word (`un*believ*able`), which is why the serializer switches to `*` there.

### How the composer writes overlapping marks

Marks in the editor can overlap without nesting (italic `a`, bold italic `b`, bold `c`). The serializer opens the mark that lasts longest first and closes and reopens the others. Markdown parsers disagree about runs like `*****` where a closing run meets an opening run of the same character, so the serializer alternates `*` and `_` there: that example is written `*a**b***__c__`, which all three renderers read the same way.

A delimiter between punctuation and a letter only opens or closes in one direction, so italic `end.` directly followed by `next` can't be written as `*end.*next`. The serializer moves that punctuation outside the mark instead (`_end_.next`): the text stays exactly as typed and only the punctuation loses the mark. The same applies at the start of a mark (`see` + bold `.env` is `see.**env**`) and to a literal `_` (bold italic `foo_` + bold `bar` is `**_foo_\_bar**`). `unflankedPunctuationParagraphs` in `markdownFixtures.ts` lists these cases.

Some things still can't be written in CommonMark at all, and the composer writes them as they are:

- A formatted span that starts or ends with inline code right against a letter (bold `` `x` `` directly followed by `b`).
- Two marks that start or end at the same point inside a word (`a` + strike-and-italic `ef`).
- Strikethrough that starts or ends exactly where bold or italic does, with a letter right outside it (`x~~*a*~~y`). GFM strikethrough has no exception for a neighbouring delimiter, so every renderer shows the tildes.

These are rare in practice. For text separated by spaces the round trip is exact: a one-off check of 100,000 random composer paragraphs (bold, italic, strike and code, Nov 15, 2026) found no differences between the three renderers or from what was sent. Inside a word, marked (mobile long-form only, not messages) still differs from CommonMark on a few close-and-reopen runs. marked also reads a `~` next to `*` or `_` as a letter, so emphasis that ends in punctuation or another delimiter right before strikethrough (`**.**~~b~~`, `**_b_**~~ab~~`) shows its asterisks in mobile long-form text; messages and the web read it as sent.

### Escaping

A backslash before ASCII punctuation makes it literal (`\*not bold\*`). The message composer escapes what the sender typed literally so the reader sees the same characters. It escapes only what could become formatting at that position: a `*` run that could open or close emphasis (`*word*`, `2*3*4`), every backtick, every `_` that isn't inside a word, a `~~` or `++` that could open formatting or close one the composer wrote, a `~` or `+` at the edge of a formatted span (where it would join the delimiter), a `\` that ends up next to a delimiter the composer writes, including after trailing spaces move outside it (bold `C:\ ` then `folder` is `**C:\\** folder`), `[` before `](`, entities like `&amp;`, and list, quote, heading and fence markers at the start of a line. `2 * 3`, `a * b`, prices, `snake_case`, `C++` and Windows paths are stored as typed.

Named entities read as their character in every renderer when they're HTML4 names (`&amp;`, `&quot;`, `&nbsp;`, `&Aacute;`, `&hellip;`…), `&apos;`, or HTML5's uppercase spellings of those (`&AMP;`, `&QUOT;`), plus numeric references. Names are case-sensitive (`&Amp;` stays as typed) and only real entity names decode (`&constructor;` stays as typed). `\&amp;` stays `&amp;`.

### Differences outside the supported syntax

These render differently in a message and in long-form text. They aren't in §9.3, and the two-mode editor shows them as locked Markdown (§9.6):

| Markdown | Long-form (lessons, updates, feedback) | Messages |
| --- | --- | --- |
| `# Heading`, `####`… | Heading | Plain text (pasted shell and Python comments start with `#`) |
| Tables, task lists `- [ ]` | Table, checkboxes | Plain text |
| `---` | Horizontal rule | Plain text |
| A line right after a list item, not indented | Joins the item (lazy continuation) | Ends the list |
| Raw HTML (`<div>`) | Shown as typed in written text, even when the text starts with a tag; dropped in lessons on the web (react-markdown never renders it) | Shown as typed |
| `++underline++` | Plain text | Underlined (the composer's legacy underline) |
| A fence inside a quote (`` > ``` `` …) | Code block in the quote | Quote text with the backticks |
| Strike and emphasis delimiters interleaved, `x _~~*one~~*` | `x _~~` then italic `one~~` (micromark pairs `*` first) | `x _`, struck `*one`, then `*` (the message parser pairs `~~` first) |
| HTML5-only entity names (`&check;`) | ✓ | Shown as typed (Rich mode keeps it locked on both, so it's never escaped) |
| A fence in a list item followed by an unindented fence line, `- ~~~` / `  x` / `~~~` / `y` / `~~~` | `x` is code in the item; the unindented `~~~` ends the list and opens a second block, so `y` is code | `x` is code in the item, the unindented `~~~` closes it, `y` is a paragraph, and the last `~~~` opens an empty block. Excerpts agree (`x y`) |

## Writing it: the two-mode editor

Everything people write with formatting goes through one component, `MarkdownEditor` (`web/src/components/shared/MarkdownEditor/`). Its value is the Markdown string; nothing else is stored. It has two modes over the same Markdown:

- **Rich** (Tiptap): formatting shows as you type. The toolbar formats the selection, and Slack-style typing rules turn `**bold**`, `_italic_`, `` `code` ``, `~~strike~~`, `- `, `1. `, `> `, `## ` and ```` ``` ```` + Enter into formatting.
- **Markdown**: a monospace text box showing the Markdown itself. Toolbar buttons and shortcuts insert syntax, and **Preview** renders the text the way readers will see it.

| Where | Variant | Preview renders with |
| --- | --- | --- |
| Messages: channels, DMs, threads, and editing a message | `composer` (toolbar in the footer, Enter-to-send) | the message parser (`FormattedMessage`) |
| Updates (announcements) | `field` (toolbar on top, Enter adds a line) | `MarkdownText` |
| Overall grading feedback, including inserted feedback snippets | `field` | `MarkdownText` |
| Help-request replies (Support queue and the request page) | `field` | `MarkdownText` |
| Text submissions whose exercise names a Markdown file or language (`answer.md`) | `field` | `MarkdownText` |

Still plain text boxes: lesson Text blocks and exercise instructions (the W5 block editor will adopt the editor), per-criterion rubric feedback, and learning-plan and follow-up descriptions. Code submissions keep the code editor, because Rich mode would escape the source and the code runner needs it as typed.

### Switching modes

Rich → Markdown writes the document with `editorJsonToMarkdown` (`messageFormat.ts`). Markdown → Rich reads it with `markdownToEditorDoc` (`MarkdownEditor/markdownToEditorJson.ts`), which uses the message parser's own block and inline parsers (`parseMessageBlocks`, `parseInline`). Neither parser is copied.

- **Switching is never an edit.** Text typed in Markdown mode stays exactly as typed until it's edited in Rich mode, and switching doesn't call `onChange` or mark the page unsaved.
- **Rich → Markdown → Rich returns the same Markdown** for everything in the supported syntax, including Lance's Nov 11 reply (`markdownFixtures.ts`). The tests in `markdownToEditorJson.test.ts` check every supported construct, the real message patterns and the composer paragraph fixtures against the real Tiptap schema.
- **Normalizations that don't change what readers see:** `*` and `+` bullets become `-`; `*italic*` becomes `_italic_`; `1)` becomes `1.`; entities like `&amp;` become the character; runs of blank lines between editable blocks become one. A numbered list keeps its starting number, including `0.`.
- **Links are stored as typed.** A bare URL (`https://…`, `www.…`) and an `<https://…>` autolink are written back the way they were typed, and `[text](url)` stays `[text](url)`, even when the text is the URL. A URL typed, pasted or added with only a link in Rich mode is stored bare. The link mark records the spelling (`spelling`: `bare`, `angle` or `inline`); the serializer writes a bare URL or `<url>` only when the paragraph reads exactly the same as with `[text](url)`, so a link whose text was changed, or a URL with a letter, `_`, `*` or `~` typed right after it, keeps the brackets.
- **Locked blocks (§9.6).** The text is split into blocks at blank lines (never inside a fence or a list item). A block that holds something Rich mode can't edit becomes a locked `rawMarkdown` block: a table, an image, a checklist, a divider, a `#` or `####` heading, HTML, a link reference definition or a block that uses one (`[text][label]`, `[label][]` or `[label]` naming a defined label, since long-form readers resolve it through a definition in another block; definitions and uses are found in the Markdown tree, so one inside a quote or a list item counts), a list or fence inside a quote, an indented code block, or an HTML5-only entity name (`&check;`, which messages show as typed and CommonMark decodes). So does any block that wouldn't read the same after a round trip. Locked blocks show as dashed monospace Markdown with a warning ("Rich mode can't edit a table. It's shown as Markdown text and saved unchanged.") naming every kind, and **Edit in Markdown**. They're deleted as a whole. If the pieces wouldn't read the same together, the whole text is locked.
- **Locked blocks keep every byte**, wherever they sit: a first block's leading indentation (`    indented code`), a last block's trailing spaces, whitespace-only lines inside. Neighbouring locked blocks are one block with the exact text between them, so the blank lines inside an indented code block are kept. Only whitespace the editor itself writes (empty paragraphs at either end, spaces at the outer edges of editable blocks) is trimmed.
- **The round trip is checked where the text is read** (`target`). Messages (`composer`) are compared with the message parser. Updates, feedback, help replies and submissions (`field`) are also compared with `MarkdownText`'s own remark pipeline (`writtenMarkdownStructure` in `web/src/lib/writtenMarkdown.ts`), so what CommonMark reads differently becomes a locked block there: a lazy continuation line after a list item (`- first` / `lazy`), or a list that's loose in CommonMark but would be written tight. In messages those read the same after Rich mode and stay editable.
- The caret keeps its block: switching puts it at the end of the same block. Preview keeps the Markdown text box's selection and scroll position.
- **Saving keeps text as typed.** Every surface that saves this Markdown drops only blank lines at the start and end (`trimBlankLines` in `messageFormat.ts`), never the first line's indentation or the last line's spaces. Inserting a feedback snippet trims the draft and the snippet the same way. Messages also collapse runs of blank lines between blocks and drop list markers with nothing after them (`normalizeMessageMarkdown`), but never inside fenced code, indented code (at the top level or in a list item) or an HTML block that runs across blank lines.

### Preferences

The mode and Enter-to-send are saved per person in this browser (`localStorage`, key `csg-editor-preferences:<user id>`, `{ mode, enterSends }`). Each editor reads the mode when it opens, so switching one editor doesn't flip others already open. Enter-to-send applies to every open composer at once. If the browser refuses to store a choice (a private window, full storage), it still applies until the page reloads. A profile field, so both follow the person to other devices, needs an API change and is a follow-up.

### Keys

| Action | Mac / Windows | Rich typing rule |
| --- | --- | --- |
| Bold, italic | ⌘B, ⌘I / Ctrl+B, Ctrl+I | `**text**`, `_text_` |
| Strikethrough (no toolbar button, as in §9.4) | ⌘⇧X / Ctrl+Shift+X | `~~text~~` |
| Inline code | ⌘E / Ctrl+E | `` `text` `` |
| Code block | ⌘⇧C / Ctrl+Shift+C | ```` ``` ```` or ```` ```js ```` then Enter |
| Bulleted, numbered list | ⌘⇧8, ⌘⇧7 / Ctrl+Shift+8, 7 | `- `, `1. ` |
| Quote | ⌘⇧9 / Ctrl+Shift+9 | `> ` |
| Link | ⌘⇧U / Ctrl+Shift+U | paste a URL over selected text |
| Switch mode | ⌘⇧M / Ctrl+Shift+M | |
| Paste as plain text | ⌘⇧V / Ctrl+Shift+V | |

⌘Z right after a typing rule undoes the formatting and keeps the characters (they're escaped when saved, so `**b**` comes back as typed). Rules never fire inside code. In a Rich code block, Enter adds a line, Enter on an empty last line leaves the block, Tab indents two spaces, and Esc then Tab moves focus out. The message composer also keeps ⌘U for the legacy `++underline++`.

### Enter in the message composer

- **Enter-to-send on (default):** Enter sends, Shift+Enter adds a line, ⌘/Ctrl+Enter also sends.
- Enter adds a line instead of sending when the caret is in a list item or code block (Rich), or inside an open fence, counting the caret's own line (Markdown), so ```` ```js ```` then Enter starts a block. Enter on an empty list item ends the list.
- **Off:** Enter adds a line everywhere; ⌘/Ctrl+Enter sends.
- The hint under the composer says what Enter does and changes as the caret moves. The switch is in the composer's formatting help (keyboard icon). Editing a message works the same way, with "save" in place of "send".
- `field` editors (updates, feedback, replies, submissions) never submit on Enter.
- **Input methods (IME).** A key that belongs to a composition (Japanese, Chinese, Korean…: `isComposing`, key code 229, or between `compositionstart` and `compositionend`) goes to the input method alone in both modes: it never sends, formats, runs a shortcut or picks an @mention.

### Paste

- **Rich, Markdown-looking text** (`**`, backticks, fences, list, quote and heading markers, links, table rows) becomes formatting, with a note: "Pasted Markdown as formatting. ⌘Z undoes it; ⌘⇧V pastes plain text." and **Paste as plain text instead**.
- **Rich, code-looking text** (`looksLikeCode`) becomes a code block that keeps its indentation, with **Paste as text instead**. Other multi-line text pastes as text, with **Paste as code instead**.
- **Rich, HTML** keeps the supported formatting after DOMPurify. HTML with a table or image pastes as plain text with a note instead of dropping parts silently.
- **Into a code block, after ⌘⇧V, or in Markdown mode:** always plain text.
- Files pasted or dropped into the message composer become attachments.

### Accessibility

The Rich surface is `role="textbox"` with `aria-multiline` and a label naming the field and mode ("Message #general, rich text"); Markdown mode is a `<textarea>` labeled "…, Markdown". The toolbar is `role="toolbar"` with one Tab stop and arrow keys between buttons; each button has a label, a tooltip with its shortcut, `aria-keyshortcuts`, and `aria-pressed` for the formatting at the caret. The mode switch is a group labeled "Editor mode" with pressed-state buttons. Switching modes, Preview and paste conversions are announced in a polite live region, and the locked-block warning is `role="status"`. When the editor itself is narrow (phones, and the thread panel on desktop), the formatting buttons and the mode switch fold into an **Aa** menu with 44px targets; this uses container queries, so it depends on the editor's width rather than the window's. Text is 16px so iOS doesn't zoom. The Markdown text box turns autocorrect and autocapitalize off.

### Drafts

The composer keeps a snapshot of the draft (the Markdown and, in Rich mode, the document) from every change, and saves it 250 ms after typing stops, when the conversation or thread changes, when the composer unmounts (leaving Messages), and on `pagehide` (closing or reloading the tab). The editor writes out its last keystrokes when it unmounts, before the composer saves, so nothing typed just before leaving is lost.

### Typing performance

The message composer is its own memoized component (`MessageComposer` in `Messages.tsx`). It owns the editor, the draft, @mentions and the character count, so a keystroke re-renders the composer and not the Messages page. The editor writes its Markdown at most once a frame, the toolbar and Enter hint re-render only when the formatting at the caret changes (`useEditorState`), the count re-renders only within 500 characters of the limit, and typing presence goes out through a callback that doesn't set page state ("active" at most every 2 seconds, "inactive" 4 seconds after the last keystroke). `MessagesTypingPerformance.test.tsx` types 63 characters into a conversation with 30 messages and counts message-row renders: 0 on this branch, 1,890 on `main` before it.

### Mobile

The native composer is Markdown mode: the text box holds the Markdown, the formatting toolbar inserts syntax, and the toolbar's **Preview** shows the draft through the same message parser readers see. Return on a touch keyboard always adds a line and Send sends, as in phone chat apps, so Enter-to-send is a web setting. Inside a code fence the keyboard stops autocorrecting, capitalizing and curling quotes (`composerInputBehavior`). Rich mode needs a native rich-text engine (Tiptap is DOM-only) and is a follow-up.

## Code blocks

Every fenced block renders through `CodeBlock` (`web/src/components/shared/CodeBlock.tsx`; `MessageCodeBlock` on mobile): language label and Copy in a 36px header, monospace that scrolls sideways instead of wrapping, and the code and syntax colors from design spec §7. Single-line snippets in messages with no language drop the header and show Copy in the corner. Unlabeled fences are always blocks, never inline, and they aren't highlighted.

Syntax highlighting uses highlight.js core with Bash, CSS, JavaScript, JSON, Python, Ruby, SQL, TypeScript and HTML/XML registered. It's a separate 22 kB (gzip) chunk that loads only when a labeled code block comes within a screen of the viewport (IntersectionObserver). The highlighted HTML is sanitized with DOMPurify (only `span` with `class`) before it reaches the page.

## Safety

- Long-form Markdown never renders raw HTML: react-markdown ignores it in lessons, and in written text a remark plugin turns it into visible text. Only lessons check for legacy HTML bodies (from the old rich-text editors), which go through DOMPurify on the web and the native HTML renderer on mobile. Written text (messages, updates, feedback, help replies, submissions) never takes that path, so an update that starts with `<div>` shows the tag.
- Links: react-markdown's URL filter drops `javascript:` and other unsafe protocols; messages accept only `http(s)` and `mailto` links (`normalizeLinkHref` on web, `normalizeMessageLink` on mobile); marked on mobile uses `safeExternalUrl`.

## Storage hygiene (API)

`MarkdownText.normalize` (`api/app/services/markdown_text.rb`) runs on `Message#body`, `Announcement#body`, `Submission#feedback` and `HelpRequest#staff_response` through Rails `normalizes`. It turns `\r\n` and `\r` into `\n` and changes nothing else. Resolving a help request also trims the response with `MarkdownText.trim_blank_lines`, the server twin of `trimBlankLines`, so a reply that starts with indented code keeps its indentation. An unclosed code fence is stored as typed: CommonMark already runs it to the end of the text, so a closing fence would never change how it renders, and every attempt to add one safely kept finding text it altered (a Setext heading next to an HTML block, tab-indented list markers).

## Plain-text excerpts

Previews and notification bodies are read from the parsed structure, never by stripping syntax with regular expressions:

- Web and mobile `markdownExcerpt` walk the message parser's tree (`markdownToPlainText` with `longForm`, which also reads `#` and `####` headings, `---` rules and GFM tables the way long-form text renders them, with `\|` as a literal pipe in a cell). In long-form mode the parser first finds CommonMark HTML blocks (types 1–7, outside list items), so a `- ` line or a fence inside `<div>…</div>` stays as typed.
- The API's `MarkdownExcerpt` walks a CommonMark + GFM tree from the `commonmarker` gem.

Both keep inline code text (`<div>` and `a\*b` inside code stay as written), keep an autolink's URL, decode entities, keep escaped literals literal, show HTML typed into the text as typed (a block that starts with an HTML tag, like `<div>`, is kept exactly as typed, entities included, because that's how CommonMark and the written renderers show it), and keep the first line of each code block. `fixtures/markdown-excerpts.json` holds the input and expected excerpt pairs that the Ruby, web and mobile tests all read. Known differences between the excerpts:

- comrak (inside `commonmarker`) also strikes through single tildes (`~a~`), which the web renderer leaves as typed, so an API excerpt can drop those tildes.
- HTML5-only entity names (`&check;`) decode in the API excerpt and in web long-form text, and stay as typed in messages and web and mobile excerpts.
- An HTML block inside a list item: `- <div>` / `  **literal**` / `  - not a list` / `  </div>`. Web and mobile excerpts find HTML blocks only outside list items, so they read the item as Markdown (`<div> literal not a list </div>`); the API's reads the HTML block as typed (`<div> **literal** - not a list </div>`), as web and mobile long-form text show it. `fixtures/markdown-excerpts.json` has one expected excerpt per case, so this one isn't in it.
- The message parser doesn't read fences inside a quote: `` > ``` `` + `> x` is quote text, so the web excerpt of `"> ```\n> x"` keeps the backticks (```` ``` x ````) where the API's reads `x`.

## Changes from the previous renderer

Measured against production on Nov 15, 2026 (read-only): only 2 messages from the last 90 days contain a mid-word `*` or HTML-like text, and one native app install exists (the admin's TestFlight build, app 1.0.0). Stored data isn't rewritten. What reads differently:

- **Intraword asterisks.** A message typed before the composer escaped asterisks, like `a*b*c`, now shows `b` in italics (CommonMark). `2 * 3` and other spaced asterisks are unchanged.
- **Text that starts with HTML.** Updates, feedback and help replies that start with a tag show the tags as typed instead of rendering them.
- **Entities and email autolinks.** `&amp;` in a message reads as `&`; `<help@example.com>` is a link; `<mailto:…>` keeps `mailto:` in its label, as on the web long-form renderer.
- **Excerpts** keep `<div>` and other typed tags instead of deleting them, and keep backslashes inside code.

The native message parser and long-form renderer changed with the web ones. The TestFlight build that follows this merge has to include them; older builds keep the previous parser.
