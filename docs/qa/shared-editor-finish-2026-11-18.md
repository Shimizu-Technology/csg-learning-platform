# Shared editor finish (U-6.8) QA, 2026-11-18

Agent-executed, affected-flow QA for the rest of U-6.8: the shared editor in lesson text and instruction blocks, learning-plan descriptions, editor preferences stored on the account, and the mobile Rich mode decision.

Tested code: branch `feat/shared-editor-finish`, application commit `f769eef6` plus the QA spec. Environment: owned local harness (`scripts/qa/run start`), database `csg_qa_47092_1794950785`, API 60250 and Vite 60251 on loopback, Clerk stub. Chromium only, at 1280×844 and 390×844, in light and dark. The production-authored prework (127 lessons from `scripts/prework_exercises.json`) was imported with `student-workspace-course-fixtures.rb`. People are synthetic, and nothing was sent outside the machine.

## Acceptance

| # | Scenario | 1280 light | 1280 dark | 390 light | 390 dark |
|---|---|---|---|---|---|
| 1 | Real lesson instructions: a Rich edit to one paragraph, then a Markdown-mode edit, then Save. The stored Markdown equals the original with exactly those two edits. A reload opens Markdown (the remembered mode). The learner's lesson page shows the edit and the code block. | Passed (lesson 159) | Passed (174) | Passed (62) | Passed (86) |
| 2 | Real lessons opened in Rich mode, switched to Markdown and back, then another field (the block title) changed, saved and restored. Save stays disabled until a real change. The instructions are byte for byte unchanged after both saves. Lesson 165 shows the locked-text warning; lesson 109 (all `&nbsp;` lines) is editable. | Passed | Passed | Passed | Passed |
| 3 | Plan description ("Note for the student") typed in Rich mode with `**daily**`, which becomes bold as typed. It is saved as `Practice **daily** for …` (checked through the API) and shown bold through `MarkdownText` on the plan page. | Passed | Passed | Passed | Passed |
| 4 | Preferences: a browser holding a pre-U-6.8 local choice (Markdown, Enter adds a line) moves it to the account on first load. Changing to Rich and Enter-sends saves to the account. A reload keeps both. A second browser context with empty storage opens with them, and its switch to Markdown reaches the first browser on reload. | Passed (persona 2) | Passed (3) | Passed (4) | Passed (1; no migration step, its account already had a value) |

Final run: **16 of 16 passed** in one run (1.2 minutes). The locked-warning case was then re-run (4 of 4) with a scroll added to capture the warning.

Earlier failed attempts were spec mistakes, fixed before the final run: the phone Messages page shows the conversation list (the spec now opens the channel), repeated runs reused the same lesson tag and fixture preferences (now unique tags, and a reset of personas 2–4 limited to the owned `csg_qa_` database), and the plan check looked for the note on the v2 Today page, which doesn't show plan notes (see Residuals). No product change came out of browser QA.

Evidence (`shared-editor-finish-2026-11-18/`): Rich editing of a real lesson at 1280 light and 390 dark; the Markdown view after a Rich edit, with `&nbsp;` and `-\>` still as typed; the learner lesson page; the locked-text warning at 390 dark; the plan note editor at 390 dark; the Enter-to-send help ("Saved to your account.") at 390 light; and the second-browser result. Lesson captures show tags from earlier runs too, because lesson edits accumulate in the fixture.

The Impeccable advisory scan of `MarkdownEditor.tsx`, `BlockCard.tsx` and `NewExerciseModal.tsx` returned `[]`.

## Round trip on real course content

`web/src/components/shared/MarkdownEditor/lessonRoundTrip.test.ts` runs all 127 prework bodies through the real Rich schema:

- Before this change, 114 of 127 came back byte for byte. The other 13 read the same but were respelled (`chap\_01` became `chap_01`, `&nbsp;` became the character, extra blank lines collapsed) as soon as anything in the block was edited.
- Now all 127 come back byte for byte. An edit to one paragraph leaves every other block, and the blank lines around it, exactly as typed (checked for every lesson with two or more paragraphs).
- Rich mode can't show one lesson exactly (Week 5 Day 2 Lesson 4: CSS selectors; paragraphs with trailing `&nbsp;`). It is locked as Markdown with the warning and saved unchanged.
- Tables, inline and block HTML, images, reference links, dividers and `####` headings, checklists, and code inside a loose list survive byte for byte, both unedited and beside an edit. Each one Rich mode can't edit is locked with a named warning.
- Lesson text is now checked against the lesson renderer's own pipeline (`target="lesson"`, GFM without line breaks), not the written-text one.

## Automated checks

- Local: web typecheck, ESLint and the full Vitest suite (3,282 tests before the final additions); the editor, lesson round-trip, preference and lib suites (1,701 tests after them); mobile typecheck; API RuboCop on the changed files; and the new API and migration tests plus every session and OpenAPI contract test (178 tests), all passing.
- Full ASUS gate (API with prepared statements on and off, RuboCop, Brakeman, web, mobile): see the PR for the final-head result.

## Fix round 1 (#304 independent review, three P2s)

1. **A Rich edit changed bytes outside the edited paragraph.** Storing `\n\nIntro.\r\n\r\nUntouched &nbsp; paragraph.  \r\n\r\nOutro.\r\n\r\n` and editing only "Intro." dropped the outer blank lines and turned every CRLF into LF.
   - **Rich mode:** untouched blocks, the text between them, and the whitespace before the first and after the last block now come from the stored text. Edited and new blocks are written in the stored line ending.
   - **Markdown mode:** the browser's text box always reads LF, so edits there are written back with the stored line ending too. A text that mixes CRLF and LF comes out all CRLF after a Markdown-mode edit.
   - **Tests:** 25 new round-trip cases (the repro, CRLF, leading and trailing blank lines, a hard break, a final newline with no blank line after it, and a new block), each with a one-paragraph edit, across the lesson, written and message targets. Two editor component tests cover the same paths through the real editor.
2. **A delayed legacy upload overwrote a newer server preference.** `PATCH /api/v1/editor_preferences` now takes `initialize: true`: one conditional `UPDATE … WHERE column IS NULL` per field, with the account's values returned either way. The browser adopts them. API tests cover the cross-device race; a web test holds the upload while another device saves Rich.
3. **Out-of-order saves could persist an older choice.** Saves from one tab now run one at a time, and each sends the pending choices as they are when it runs. Pending clears only when the server answers with the value the browser still holds. Web tests cover held responses in order and three quick choices (only the latest is sent).

Checks, on `4676b256` plus the CRLF browser case:
- Web: typecheck, lint, build, `api:check`, and the full Vitest suite (3,315), including 399 round-trip cases. The 3,315 run was before one test-only type fix; the round-trip file was re-run after it (399 passed).
- API: the focused tests plus all session and contract tests, 181 runs each with prepared statements on and off, all passing. RuboCop clean.
- Mobile: typecheck, lint (0 errors) and Jest (1,552 tests in 142 suites).

Browser, on a fresh owned harness (`csg_qa_55455_1794953867`):
- **CRLF case:** passed at 1280 and 390. The repro is stored in a text block, edited in Rich mode and saved, then edited in Markdown mode and saved. The stored bytes were checked through the API after each save (`shared-editor-finish-2026-11-18/crlf-chromium-1280-light.png`).
- **Preference cases:** passed again at both widths in light and dark, including the one-time upload through `initialize`.

The harness was stopped and its database dropped afterwards.

## Residuals

- **Mobile Rich mode: not built.** The native composer keeps Markdown mode. Rich mode needs Tiptap, which is DOM-only, so the plan is: build the web editor's Tiptap extensions and the shared converters (`markdownToEditorDoc`, `editorJsonToMarkdownKeepingSource`, `editorJsonToMarkdown`) into one self-contained HTML page, load it in `react-native-webview` (already shipped, so no new native build or EAS quota), and bridge `setMarkdown`, Markdown changes, toolbar state and mode over `postMessage`. Read `editor_preferences` from the session for the starting mode. Test it on real iOS and Android keyboards. The app doesn't read `editor_preferences` yet.
- **The mobile staff lesson editor writes HTML.** `StaffRichTextEditor` (WebView, contenteditable) converts a Markdown lesson body to HTML when it is edited on a phone. That's existing behavior, outside this change, and not lossless for Markdown lessons. The WebView plan above would replace it.
- **Soft line breaks in lessons.** A single line break inside a lesson paragraph shows as a new line in Rich mode; learners see the lines joined (CommonMark). The stored text and what learners see are unchanged. Fixing it means showing soft breaks differently in Rich mode for `target="lesson"`.
- **Plan notes on the v2 Today page.** With `student_experience_v2` On, learners on the web don't see the plan note. The legacy dashboard (Off) and mobile do. Existing behavior, unchanged here.
- **Follow-up and return-plan fields** stay plain text boxes, shown as plain text. Moving them to Markdown would change what staff see.
- **Not covered:** Safari, Firefox, real phone keyboards and IME, Clerk sign-in, and a two-device check on production.

## Resources

Owned harness servers (API PID 47153, Vite PID 47174) were claimed, stopped, and their database dropped (`scripts/qa/run clean`). Browser pages were claimed and released by the spec. The focused API test database `csg_editor_prefs_u68_test` was dropped. The ASUS gate wrapper couldn't be claimed (the helper refuses commands that mention postgres); it exits when the gate ends. Shared PostgreSQL was left running.
