# Student polish and ContentBlockRenderer split — W8.5

Application source `5f7f47d5` (refactor `6af52601` plus accessibility/header changes); [source hashes](student-polish-2026-11-18/source-sha256.json).
Worktree `~/work/csg-student-polish`, branch `feat/student-polish`, based on
`90f075e3` (merged #296). Agent executes the affected-flow QA below on the Mac mini.

CSG Learn serves live-program students, self-paced purchasers and alumni. Learners
need to find their next lesson, submit work, recover from errors, and return to
the course they opened. Clerk authenticates the web client; Rails supplies scoped
learning state and progress. Only an explicitly resolved cohort switch enables
`student_experience_v2`. Cohort 3, Test Cohort and CSG Alumni remain protected;
this task changes no production settings, API, transport types or query paths.

Sources: repository AGENTS.md; approved redesign README §§1–6 and 12; #283/#293/
#295/#296 as merged in main; first-run-states and lesson-page QA reports and harness.
The Mac mini has synced shared guidance, but no local Brain Dump project notes.

Required acceptance: preserve Off views except safe semantic/touch-target fixes;
keep renderer DOM, drafts, API calls and completion behavior; add a test per
extracted view; verify On navigation and PageHeader; cover 390/1280, light/dark,
all submission types, knowledge checks, video and manual completion. No new motion. The existing Today greeting and lesson/cohort record headers keep their purpose-specific layouts; PrivateMeetings already uses PageHeader.

## Already done on main

- #283: public course detail and tokenized catalog, editorial public styling.
- #293: On Learn outline replaces legacy Materials; module headers link to Learn.
- #295: Today hero cohort and next-close lesson links.
- #296: cohort/Materials recovery actions; query-filtered catalog recovery;
  Profile enrollment links, joined/access/support dates and receipts;
  Recordings/Resources Back; announcement origins and cohort links;
  inbox legacy `state.from` upgrade on On record pages; mobile conversation Back
  keeps workspace; DM cohort link; recording lesson/week links.
- Support email is already centralized in `brand` (no production literals remain
  outside `brand.ts`). Document that convention rather than changing five files.
- Messages is already split into controller/feed/header/composer modules; avoid
  repeating M-12. Staff mobile work records T-14 extractions; remaining large
  staff components are follow-ups, outside this learner refactor.

## Implementation

Extract VideoBlock, KnowledgeCheckBlock, SubmissionBlock and ManualCompleteBlock.
Keep their DOM unchanged and retain the controller in the renderer's lifetime;
separate video and checkpoint state into hooks. This avoids changing draft,
submission or playback lifetimes during a parent refresh. Submission artifacts
are 44px high. Full-page EmptyState callers choose h1 while embedded sections
retain h3. Legacy Materials puts the module disclosure inside its heading.
On Learn, My work, Resources, Recordings and Profile adopt PageHeader; On Cohort Home already redirects to Learn (#293), so its old curriculum mention
needs no new link. Off keeps its existing headers and plain curriculum text.
Document Newsreader/rounded-md as the deliberate public brand choice.

## Initial QA failures and corrections

The first main comparison used linked dependencies. Vite refused to serve the
linked font files, so baseline text widths differed. Installing dependencies in
the baseline checkout fixed the fixture; the comparison now asserts Manrope is
loaded. A later run captured a loading heading, so readiness now explicitly waits
for a non-loading heading. The baseline's missing h1 in empty media states is the
intentional semantic fix; comparison includes h1/h3 without treating the tag
change as a visual difference. The first On cohort assertion incorrectly expected
the old hub: #293 redirects it to Learn. Corrected the assertion and removed the
redundant proposed curriculum link. No learner regression was hidden by these
fixture changes.

One full concurrent gate run hit the existing ContentManagement focus timing
assertion; all 28 tests in that file passed in isolation. The final full gate passed after browser work with two Vitest workers (all tests
enabled), including the previously flaky assertion. Advisory Impeccable scans of extracted views and changed list headers returned no findings.

## Acceptance ledger

| Scenario | Required dimensions | Status |
|---|---|---|
| Off comparison against main: Today, Learn, cohort, Profile, media, lesson, module/fallback and meetings | 390/1280 × light/dark | passed: 40 matched pages |
| On Profile, Learn, My work, Resources, Recordings and cohort/module navigation | 390/1280 × light/dark | passed |
| Full-page recovery headings, module disclosure semantics | 390/1280 × light/dark | passed |
| Video, text, repo, repo+live, GitHub sync, manual complete and knowledge check | On/Off × 390/1280 × light/dark | passed |
| Existing first-run and lesson journeys | harness matrix | passed: first-run 52; lesson 20 |
| Production-authored course with synthetic learners | On/Off × 390/1280 × light/dark | passed |

Final gate on `5f7f47d5`: `npm run lint`, `npm run typecheck`,
`npm test -- --maxWorkers=2`, `npm run test:netlify`, `npm run build`, and
`npm run test:bundle` all passed; 240 test files / 2,764 tests passed;
Netlify checks, production build and bundle checks passed. The existing 44
renderer tests are unchanged. Four direct extracted-component tests verify
manual completion/undo, checkpoint answer, text submission and hosted video
progress with their cohort-scoped API payloads. A 72-case main DOM fixture covers
12 block states × On/Off × learner/staff/read-only; only the intentional 36→44px
artifact target class is normalized. The fixture was generated from the original
renderer at `90f075e3` before testing the extracted renderer.

Mobile/API gates: not applicable (no API, shared generated type or mobile changes).
Safari/native, provider video playback, Clerk, payment and delivery are not
established by the local synthetic harness. WebKit cannot start on this host. The extra video pass intercepts the YouTube
iframe with a synthetic button and exercises its real origin/source message
check, then verifies API-persisted video completion. It proves the browser
completion contract, not actual provider playback or buffering. GitHub sync
instructions are checked; no real GitHub push/sync is attempted.

Resource ownership: lifecycle `manual-20261118-015722-32967-c90e` reports no active
owned resources. Both QA databases were dropped; both harness phases, the main
comparison Vite server, preview tab and runner pages/processes were stopped or
closed. The temporary main worktree was removed. Protected/borrowed services
were left unchanged. The clean implementation worktree remains for PR review.

Browser execution summary: 24 polish matrix cases passed; 12 supplemental final
header/video cases passed; the expanded Off comparison passed all four dimension
cases (40 matched page renderings); the existing lesson matrix passed 20 and the
fresh final first-run matrix passed 52. Repeated cases are retests, not additional
unique coverage. First-run fixtures were recreated in a fresh owned database
before the final run to avoid extra enrollments changing its starting conditions.
Representative captures and result logs are in the adjacent evidence directory.
The final supplemental fixture script also passed a fresh-database preflight.

## Residuals

No required local acceptance remains blocked. CI and CodeRabbit review will run
on the PR; this implementation worker does not merge or watch it. No production
deployment was attempted. Further staff large-file cleanup is separate from this
learner change; M-12/T-14 extractions already present on main were left intact.
Hardware/Safari and actual provider integration coverage remain the exclusions
listed above. The prior suite failure and corrected fixture assumptions remain
recorded here alongside their passing retests.
