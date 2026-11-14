# One Markdown pipeline (W2 PR 2.2a): QA

## Context

Base `origin/main` `5528aa33`, branch `claude/markdown-pipeline`. Backlog items M-1, M-7, M-8, M-10, U-0.9, U-0.10, U-6.4, U-6.5, S-12; design spec §8 (code blocks) and §9 (supported syntax). Decisions are in `docs/MARKDOWN.md`.

Agent-executed affected-flow QA in the local harness from the Nov 14 UX audit: production course content plus synthetic people (instructor Audreana = 2, student Alex = 3, student Blair = 4), API in test mode with external HTTP blocked, Vite with the local Clerk stand-in. Database `csg_md_qa_20261115` (dropped after QA). T3 preview tab at 1280×900 and 390×844, light theme (dark mode doesn't exist yet). Native (Expo) runtime was not run: mobile coverage is Jest component and parser tests only.

Lance's Nov 11 message isn't stored verbatim in the Brain Dump, so the fixture is rebuilt from the notes in `people/lance-sanchez.md` (bold labels with inline code, two command blocks, a numbered list, `git config --global init.defaultBranch main`). It lives in `web/src/lib/markdownFixtures.ts`.

## Scenarios

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| Q1 | Instructor composes the Lance message in the real composer (⌘B, ⌘⇧C inline code, ⌘⌥⇧C code block, ⌘⇧7 list) and sends it to Alex | Passed | Composer HTML held `<strong>What <code>git init</code> does:</strong>` (bold and code coexist after the composer change). Stored body: `**What `git init` does:**`, `Literal \*\*stars\*\*` for literally typed stars, `git config --global …` with two ASCII hyphens, `Run **`--global`** once`. |
| Q2 | Sender's view, 1280 | Passed | Bold label with bold code, unlabeled block with "Code" header and Copy, numbered list with inline code, one-line `--global` snippet with Copy beside it, literal `**stars**` shown as typed. |
| Q3 | Alex views the conversation, 1280 and 390 | Passed after fix | 1280: same rendering; the seeded `bash` block is syntax-highlighted; inline code inside bold computes `font-weight: 700`. 390: first run found the one-line snippet's floating Copy button covering code that scrolls (`git config --global ir[Copy]`). Fixed by laying Copy beside the code; recheck: code column ends at x=247, button starts at x=253, no page overflow, long block scrolls inside itself (scrollWidth 443 > clientWidth 260). |
| Q4 | Inbox rows and notifications for that message | Passed after fix | Inbox preview: plain text. First run found the in-app notification row dropping the sender's literal `**stars**` (body stripped on the server, then stripped again in the inbox). Fixed by keeping stored notification bodies as Markdown and stripping once per surface. Retest with a new message: stored body keeps `\*\*stars\*\*`, push excerpt `Quick check: literal **stars** and user_id stay. Bold`, inbox row the same. |
| Q5 | Instructor posts an update with a heading, bold code, a Ruby fence, a table, a task list and a literal `<div>`; Alex reads it at 1280 and 390 | Passed after fix | Heading, bold code, highlighted Ruby block with label and Copy, real table, two disabled checkboxes, `<div>` shown as text, `snake_case` literal, no page overflow at 390 (code and table scroll inside). First run: the update's `## Before class` was an `h2`, the same level as the update title; written text now shifts headings one level (`h3`). Push excerpt: `Before class Bring your laptop charger. Run bin/rails db:migrate, …` (table rows read as cells after a follow-up fix). |
| Q6 | Instructor reviews a text submission and grades it B with Markdown feedback | Passed | Submission with no code filename and a fenced block opens as **Formatted** (Formatted / Source switch available). "Preview as learner" matched the saved result: line break kept, `**`puts`**` as bold code, highlighted Ruby. Saved `grade=B`, feedback stored as typed. |
| Q7 | Alex reads the feedback in the lesson, 390 and 1280 | Passed | Feedback renders with `<br>`, bold code and highlighted Ruby; no page overflow at either width. |
| Q8 | Instructor answers Blair's help request with Markdown (formatting hint and preview under the reply box), then Blair opens the lesson's help dialog, 390 and 1280 | Passed | Staff record shows the rendered reply; Blair's "Previous response" shows inline code, highlighted Ruby block, a two-item numbered list with bold `irb`; no overflow at either width. |
| Q9 | Lessons render unchanged or better | Passed | All 631 non-empty production lesson bodies from the content export rendered through the previous (`origin/main`) and new `MarkdownRenderer`: 613 identical, 18 changed, all improvements: 15 pipe tables now render as tables, task lists become checkboxes, bare URLs become links, and single-line fences render as code blocks instead of inline code. |
| Q10 | Stored messages render unchanged or better | Passed | 28 message patterns (14 real-message patterns, Lance's message, 13 edge cases) through the previous and new message renderer: 23 identical; the 5 differences are fixes (`**`git init`**` labels were literal `**`, "C++ ++i" collapsed to "C i", fences now use `CodeBlock`). The 14 real patterns are snapshot-tested. |

Not run: native app on a device or simulator (Jest only); Markdown paste in the composer and Slack-style typing rules (later composer slices, not this PR); dark mode.

## Automated gates (final working tree)

- API: full suite 1,037 runs / 7,060 assertions, 0 failures (`PARALLEL_WORKERS=1`, own DB); RuboCop on changed Ruby clean.
- Web: ESLint clean, `tsc -b` clean, Vitest 122 files / 905 tests, `npm run build` passes.
- Mobile: `tsc --noEmit` clean, Jest 117 suites / 868 tests. One unrelated suite (`profile-notification-controls`) timed out once under full-suite load and passed alone and on the next full run.
- Impeccable advisory scan of the changed UI files: 0 findings.

## Bundle impact (gzip, vs. the same build on `5528aa33`)

- First paint (`index.js` + `index.css`): +0.9 kB.
- `highlight.js` chunk: 22.2 kB, loaded only when a labeled code block renders; never preloaded.
- Long-form Markdown pages (lessons, updates, feedback, help): about +12 kB net (remark-gfm + remark-breaks in the `MarkdownRenderer` chunk, 15.4 kB, part of which moved out of the `CodeRunner` chunk, −3.2 kB) plus `CodeBlock` 2.0 kB.
- Messages: shared parser chunk 2.9 kB + `CodeBlock` 2.0 kB; the `Messages` chunk itself is unchanged.
- All chunks together: +42.1 kB.

## Runtime cleanup

Lifecycle session `ecdcff1d-168f-44b5-afb9-d1a583c4b092`: Rails (PIDs 86240, then 55559 after a restart) and Vite (86242) stopped through `dev-lifecycle cleanup`; preview tab closed and released; `csg_md_qa_20261115` dropped. Status: no active owned resources.
