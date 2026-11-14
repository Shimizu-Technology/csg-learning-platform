# W2 PR 2.2b QA: two-mode Markdown editor, November 15, 2026

Base: `ffd2d8b` (origin/main). Tested branch `claude/md-editor-two-mode`; the commit that adds this record is the tested code. Agent-executed affected-flow QA on the Mac mini with the local harness (`scripts/qa/run start`, `QA_ASYNC_CABLE=1`), Playwright Chromium at 1280×860 and 390×844. Synthetic harness data only; no production access.

## Context and acceptance

CSG Learn's students, instructors and admins write formatted text in messages, updates, grading feedback, help replies and written submissions. Sources: `AGENTS.md`, `docs/MARKDOWN.md`, design spec §9 and §12 (`docs/design/2026-11-platform-redesign/README.md`), mockups 12, 03 and 05 and `assets/md-editor.js`, and the lead's brief for 2.2b.

Required outcomes: one shared editor with Rich and Markdown modes over the same Markdown; switching modes is lossless and remembered; Enter-to-send on by default, with Enter adding a line in lists and code blocks, and the setting working both ways; pasted Markdown and code convert; unsupported syntax stays as locked Markdown; mentions keep their user IDs; what the recipient sees matches what was written; typing in the composer doesn't re-render the Messages page.

Fixture change for this run: in the disposable QA database, the "Practice" exercise of lesson 7 (block 33) was given `filename = 'reflection.md'` so it reads as a written answer. Nothing in the seed was changed.

## Scenarios

| # | Scenario | 1280 | 390 | Observed |
| --- | --- | --- | --- | --- |
| 1 | Typing rules in the DM composer: `**`git init`**`, `_once_` | Passed | not run | Bold inline code and italic, as typed. |
| 2 | Paste Lance's Nov 11 reply into Rich mode | Passed | Passed | Converted to formatting; the "Pasted Markdown as formatting. ⌘Z undoes it; ⌘⇧V pastes plain text." note and **Paste as plain text instead** appear. [01](md-editor-two-mode-2026-11-15/01-dm-rich-paste-1280.png), [22](md-editor-two-mode-2026-11-15/22-dm-rich-paste-390.png) |
| 3 | Rich → Markdown → Preview → Rich → ⌘⇧M → ⌘⇧M | Passed | Passed (via Aa menu) | Markdown text box shows Lance's text exactly, at each switch; Preview renders through the message renderer; focus stays in the editor. [02](md-editor-two-mode-2026-11-15/02-dm-markdown-mode-1280.png), [03](md-editor-two-mode-2026-11-15/03-dm-markdown-preview-1280.png), [23](md-editor-two-mode-2026-11-15/23-dm-markdown-390.png), [24](md-editor-two-mode-2026-11-15/24-dm-preview-390.png) |
| 4 | Send with Enter (1280) / Send button (390) | Passed | Passed | Composer clears. Stored body equals Lance's Markdown byte for byte (810 characters, checked in the database). |
| 5 | Recipient (student) view | Passed | Passed | Bold inline code, both bash blocks with Copy, the numbered list and the italic line read as written. [05](md-editor-two-mode-2026-11-15/05-dm-recipient-1280.png), [26](md-editor-two-mode-2026-11-15/26-dm-recipient-390.png) |
| 6 | Enter setting off (formatting help switch) | Passed | not run | Hint reads "⌘Enter to send · Enter for a new line"; Enter adds a line, ⌘/Ctrl+Enter sends; switched back on afterwards. [06](md-editor-two-mode-2026-11-15/06-enter-setting-off-help-1280.png), [07](md-editor-two-mode-2026-11-15/07-enter-off-newline-1280.png) |
| 7 | Enter setting on: list and code block | Passed | not run | In a list the hint says "In a list or code block, Enter adds a line"; Enter adds items, Enter on the empty item ends the list, then Enter sends (`- first item⏎- second item`). ```` ```ruby ```` + Enter opens a block, Enter on an empty last line leaves it (stored as a fenced ruby block plus a paragraph). |
| 8 | @mention in #qa-class | Passed | not run | Typing `@QA` opens suggestions; choosing QA Program inserts the name; the message stores `mention_user_ids = {3}`. [10](md-editor-two-mode-2026-11-15/10-mention-suggestions-1280.png), [11](md-editor-two-mode-2026-11-15/11-mention-recipient-1280.png) |
| 9 | Edit a message | Passed | not run | Edit opens the shared editor (Rich); hint reads "Enter to save"; Enter saves; stored body keeps the code block and adds `**Edited**`. [50](md-editor-two-mode-2026-11-15/50-edit-message-1280.png) |
| 10 | Thread reply in the side panel | Passed | not run | The narrow panel folds the toolbar into Aa; reply stored with `parent_message_id`. [51](md-editor-two-mode-2026-11-15/51-thread-reply-1280.png) |
| 11 | Phone composer | n/a | Passed | Toolbar folds into Aa; menu targets are 44px tall; text is 16px in both modes. [20](md-editor-two-mode-2026-11-15/20-dm-composer-390.png), [21](md-editor-two-mode-2026-11-15/21-dm-aa-menu-390.png) |
| 12 | Update (announcement) with a pasted table | Passed | Composer shown | The table becomes a locked block with "Rich mode can't edit a table…" and **Edit in Markdown**; Markdown mode and Preview keep it; posted body stored exactly; the student sees a rendered table, bold and the list. [30](md-editor-two-mode-2026-11-15/30-update-locked-table-1280.png), [31](md-editor-two-mode-2026-11-15/31-update-markdown-preview-1280.png), [32](md-editor-two-mode-2026-11-15/32-update-student-1280.png), [33](md-editor-two-mode-2026-11-15/33-update-composer-390.png) |
| 13 | Grading feedback: typing rules plus a pasted Python snippet, grade B | Passed | Editor shown | The snippet becomes a code block that keeps its indentation; stored feedback has the fenced block; the student sees it on the lesson. [40](md-editor-two-mode-2026-11-15/40-grading-feedback-1280.png), [41](md-editor-two-mode-2026-11-15/41-grading-feedback-student-1280.png), [47](md-editor-two-mode-2026-11-15/47-grading-feedback-390.png) |
| 14 | Help reply from the Support queue | Passed | not run | Bold, inline code and a list typed with rules; stored `Try this in **irb**: `2 + 3`…`; the student sees it as "Previous response" in Ask for help. [42](md-editor-two-mode-2026-11-15/42-help-reply-1280.png), [43](md-editor-two-mode-2026-11-15/43-help-reply-student-1280.png) |
| 15 | Student written submission (`reflection.md`) | Passed | Passed | The two-mode editor replaces the code editor; the submitted text is stored as Markdown; the instructor's review opens it Formatted. [44](md-editor-two-mode-2026-11-15/44-written-submission-1280.png), [45](md-editor-two-mode-2026-11-15/45-written-submission-390.png), [46](md-editor-two-mode-2026-11-15/46-written-submission-staff-1280.png) |

Scenarios 1–12 and the editor shots 40, 44 and 47 were rerun after the last fixes below. Scenarios 13–15 (grading, help reply, written submission) ran before the last toolbar and focus fixes; their saved results were checked in the database, and screenshots 41–43, 45 and 46 still show the earlier toolbar, which had a strikethrough button.

No browser console errors from the changed surfaces. Pages with a Monaco code viewer logged Monaco load failures, because the harness blocks its CDN; the past-attempt viewer on the written submission shows "Loading…" for that reason (screenshot 45). This is a harness limitation, not this change.

## Found and fixed during QA

- At 1280 with the sidebar open, the composer footer was too narrow for every button and the formatting buttons ran under "@ mention". The toolbar now folds into Aa based on the editor's own width (container queries), the composer's footer buttons are 30px wide on desktop, @ mention is an icon, and the toolbar follows the spec's eight tools (no strikethrough button; ⌘⇧X and `~~` still work).
- The Rich/Markdown switch stayed visible when it should have folded, because its own `inline-flex` beat `hidden`.
- Tooltips opened on tap and covered the phone menu; they now appear only on hover or keyboard focus.
- Switching modes moved focus two frames late, so a key pressed right after the switch could be lost. The switch now commits synchronously and focuses the field at once (unit test added).

## Review round 1 (data integrity)

Base: `8c0902f`. The commit that adds this section is the tested code. Agent-executed on the Mac mini with the local harness (`scripts/qa/run start`, `QA_ASYNC_CABLE=1`), Playwright Chromium at 1280×860, synthetic data only. Stored values were read from the harness database after each step.

Acceptance: an unrelated Rich edit next to locked Markdown changes nothing but the edit; `&check;`, lazy list lines and other text CommonMark reads differently stay as typed on long-form surfaces; bare URLs and `<autolinks>` are stored as typed; a list starting at `0.` keeps it; leaving a conversation right after typing keeps the draft; IME composition keys never pick a mention or send.

| # | Scenario | Result | Observed |
| --- | --- | --- | --- |
| R1 | DM, Markdown mode: send a message with bare and `<…>` URLs, an indented code block, a table whose last row ends in three spaces, `&check; done`, a `0.` list | Passed | Stored byte for byte. |
| R2 | Edit that message in Rich mode | Passed | One locked block holds the indented code, table and `&check;`; the warning names all three. [60](md-editor-two-mode-2026-11-15/60-edit-message-locked-1280.png) |
| R3 | Type " (edited)" in the first paragraph, Enter to save | Passed | Stored body equals the original plus the typed text: indentation, table spaces, `&check;`, both URL spellings and `0.` unchanged. [61](md-editor-two-mode-2026-11-15/61-edited-message-1280.png) |
| R4 | Send a message whose first block is indented code | Passed | Indentation kept (`trimBlankLines`); previously the send path's `.trim()` turned it into a paragraph. [65](md-editor-two-mode-2026-11-15/65-leading-indented-code-message-1280.png) |
| R5 | Update: write in Markdown mode (indented code first, `&check;`, bare URLs, `0.` list, a final table row with trailing spaces), switch to Rich, add "!" to one paragraph, post to staff | Passed | Rich shows the three locked kinds; stored body equals the original plus "!", including the leading indentation and the final row's spaces; the detail page renders the code block, ✓, the `0.` list and the table. [63](md-editor-two-mode-2026-11-15/63-update-rich-locked-1280.png), [64](md-editor-two-mode-2026-11-15/64-update-detail-1280.png) |
| R6 | DM: type in Rich mode, switch to #qa-class about 40 ms later, come back | Passed | Draft saved and restored. |
| R7 | DM: add to the draft, leave Messages for Staff home about 30 ms later, come back | Passed | Draft saved with the last keystrokes and restored; before this fix the unmount save found no editor and kept nothing. [62](md-editor-two-mode-2026-11-15/62-draft-restored-1280.png) |

IME handling, Preview's caret and scroll, the per-surface guard, tab close (`pagehide`) and every byte-preservation case are covered by unit tests (`MessageComposerDraft.test.tsx`, `MarkdownEditor.test.tsx`, `markdownToEditorJson.test.ts`); no IME was driven in the browser. No browser console errors from the changed surfaces.

Cleanup: harness PIDs 45071 and 45074 stopped and database `csg_qa_45063_1794679855` dropped with `scripts/qa/run stop` and `clean`. The shared PostgreSQL server was already running and was left running; listeners from another project present at the start were not touched.

## Review round 2 (CodeRabbit)

Base: `7328af0`. The commit that adds this section is the tested code. Agent-executed on the Mac mini with the local harness (`scripts/qa/run start`, `QA_ASYNC_CABLE=1`), Playwright Chromium at 1280×860 and 390×844 (touch), synthetic data only, signed in as QA Instructor.

| # | Scenario | 1280 | 390 | Observed |
| --- | --- | --- | --- | --- |
| R2-1 | #qa-class, Rich: type `<b>not bold</b> Hi @Admin and `, add `@` (1280: the **Mention someone** button, which inserts through the editor handle; 390: typed, since the button is not in the phone toolbar), type `Prog`, pick the first suggestion | Passed | Passed | Text reads `<b>not bold</b> Hi @Admin and @QA Behind ` with no bold: the handle inserts characters, not HTML, and only the active `@Prog` is replaced. (`@Prog` also matches QA Behind through the workspace name "QA Program", which the menu lists first.) [70](md-editor-two-mode-2026-11-15/70-mention-active-token-1280.png), [71](md-editor-two-mode-2026-11-15/71-mention-active-token-390.png) |
| R2-2 | Same composer, Markdown mode: `<i>x</i> @Admin and @Beh`, Enter | Passed | Passed | `<i>x</i> @Admin and @QA Behind `. |
| R2-3 | Rich: ```` ``` ```` and Enter, paste `first line\n` into the code block, type `next` | Passed | Passed | The code block reads `first line` / `next`; before the fix the pasted newline was dropped and the text ran together. [72](md-editor-two-mode-2026-11-15/72-code-paste-trailing-newline-1280.png) |
| R2-4 | Help request → **Respond & resolve** (a form): Link, type "the guide" in Text, Enter; type `guides.rubyonrails.org` in Link; back in Text, Enter | Passed | Passed | The first Enter moves to the empty Link field; the second adds `[the guide](https://guides.rubyonrails.org)`. The dialog stays open and the help request stays open and unresolved in the database. [73](md-editor-two-mode-2026-11-15/73-help-link-text-enter-1280.png), [74](md-editor-two-mode-2026-11-15/74-help-link-applied-390.png) |
| R2-5 | Touch targets at 390 | n/a | Passed | The Enter switch measures 56×44; Rich and Markdown in the Aa menu are 44px tall. [75](md-editor-two-mode-2026-11-15/75-enter-switch-target-390.png) |

No browser console errors on either page at either width. The other round 2 fixes (stale draft destination, phone Preview body, phone fence detection, inline-code delimiters, reference links, unsaved Enter preference) are covered by unit tests only.

Cleanup: harness PIDs 49084 and 49087 stopped and database `csg_qa_49075_1794681116` dropped with `scripts/qa/run stop` and `clean`; listening ports match the baseline taken before the run. The shared PostgreSQL server was already running and was left running.

## Not covered

Safari and WebKit (they don't start on this machine), real input methods (IME) on any browser, real iOS and Android devices, the Expo app (covered by jest and typecheck only), screen readers (labels and live regions are checked in unit tests), and production Clerk, push and email.

## Cleanup

The harness's two processes (PIDs 34595 and 34601) were stopped and its database `csg_qa_34569_1794676984` dropped with `scripts/qa/run stop` and `clean`. The shared PostgreSQL server was already running and was left running. Listeners from another project (`cornerstone-payroll`) that appeared during the run were not touched.
