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

Implementation: `000c6be47ff2f4049e793384ac14d281c5423a89`, from `5fa85024`. Agent-executed Chromium on the MacBook, synthetic `scripts/qa/run` harness. The final head will also contain this record and the corrected QA selectors; runtime code is unchanged. Fixtures are created by `scripts/qa/lesson-page-fixtures.rb`; each journey resets only its own program enrollment. No production data or provider credentials were used.

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
- Certificate issuance/download is outside this PR. The completion screen explains final review and eligibility without inventing certificate state.
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

**Final run: 0 failed stages.**

Command: `asus-test --postgres csg_learning_platform_test <this worktree> -- bash scripts/qa/student-workspace-gate.sh`. The loopback migration-process port adapter was retained; prepared statements ran both enabled and disabled. The 29 changed API/web/native source and unit-test files were SHA-256 checked against the ASUS snapshot, with no differences. The `RecordLink` prop correction was synced before the web stages; the final snapshot matches implementation commit `000c6be4`.

| Stage | Final result |
| --- | --- |
| API, prepared | 2,022 runs, 41,962 assertions; 0 failures/errors/skips |
| API, unprepared | 2,022 runs, 41,962 assertions; 0 failures/errors/skips |
| RuboCop | passed |
| Brakeman | passed, 0 warnings |
| Web typecheck and lint | passed |
| Web Vitest | 232 files, 2,578 tests passed |
| Web build, bundle budget, API inventory/type check | passed |
| Mobile typecheck and lint | passed |
| Mobile Jest | 141 suites, 1,536 tests passed |

There are no migrations. `docs/openapi.json` and both generated API type files were updated.

## Resource disposition

The owned Rails/Vite processes were stopped, the exact synthetic database `csg_qa_47957_1794900661` was dropped, every Playwright page was closed, and the T3 preview tab was closed/released. `dev-lifecycle status --session 01a1e861-7f3f-75f0-a3d7-f78a7f62d412` reports no active owned resources. Shared services and the borrowed simulator were left unchanged. The held PR's branch/worktree are retained; no runtime resource is handed off.
