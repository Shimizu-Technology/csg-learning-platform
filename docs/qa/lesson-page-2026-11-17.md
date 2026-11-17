# W8 PR 8.3 — student lesson page

Agent-executed affected-flow QA. Base: main `5fa85024` (PR #293). CSG Learn serves program, self-paced and alumni learners; this change concerns reading, submitting, completing and continuing a lesson. Context: the approved design README §§2, 6, 8–9 and `09-lesson.html`; PR #266's `LearnerProgress`; #284 preview containment; #293's explicit-true switch and outline ordering. Production is Render Singapore + Neon and Netlify; this work uses only synthetic local fixtures and does not deploy.

Acceptance: Off markup and native fallback remain unchanged. On has one success state, one help action, one completion control, preserved drafts and feedback, code that scrolls without wrapping, course-wide navigation and an honest completion screen. No progress definition is duplicated in the client. Feature switches and read-only preview remain authoritative. W8.2 pages are excluded.

Motion: reuse the shared dialog/drawer motion and reduced-motion fallback; the inline success state uses the existing insert transition. No animation delays typing or navigation.

| Case | Starting fixture and required journey | Status |
| --- | --- | --- |
| L01 | On program: read reading/video/exercise; header and outline agree | passed |
| L02 | New text attempt: type, submit, inspect single success, expand saved answer, Next; persisted answer matches | passed |
| L03 | Redo with feedback: edit/resubmit, preserve prior feedback and draft | passed |
| L04 | Manual lesson: one Mark complete, refresh status and Next | passed |
| L05 | Last lesson of module: Start next module opens next assigned module | passed |
| L06 | Last required lesson: real course complete; no certificate falsely issued | passed |
| L07 | Help: one entry, lesson context, send synthetic request and inspect saved result | passed |
| L08 | Author actions: exact conversation; meetings absent when switched off | passed |
| L09 | Off running-program (Lance shape): old markup and interaction | passed |
| L10 | Draft/leave/reload/recovery and read-only staff preview | passed |
| L11 | Monaco desktop and touch textarea; long Python lines; light/dark; 390/1280 | passed |

All browser cases require Chromium at 390 and 1280 in light/dark. Native safety requires typecheck/lint/Jest; native visual parity is a follow-up. Real iPhone keyboard/touch and external media delivery are separate limitations; browser emulation is not device acceptance.

Automated gate, screenshots, execution results, tested head and resource cleanup will be recorded below.

## Execution and evidence

Implementation: `000c6be47ff2f4049e793384ac14d281c5423a89`, from `5fa85024`. Main integration: `8cf8da5d030cb96c2fbd578d4aaaac72ec635e2e`, merging current main `59c4a3a86ff61bd3cc587abe3f62ec4aeecb7970` (scheduled jobs). Agent-executed Chromium on the MacBook, synthetic `scripts/qa/run` harness. Final code `0d7694fe9e6c8aa04c0924f46a00c69a867bba6d` adds the footer hierarchy refinement: Mark complete is secondary whenever Next is present. Its regression test passes. All 16 browser cases were rerun on that head; the 48 screenshots below are from that final run. Later evidence commits change only this record and screenshots. Fixtures are created by `scripts/qa/lesson-page-fixtures.rb`; each journey resets only its own program enrollment. No production data or provider credentials were used.

The journey exercises real UI actions and then reads the API to verify saved answers, prior redo feedback and completion. It covers a fresh text attempt, a synthetic 503 followed by retry, Keep editing in the leave guard, a hard reload, resubmission creating attempt 2, manual completion, the module boundary and a refreshable course-complete page. Course completion comes from lessons handed in, including work waiting for review; no certificate is issued or claimed. Self-paced lessons show numbered sections without dates. A running program with the switch Off represents Lance's shape.

The staff preview cases run as an admin, assert no learner write requests or writable controls, and follow Back to Learn within `/admin/cohorts/:id/student-view`. Existing preview unit regressions remain in the full gate.

### Found and fixed

- A hard reload inside the draft debounce could lose the latest edit. On now flushes synchronously on `beforeunload` and `pagehide`; the new unit case and browser reload journey fail without it. Off's unmount behavior and HTML remain unchanged.
- The current lesson's checkpoints need one batch preload for navigation. QueryCounter grows the course from 3 to 27 lessons and the current lesson from 2 to 8 blocks (1 to 7 real checks), with progress rows for the added lessons. The query count stays flat.
- Gate corrections: the test fixture needed an explicit partial-type cast; module names now use `RecordLink`, with an explicit exception for the current lesson's own title; the new reduced-motion rule precedes the existing PeekCard rule so its existing regression test still locates that rule. The initial build and bundle stages failed downstream of the fixture type error; they were rerun in the final gate.
- QA script corrections: wait for persisted completion and Monaco's applied theme, use an exact conversation-body locator, and resolve the instructor-authored class channel from the fixture directory instead of assuming the auto-created empty channel contains a message. Chromium can change its pointer capability after simulated input, so redo entry uses whichever real editor is active. The first answer explicitly checks the coarse-pointer textarea; separate cases type and submit through Monaco at both widths.

### Off and native safety

`LessonView.off.test.tsx` uses three frozen HTML snapshots captured by running the unmodified `LessonView` and `ContentBlockRenderer` from `5fa85024`. Only React's process-global generated ID suffix is normalized. Current Off lesson, submission and manual-control markup match byte for byte. The route uses `StudentExperienceSwitch`, so unresolved/missing/failed switches retain the existing view. Native lesson runtime code is unchanged; both API type files were regenerated and native's explicit-true helper regressions remain in Jest.

### Environment limits and follow-ups

- Native visual parity is a follow-up. No native device UI, real iPhone, Safari or installed-PWA keyboard/touch session was run. The sticky bar reuses `useKeyboardAwareViewport`; its existing viewport tests run in the web suite. Browser emulation does not establish physical keyboard behavior.
- The synthetic video placeholder loads; external playback/watch-credit delivery is not established by this harness.
- Certificate issuance/download is outside this PR. The fix round removes the eligibility paragraph until AS-8 ships.
- Shared files: `Materials.tsx` changes only its two On empty-state message actions; `Messages.tsx` changes only its On learner empty pane. `Modal` adds a drawer variant with its default markup unchanged. `ContextualHelp`, `MessageAuthorContext`, `ContentBlockRenderer`, `CodeEditor` and isolated CSS selectors supply the shared actions/presentation. Dashboard, WeeklyPlan, CourseSupport and My work are untouched.

Automated-gate totals, final browser results and cleanup are recorded below.

## Browser acceptance result

**11 of 11 required journey cases passed**, executed as **16 Playwright cases** (two widths × light/dark × four scenario groups), with **48 screenshots** in [the evidence folder](lesson-page-2026-11-17/). No horizontal page overflow at either width; long Python is horizontally scrollable, with no wrapped source line. The learner journey captures no application page errors. Each save is checked against persisted API data. The On and Off author cases verify the booking switch in both directions, and the On link opens the matching course's My meetings page.

| View | Phone, light | Phone, dark |
| --- | --- | --- |
| Reading | [390 light](lesson-page-2026-11-17/light-reading-390.jpg) | [390 dark](lesson-page-2026-11-17/dark-reading-390.jpg) |
| Saved answer and Next | [390 light](lesson-page-2026-11-17/light-submitted-390.jpg) | [390 dark](lesson-page-2026-11-17/dark-submitted-390.jpg) |
| Course complete | [390 light](lesson-page-2026-11-17/light-complete-390.jpg) | [390 dark](lesson-page-2026-11-17/dark-complete-390.jpg) |
| Author, meetings On | [390 light](lesson-page-2026-11-17/light-author-meetings-on-390.jpg) | [390 dark](lesson-page-2026-11-17/dark-author-meetings-on-390.jpg) |
| Off, running program | [390 light](lesson-page-2026-11-17/light-off-lance-shape-390.jpg) | [390 dark](lesson-page-2026-11-17/dark-off-lance-shape-390.jpg) |

Desktop Monaco: [light](lesson-page-2026-11-17/light-monaco-1280.jpg), [dark](lesson-page-2026-11-17/dark-monaco-1280.jpg). The test types a long Python line, verifies it remains one editor line, submits it, and checks the saved source. The editor backgrounds match `code-bg`: `#f6f7f9` light and `#0f141b` dark. The advisory Impeccable scan returned `[]`.

## Automated gate

**Final merged run: 0 failed stages.**

Command: `asus-test --postgres csg_learning_platform_test <this worktree> -- bash scripts/qa/student-workspace-gate.sh`. The loopback migration-process port adapter was retained; prepared statements ran both enabled and disabled. The pre-integration gate passed on the lesson implementation, with all 29 changed API/web/native source and unit-test files SHA-256 checked against the ASUS snapshot (no differences). After main advanced, the entire gate was started again on the committed integration head `8cf8da5d`; the footer refinement and regression were synced and hash-checked before the web stages. The final tested source matches `0d7694fe`; the totals below are from that run. Main adds optional clock/feature arguments to scopes and `LearnerProgress.for_all`; web, native and OpenAPI source are unchanged by the merge.

| Stage | Final result |
| --- | --- |
| API, prepared | 2,062 runs, 42,174 assertions; 0 failures/errors/skips |
| API, unprepared | 2,062 runs, 42,174 assertions; 0 failures/errors/skips |
| RuboCop | passed |
| Brakeman | passed, 0 warnings |
| Web typecheck and lint | passed |
| Web Vitest | 232 files, 2,578 tests passed |
| Web build, bundle budget, API inventory/type check | passed |
| Mobile typecheck and lint | passed |
| Mobile Jest | 141 suites, 1,536 tests passed |

There are no migrations. `docs/openapi.json` and both generated API type files were updated.

## Resource disposition

The owned Rails/Vite processes were stopped, the exact synthetic databases `csg_qa_47957_1794900661`, `csg_qa_96044_1794903208` and `csg_qa_78203_1794903712` were dropped, every Playwright page was closed, and the T3 preview tab was closed/released. `dev-lifecycle status --session 01a1e861-7f3f-75f0-a3d7-f78a7f62d412` reports no active owned resources. Shared services and the borrowed simulator were left unchanged. The held PR's branch/worktree are retained; no runtime resource is handed off.

Final integrated result: 2,062 API tests / 42,174 assertions in each prepared mode; 232 web files / 2,578 tests; 141 native suites / 1,536 tests; all named gate stages passed. The final browser run on `0d7694fe` passed 16/16 cases and refreshed all 48 screenshots. The task-created local `web/node_modules` was removed after verification. No owned runtime resource remains.


## Fix round — PR #294

Review baseline: `c74263dd`. Main `59c4a3a8` was merged before fixes (already current). Implementation source: `bc549c8f`, including `fda6362a`'s complete legacy fallback. API source stayed byte-identical to `311ee311` during both API modes; the final author availability guard landed before the web stages. `ae001bbd` adds its browser regression only; subsequent commits update evidence only. W8.2's Today and My work pages were excluded. The shared changes are limited to lesson rendering, contextual help, person actions, meeting destinations and the API client/types.

The gate runs locally on this MacBook because the ASUS cannot be reached from the phone hotspot, as Leon directed. Focused checks ran first against the owned `csg_lesson_fix_20261117` database. Full verification waits for W8.2's local gate, uses `PARALLEL_WORKERS=1`, and runs stages in sequence. The local migration-process adapter uses `postgresql://leonshimizu@localhost/postgres`; the ASUS port adapter in the existing gate script is unchanged. Prepared statements remain enabled in the first run; the second uses the requested `?prepared_statements=false` mode. One-minute load is checked before each stage; a value above 25 delays that stage.

| Review concern | Regression evidence |
| --- | --- |
| Earlier-module redo; read-only Next; closed reading completion | `lesson_navigation_test.rb`, `LessonExperience.test.tsx` |
| Either-direction instructor blocks | API creates both directions of `UserBlock`; `PersonActions`, `MessageAuthorContext` and `InstructorMessageAction` tests check hidden actions |
| Parallel lesson/settings fetch; missing-navigation fallback | `LessonView.destination.test.tsx`; browser strips server navigation/state while client stays On and verifies redo and both legacy completion controls |
| Self-paced support, no support, expired support and help Off | `LessonExperience` and `InstructorMessageAction` tests; self-paced browser evidence has one Ask for help action |
| Meeting host and admin author | `PrivateMeetings.test.tsx` rejects a mismatched `instructor_id`; `PersonActions.test.tsx` excludes admin booking |
| Completion request ownership | Deferred success and failure resolve after unmount; neither can reload the previous lesson |
| Accepted submissions while refresh fails | First submit and redo both become waiting for review from the accepted server response |
| Written source and hybrid input | Written HTML-like answers use written rendering; a fine primary pointer retains Monaco despite a coarse secondary pointer |
| Help context and every response | Learner explicitly chooses lesson/exercise; code challenges and historical exercise contexts are included; both exercise responses and the lesson response remain reachable; reopening without a draft asks again |
| Legacy answered request; completion wording | `staff_response` without replies says View response On; course-complete test excludes certificate language |
| Query growth | 3 → 27 lessons, 2 → 20 current-lesson blocks, 0 → 120 attempts, including six current-lesson GitHub-sync exercises; query counts stay equal |
| Off, drafts and preview | Existing frozen Off snapshots pass unchanged; pagehide, redo, leave guard, locked/paused ordering and preview cases remain covered |

Regression proof: temporarily restored the pre-fix implementation at `c74263dd`, with its matching OpenAPI schema for API checks. The new tests produced **23 web failures and four API failures** on the reported behavior. All implementation files and the schema were restored afterward. Focused green checks: 27 API tests / 196 assertions (prepared), 27 / 196 in unprepared mode, 120 affected web cases across 10 files, including the final author guard cases, and 85 native tests across four suites. The full gate below supersedes the earlier focused totals.

Browser execution is agent-owned Chromium with synthetic fixtures. The 16-case matrix passed again at 390 and 1280, light and dark, refreshing all 48 screenshots. Four affected full journeys passed again after the help refinements. The mixed-flag regression adds two passed cases, for **18 distinct browser cases**. It covers reading/video/exercise, failed-submit retry, submit then Next/Redo, feedback and attempt history, completion, the module boundary, course complete and reload, persisted help, instructor DM, author actions and booking switches, preview containment and Lance-shaped Off. Help QA now waits for Cancel request and the saved question, so a screenshot cannot pass while the form still says Sending. No page overflow was observed. The API verifies saved work and progress; synthetic video playback and real iOS keyboard/device behavior retain the limitations above.

The full local gate passed **all 13 stages** on this implementation. The gate ran from 19:36 to 19:53 ChST, after W8.2 finished. The build briefly raised one-minute load to 84; the runner waited before subsequent stages until it was below 25 (and waited again before API type checks). No stages overlapped.

| Full local gate | Result |
| --- | --- |
| API, prepared statements | 2,066 runs / 42,199 assertions; 0 failures/errors/skips |
| API, unprepared | 2,066 runs / 42,199 assertions; 0 failures/errors/skips |
| RuboCop | 731 files, no offenses |
| Brakeman | no warnings |
| Web typecheck / lint | passed |
| Web Vitest | 232 files / 2,604 tests passed |
| Web build / bundle budget / API check | passed |
| Mobile typecheck / lint | passed; lint has 74 existing warnings, 0 errors |
| Mobile Jest | 141 suites / 1,536 tests passed |

The native and real-device limitations above remain unchanged. The final self-paced author regression passes at both widths for no support, expired support and help Off. Together with the 16-case matrix and two mixed-flag cases, **20 distinct browser cases passed**; four full-journey rechecks also passed. The final guard changes only unsupported self-paced profiles, and its 10 focused profile tests and the full web suite pass.

All owned Rails/Vite processes and browser pages are closed. The fix-round databases `csg_lesson_fix_20261117`, `csg_qa_38750_1794907076`, `csg_qa_5484_1794907568` and `csg_qa_23308_1794909342` were dropped. The task-installed web/native dependencies, stray root test cache and generated web build were removed. Lifecycle session `01a1e861-7f3f-75f0-a3d7-f78a7f62d412` reports no active owned resources. Shared services and the borrowed simulator remain untouched. The branch/worktree are retained for the held PR. No review is dismissed, and this worker does not merge or watch the PR.
