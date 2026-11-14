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

## After rebasing onto `c316034b` (#221, #223)

`main` gained #221 (announcement audience, grading) and #223 (cable adapter). One conflict in mobile `updates.tsx` (style line) was resolved by keeping #221's styles and re-applying this PR's `detailBody` change. Rerun on the rebased head: web `npm ci`, ESLint, `tsc -b`, Vitest 122 files / 920 tests, build; mobile `tsc --noEmit`, Jest 118 suites / 876 tests; API full suite 1,048 runs / 7,157 assertions, 0 failures. The browser scenarios above ran on the pre-rebase tree; the rendering lines they cover in `Announcements.tsx`, `updates.tsx` and `SubmissionReviewPanel.tsx` merged unchanged, and the browser pass was not repeated.

## Bundle impact (gzip, vs. the same build on `5528aa33`)

- First paint (`index.js` + `index.css`): +0.9 kB.
- `highlight.js` chunk: 22.2 kB, loaded only when a labeled code block renders; never preloaded.
- Long-form Markdown pages (lessons, updates, feedback, help): about +12 kB net (remark-gfm + remark-breaks in the `MarkdownRenderer` chunk, 15.4 kB, part of which moved out of the `CodeRunner` chunk, −3.2 kB) plus `CodeBlock` 2.0 kB.
- Messages: shared parser chunk 2.9 kB + `CodeBlock` 2.0 kB; the `Messages` chunk itself is unchanged.
- All chunks together: +42.1 kB.

## Runtime cleanup

Lifecycle session `ecdcff1d-168f-44b5-afb9-d1a583c4b092`: Rails (PIDs 86240, then 55559 after a restart) and Vite (86242) stopped through `dev-lifecycle cleanup`; preview tab closed and released; `csg_md_qa_20261115` dropped. Status: no active owned resources.

## Review round 1 (Nov 15, 2026)

Fixes for the independent review: escaping `*` only where it could format, written text never taking the HTML path, CommonMark/micromark delimiter processing and serializer output that all three renderers read the same way, fence normalization that leaves valid Markdown alone, plain-text excerpts read from parsed structure (one shared fixture file), and plain-text web push for grading feedback. Decisions and residuals are in `docs/MARKDOWN.md`.

Agent-executed affected-flow QA in the same harness (copied, own database `csg_md_r1qa_20261115`, Rails on 3724 and Vite on 5724, lifecycle session `d57d7d11-a9c0-45bf-994a-d5189b7c5322`), on the final working tree before commit.

| # | Scenario | Result | Evidence |
| --- | --- | --- | --- |
| R1 | Instructor posts an update (Manage → Post announcement → audience confirmation) whose body starts with `<div>literal</div>`, has `&quot;` and `&amp;`, `2 * 3`, a list item that opens a Ruby fence on its own line (`- ```rb`), and `*a**b***__c__`; Alex reads it at 1280 and 390 | Passed | Stored body identical to what was typed (fence normalization didn't append a fence). Alex's page: `<div>literal</div>` shown as text in a paragraph, entities shown as typed (it's a CommonMark HTML block), Ruby `CodeBlock` with label and highlighting inside the first list item, second item `<em>a<strong>b</strong></em><strong>c</strong>`, no page overflow at 390. |
| R2 | Inbox row and push for that update | Passed after fix | First check: the web push excerpt (API) kept `&quot;` as typed, matching the page, while the web inbox excerpt decoded it. Fixed by keeping HTML blocks as typed in the web and mobile excerpts and adding the case to `fixtures/markdown-excerpts.json`. Retest: Alex's inbox row and the simulated web push payload are both `<div>literal</div> stays as typed, &quot;quoted&quot; &amp; 2 * 3. puts 1 Second item with abc marks`. |
| R3 | Instructor sends Alex a DM from the real composer (⌘I/⌘B) with overlapping marks (italic, italic+bold, bold) and literal `2 * 3` and `*word*`; Alex reads it at 1280 | Passed | Stored `Overlap: _italic **both**_ **bold**, then 2 * 3 = 6 and \*word\* typed as is.` (`2 * 3` not escaped). Alex sees `<em>italic <strong>both</strong></em> <strong>bold</strong>` and the literal stars; inbox row and push excerpt are plain text with `*word*`. |
| R4 | Alex sends the review case from the composer at 390: italic `a`, bold italic `b`, bold `c` inside one word | Passed | Composer held `<em>a</em><strong><em>b</em>c</strong>`. Stored `Word: *a**b***__c__` (no `*****` run). Rendered `<em>a<strong>b</strong></em><strong>c</strong>`; no overflow at 390. |
| R5 | Grading feedback in Markdown reaches web push as plain text | Passed (simulated delivery) | B grade with `**Close!**`, inline code, `&amp;` and a Python fence through `NotificationDeliveryService.submission_graded`; the notification keeps Markdown and `WebPushNotificationService#submission_changed` sends `Close! Use for word in words: & check the empty list. for word in words:`. Push isn't delivered in the harness. |

Not run: native app on a device or simulator (the mobile parser, written renderer and excerpts are covered by Jest, and the mobile long-form renderer by the web conformance test); dark mode.

### Gates (final working tree)

- API: full suite locally 1,074 runs / 7,194 assertions, 0 failures (`PARALLEL_WORKERS=1`, own DB, dropped after). Affected service tests rerun after the last excerpt change: 40 runs, 0 failures. RuboCop clean. The ASUS runner was busy with another run, so CI is the second full run.
- Web: ESLint clean, `tsc -b` clean, Vitest 122 files / 974 tests, `npm run build` passes.
- Mobile: `tsc --noEmit` clean, Jest 118 suites / 903 tests.
- Impeccable advisory on `CodeBlock.tsx`, `MarkdownRenderer.tsx` and mobile `authored-content.tsx`: 0 findings.
- Bundle (gzip, vs. the previous head `96e5678d`): +1.1 kB across all chunks; `markdownCore` +0.8 kB, `Messages` +0.27 kB, `CodeBlock` +0.17 kB, `MarkdownRenderer` +0.07 kB, `plainText` −0.18 kB; first-paint chunks unchanged.

### Runtime cleanup

Rails (PID 80162) and Vite (80164) stopped by `dev-lifecycle cleanup`; preview tab closed and released; `csg_md_r1qa_20261115` and the test database `csg_md_r1_20261115` dropped. Status: no active owned resources.
