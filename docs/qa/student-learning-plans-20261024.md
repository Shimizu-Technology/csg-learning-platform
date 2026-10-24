# Individual learning plans — implementation and acceptance

## Context

Base: `origin/main` `dfd3edb`. Repository: CSG Learn (Rails API, React web, Expo native). Sources: `docs/PRODUCT_VISION.md`, `AssignedLearningContent`, `WeeklyPlanProjection`, enrollment-scoped progress/submissions, and Leon's October 24 instructions. Shared curriculum remains authoritative by default. Staff may opt an enrollment into a personal plan using shared lessons, milestones, target dates, and explained requirement exceptions. Plans never grant content access or reset learning evidence. Cohort defaults and another enrollment must remain unaffected.

Agent-executed affected-flow QA covers staff management and learner consumption, with deeper regression coverage for permissions, concurrent edits and retained learning evidence. Existing Clerk/provider delivery, payment/billing, and external communications are outside this release. Real student setup is a separate authorized production operation after release; no synthetic grading or invented personal deadlines.

## Acceptance scenarios

- P01 Standard enrollment: regular requirements and content remain; next action prefers required unfinished work. Desktop and narrow web required.
- P02 Customize: staff save milestones, shared lesson links and explained exceptions; reload retains exact values and personal plan appears to its learner. Desktop and narrow web required.
- P03 Scope: another enrollment and shared curriculum remain unchanged; unauthorized staff/students cannot change a plan. API required, staff/student browser boundary required.
- P04 Validation/recovery: invalid or stale saves show actionable errors and preserve the draft. Desktop and narrow web required.
- P05 Learner: current milestone, target dates, next required task and required progress agree with module/lesson labels; optional resources remain accessible. Desktop and narrow web required; native component and bundle compatibility required, native runtime tracked separately.
- P06 Restore: returning to regular curriculum retains submissions, grades and progress, preserves plan history, and restores normal requirements. Desktop and narrow web required.
- P07 Production setup: verify each named student's real enrollment/content; configure only supported individual agreements, preserve all work, verify default curriculum for others and actual enrichment access.

## Execution

Local synthetic databases were verified before setup: `csg_personal_plans_test_20261024` and `csg_personal_plans_qa_20261024`, local PostgreSQL role `leonshimizu`. No shared database resets. Local Clerk identity adapter + real React shell and Rails authorization/persistence; external HTTP blocked and jobs use the test adapter. Evidence root `/tmp/csg-personal-plans-20261024`.

P01–P06 passed at both required widths (1280×900 and 390×900): 6 accepted cases, 12 viewport results. `browser-results.json` and `saved-outcomes-*.json` verify persisted plans, stale-write rejection, enrollment isolation, retained grade A/submission/progress, regular shared AI requirement, and unchanged paused fixture. Browser attempts 1/2 exposed accessible-name problems from wrapping select/textarea content in labels; explicit matching accessible names fixed them. Personal view was simplified after visual inspection to retain a single next action and remove the competing standard weekly checklist while retaining redos/sessions/recordings/resources. Final browser run passes those affected journeys.

Engineering gates: API 998 tests / 6,275 assertions, zero failures/errors/skips; web 119 suites / 788 tests plus lint/typecheck/Netlify/service-worker/build/bundle checks; native 115 suites / 847 tests plus brand/typecheck/lint (existing warnings). Ruby lint 487 files; Brakeman zero warnings (one existing ignored finding). Bundler audit clean after Crass 1.0.8 patch. Web transitive Zod updated to 4.6.7. Native Zod 3 has no compatible patched release; explicit dependency exception documents the Expo/Clerk graph and absent app input path. Do not globally override Zod 3 consumers to 4. Final dependency gates and bundle exports will be refreshed after lockfile changes.

T3 preview opened but snapshots twice failed with `Preview automation snapshot timed out after 15000ms.` Fallback: isolated Playwright Chromium, closed after every execution. T3 native device open failed before boot: `Daemon registration ownership could not be verified: daemon.lock is not a directory.` No shared daemon repaired; all simulators remained shut down. Native runtime is currently blocked; native component contracts and iOS/Android JS exports are checked separately. Mobile-web success is not represented as native runtime acceptance. `expo export --platform all` also attempted unsupported native-client web export and failed on Expo SQLite web WASM; separate supported iOS/Android exports passed.

Release and real student setup remain pending. Runtime ownership: Rails PID 16762 port 3641, Vite PID 16798 port 5641, lifecycle session `01a1655f-78a1-7f80-aa8f-7d4e70899c79`. Owned T3 preview tab was closed/released. Browser workers close/release themselves.

## Review fixes and repeated QA

Independent review of `7a96010` found missing selected-enrollment support in staff preview and missing native requirement labels. Staff progress now supplies its real weekly projection without starting a self-paced support clock; preview uses its actual redos/events/capabilities. Native module rows and lesson headers label effective required/optional status. API, web preview and native browsing regression checks cover these paths.

CodeRabbit and Greptile also identified personal-plan recording URLs, hidden access/support dates, hidden submission windows, event timezone formatting and staff management response caching. Fixed supported recording query links; retained course/support dates and enforced submission deadlines for all unfinished required lessons, including those outside milestones; preserved event timezone; marked management reads no-store. Closed-window redo actions offer feedback reading. Six primary journeys passed again at both widths; four further learner/staff viewport results verify real redo priority, sessions, closed-window notices and recording navigation (`review-extras-results.json`).

Current reviewed-fix gates: web 119 suites / 790 tests before the added closed-redo regression; native 115 suites / 850 tests, lint/typecheck/brand; iOS and Android JS exports passed. Ruby changed-file lint clean. Impeccable advisory empty. Full API repeat exposed an existing cold-route initialization race in the restart concurrency test (404 before the locked action); being investigated separately from personal-plan acceptance. Final head, review status and release evidence remain pending.

The restart concurrency failure reproduced alone from a cold Rails process. Loading the lazy route set on the test thread before launching both requests fixes the bootstrap race; the actual lock/one-success-one-conflict assertions are unchanged and pass. Final complete API repeat is running with this test-only fix. Web final complete gate passes 119 suites / 791 tests; native complete gate passes 115 suites / 850 tests. Both supported native platform exports passed after the review fixes.

Final API gate after the reproduced bootstrap fix: **1,000 tests / 6,289 assertions, no failures/errors/skips**. Final web and native gates remain 119/791 and 115/850 respectively. Task-owned Rails/Vite QA servers were stopped and lifecycle status confirms no active owned resources. Production release, student setup and final review outcomes are still pending.

## Lesson-only assignment preview acceptance

Round 2 found a pre-existing template merge limitation: an enrollment’s lesson-only assignment could be absent from the cohort template, hiding its next task/personal plan. Preview dashboard modules now come from actual assigned enrollment content, including lesson-only assignments; effective review state and submission windows also come from that enrollment. The deadline projection preloads submission windows to avoid per-lesson lookups.

A fresh synthetic cohort with no module assignments or schedules and one directly assigned lesson passed learner/staff preview at 1280×900 and 390×900 (`lesson-only-results.json`): the personal plan and exact next task remain visible with no unopened-course message. Full API repeat: **1,001 tests / 6,295 assertions**, no failures/errors/skips. Full web gate passed with the new regression. Native sources did not change after their 115-suite / 850-test gate and both platform exports. Final independent review of this bounded fix remains pending.
