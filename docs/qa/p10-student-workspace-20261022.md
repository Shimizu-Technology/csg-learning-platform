# P10 student workspace — 2026-10-22

Historical checkpoint (superseded): at `d5406f3` the first-round CodeRabbit findings were fixed and local gates passed (API 923 / web 612 / mobile 695). Later sections record the review-fix round, including one load-related API concurrency timeout that passed in isolation. Current state: rebased by the integration lead onto `32fcf3d`; GitHub CI is green on the final head, with the mobile async-assertion timeout raised for loaded machines and a second CodeRabbit round fixed (directory renders when activity fails; archived learners keep their cohort link).

Implementation owner: Codex P10 worker. Integration owner: Claude lead; do not merge.
Base verified: origin/main `b5f207f`. Branch `fix/p10-student-workspace` in the assigned isolated worktree.

## Context and acceptance

Sources: audit WORKER_BRIEF.md, PLAN.md and verify-staff.md X1/T5/StudentWorkspace target; docs/PRODUCT_VISION.md sections 3/7/8; Brain-Dump/code-school/csg-learning-platform-plan.md; current controllers for module assignments, lesson assignments, enrollments and restart. CSG Learn connects reusable learning content to cohort enrollments. Staff need one operational learner record with enrollment-specific learning, support and access. Instructors retain assigned-cohort overrides; profile/enrollment/restart actions remain admin-only. Clerk authenticates, Rails enforces permissions, Neon stores records, Netlify/Render serve web/API. Production deployment is outside this held slice.

Experience: preserve the existing semantic palette, Manrope, rounded surfaces and 44px controls. Access uses explicit saved actions, local errors and existing typed-email confirmation. Lesson exceptions stay collapsed under their module; routine saves preserve the current panel and draft on failure. Motion stays with existing controls and confirmation modal.

Agent-executed affected-flow QA is required on desktop 1280×800 and phone web 390×844. No iOS simulator, physical device, live Clerk login, external delivery or production writes.

## Required scenarios

| ID | Fixture and actions | Expected outcome | Status |
| --- | --- | --- | --- |
| A1 | Assigned instructor opens Access, assigns/removes a module, force unlocks, saves/clears module and lesson dates, reloads | Saved enrollment-scoped overrides; admin actions absent | passed |
| A2 | Admin edits profile/GitHub and enrollment status, reloads | Saved changes and accurate access/support facts | passed |
| A3 | Admin restarts after incorrect then correct typed email | Incorrect email blocks; correct email clears only selected enrollment and creates snapshot/intervention/weekly recovery plan | passed |
| A4 | Open old cohort/legacy and person-only URLs for one, multiple, no and archived enrollments | Exact redirect, chooser without guessing, profile plus admin enrollment recovery action | passed |
| A5 | Staff Students sidebar and cohort filter, open row and return | Enrollment workspace and preserved filter/context | passed |
| A6 | Fail each secondary source and retry, with others succeeding or pending | Local loading/error/retry; no false zero/history; successful sections usable | passed |
| A7 | Change students while old secondary request is pending; drawer failure/retry | No stale learner results, local recoverable drawer error | passed |

## Automated checks and runtime evidence

Agent-executed browser acceptance passed A1–A7 on the task diff over `b5f207f`, through real Rails endpoints and the actual web components. Access controls, failure recovery, directory return and student switching were exercised at both widths; compatibility chooser/empty/archived variants were exercised at 390px plus route regressions, without repeating every route at desktop. T3 Chromium used 1280×800 and 390×844; the full run included Layout, CohortProvider and compatibility routes. A temporary local entry supplied synthetic staff identity through Rails test-only tokens instead of Clerk. A short final component entry retested date clearing, the restart status selector and drawer error layout after those fixes. All entries were removed after QA.

Fixtures: admin 1, assigned instructor 2, learner 3, second learner 4, no-enrollment learner 5 and archived learner 6; cohort 1, independent-course cohort 2; enrollment 1 and preserved enrollment 3. Fixtures belong only to `csg_p10_student_workspace_dev`. No production data or live provider delivery was used.

Observed saved outcomes: instructor module and lesson dates/unlocks survived reload, module assignment/removal persisted, lesson override clearing removed the record, and Use default date saved a null module date at both widths. Admin GitHub edits and paused enrollment state persisted. Wrong-email restart stayed disabled. Valid restart returned the selector to active, removed only selected-enrollment records and created an owned intervention, weekly recovery plan and snapshot; the independent enrollment retained its submission and progress. The existing same-curriculum overlap guard rejected restart and displayed its explanation; the fixture was then separated into an independent curriculum for the success path. That guard is unchanged.

Compatibility passed: explicit cohort and legacy links, one-enrollment redirect, multiple-enrollment chooser, no-enrollment profile, archived restore then Add to cohort. Directory navigation and cohort/search filters survived workspace return at both widths. Six independent failure/retry cases passed at both widths; healthy sections stayed usable and unavailable sources never produced false history. Delayed submissions followed by switching to learner 4 stayed on learner 4 after the old result arrived. Drawer submissions/help errors retried at both widths; focus stayed inside, Escape closed it, and the full-width error card did not overflow (408px inside a 448px desktop drawer; 350px inside a 390px phone drawer).

No horizontal document overflow or sub-44px tested Access controls were found. Native installed-device, physical-phone interaction, live Clerk sign-in and external delivery remain not_run by scope. The new native handoff is covered by a component test. Advisory Impeccable scan returned `[]`.

Initial full API gate passed: 900 tests, 5,400 assertions, zero failures/errors/skips; RuboCop 476 files clean; Brakeman zero warnings (one existing ignored warning); bundler-audit no vulnerabilities. Initial mobile gate passed 104 suites/694 tests with 22 existing lint warnings. Final rebased gates are recorded below. Regression tests cover role visibility, module/lesson save payloads, retained failed drafts, typed-email restart, compatibility routes, six section failures/retries, pending-source independence, late responses and drawer errors. Existing recovery-plan check-in/outcome tests remain required.

## Resource ownership

Session `01a161b3-fd4c-7f71-8c1b-d05ad0f3a21b`. Assigned API/web ports 3620/5620. Baseline audited; all existing servers, simulator and shared PostgreSQL/Redis/model/sync services are borrowed. Dedicated test DB `api_test_p10_student_workspace`; runtime DB `csg_p10_student_workspace_dev` (created only by this worker). Both QA phases were cleaned: exact API/Vite PIDs and task-created browser tabs closed, temporary entries removed, lifecycle status has no active owned resources. No simulator or container was started. Dedicated test/development databases and the two task-created parallel test copies were dropped after the final gate; worktree/PR retained for integration owner.


## Final rebased gate

`git fetch origin && git rebase origin/main` verified the base still at `b5f207f`; no integration changes were needed. Final source was tested at `e2ddee8` (the ledger is amended afterward).

- API: `DATABASE_URL=postgresql:///api_test_p10_student_workspace PARALLEL_WORKERS=2 bin/rails test`: 900 tests / 5,400 assertions; zero failures/errors/skips, seed 7570. RuboCop 476 files clean; Brakeman zero warnings (one existing ignored warning); bundler-audit no vulnerabilities.
- Web: `npm ci` and final `npm run check` passed: lint, typecheck, 98 suites / 572 tests, Netlify/service-worker routing checks, production build and initial bundle budget. Focused Access/workspace/drawer/directory regressions: 32 tests passed.
- Mobile: `npm ci` and final `npm run check` passed: typecheck, 104 suites / 695 tests; 22 existing lint warnings, zero errors. No dependency changes, so Expo install check was not needed.
- Final advisory Impeccable scan returned `[]`.

No schema, dependency, deployment configuration or production data changes. Finding status: X1 fixed; T5 fixed; StudentWorkspace X6 conditional copy removed. Required release/deployment verification belongs to the integration owner after merge.

## Final directory regression

Final diff review found a contradictory empty state when a search matched an unenrolled profile but no enrollment rows. A regression reproduced it before the fix (one failing/one passing directory test), then both existing directory/filter tests and both new directory tests passed. Profile rows now count as results, and the cohort summary explicitly counts enrollments. Runtime retest of the real StudentManagement component with local fixture responses passed at 1280×800 and 390×844: the profile link remained visible, “No students found” was absent, and neither layout overflowed. This short read-only component run used no database; its Vite process/tab and temporary entry were cleaned.

The full web gate was rerun and passed **98 suites / 573 tests**, lint/typecheck, routing/service-worker checks, build and bundle budget. The focused regression set now contains 33 tests. API/native source is unchanged from the fully passed gate above. At that checkpoint CodeRabbit and CI were pending; the subsequent review and rebase are recorded below. PR #204 is held for the lead, with no merge or production deployment performed.


## CodeRabbit round 1 and P13 integration

Main advanced to `d5406f3` (#200/P13) before the final push. Rebase completed without conflicts; P10 does not modify the inherited offering/checkout changes. Final implementation source was tested at `0cbf6c9` on that base; only this ledger is amended afterward.

CodeRabbit reviewed `30573af` and published two valid findings. Both are fixed: video failure assertions now use the actual metric labels, and a failed background progress/cohort refresh after a successful Access save preserves loaded data, the save outcome and healthy sections. A persistent local banner explains that details may be stale and offers Retry with a refreshing state. The new regression failed before the fix (workspace heading disappeared) and passed afterward; all 18 workspace tests passed.

Rebased browser retest used the real StudentWorkspace/Access and Rails API on the same isolated ports/DB, with synthetic admin identity. At 1280×800, a saved module override followed by failed progress refresh kept the learner heading, Access success and healthy Work record visible; Retry recovered. At 390×844 the same flow passed with failed cohort refresh. Neither overflowed. Enrollment status and wrong/correct-email restart were repeated at both widths on the P13 combination: selector returned to active, recovery snapshots were created and independent-course work remained. The temporary entry, exact API/Vite PIDs and owned browser tab were cleaned. No native device was used.

Final combined gates:

- API: **923 tests / 5,554 assertions**, zero failures/errors/skips (seed 7161, two isolated workers). RuboCop **478 files** clean, Brakeman zero warnings (one existing ignored warning), bundler-audit no vulnerabilities.
- Web: full `npm run check` passed, **103 suites / 612 tests**, lint/typecheck, routing/service-worker checks, production build and bundle budget. P10 focused regressions now total 34 tests.
- Mobile: full `npm run check` passed on rerun, **104 suites / 695 tests**, 22 existing lint warnings and zero errors. The first concurrent run had one timeout in the existing Activity pagination assertion at native-learning-nav.test.tsx:171; the unchanged assertion passed in isolation and in the full rerun. No native Activity production code or test assertion was changed.
- Advisory UI scan after the fixes returned `[]`.

Original CodeRabbit comments 4344502750 and 4344502762 are addressed; final-head automated coverage remains a lead checkpoint, not a claim of clean fresh approval. PR stays held and unmerged. All recreated P10 test/dev databases and parallel copies are dropped after the gates. All owned lifecycle resources are cleaned; the worktree and branch remain for the integration owner.

## PR #204 review-fix round: schedule inheritance and complete student discovery

Rebased original `7f2a6ca` onto `origin/main` at `f669c39` without conflicts. Review-fix implementation commit: `5fc39b8` (the final follow-up documentation commit records gate results). Integration owner retains merge control; no CodeRabbit review was requested.

Changes:

- Lesson access has explicit Follow schedule, Unlock now, Lock, and Unlock on date choices. Following the schedule deletes an existing lesson override; submitting a cleared date does the same. Saving an untouched inherited lesson creates no override. Lock remains an explicit false/null lesson assignment. Modules retain their assignments and follow the schedule by clearing both force-unlock and date; module access does not offer a false promise of an indefinite lock, which its existing API does not implement.
- Students combines dashboard activity rows with every omitted directory enrollment. Paused/completed/expired/past-only learners retain exact enrollment workspace links, visible enrollment statuses and cohort filtering. Active dashboard rows remain first; directory-only rows sort active first then by learner name. Empty dashboard activity groups are omitted when the corresponding learners appear in directory cards. Existing archived-profile recovery remains available to admins.
- Unopened self-paced support shows “Starts on first course open.” Progress now returns the selected enrollment's first-open time; directory enrollment facts include cohort status and access expiry. API additions are additive; no migration or provider configuration change.

Regression evidence: the two focused web files pass 20 tests. Replaying the pre-fix components against the updated tests produced eight failures, including saved lesson date clearing, the accidental false/null lesson lock, unopened support wording and missing directory workspace links. The focused API suite passed 52 tests / 235 assertions, no failures/errors/skips. Its new regression proves that nulling the module date and deleting the lesson override restore availability after release, while explicitly recreating a false/null lesson assignment locks access. Another verifies selected-enrollment first-open serialization.

Agent browser acceptance used actual StudentAccess, StudentManagement and StudentWorkspace components with the real Rails API, synthetic admin identity and dedicated `csg_p10_student_workspace_dev`. Test-only auth replaced Clerk in a temporary local entry, subsequently removed. Required viewports: 1280×800 and 390×844.

- Passed: saved future module and lesson dates returned to the normal schedule; null module date and deleted lesson override persisted and both were available after reload. Desktop used the Follow schedule button; mobile also exercised clearing the lesson date input before saving.
- Passed: explicit lesson Lock saved a false/null override and made the released lesson unavailable at both widths. Mobile Unlock now saved independently; Unlock on date saved the module/lesson dates independently before clearing them.
- Passed: unopened self-paced enrollment displayed the first-open support wording at both widths; the other enrollment retained its own support facts.
- Passed: directory showed Active, Paused, Completed and Access ended statuses with all six fixture enrollments at both widths. Cohort filter included past cohorts absent from the dashboard. A completed learner link opened the exact workspace at 390px; a paused learner link opened the exact workspace at desktop. All fixture link destinations were inspected. Active rows preceded inactive rows, and the filtered directory summary stayed accurate.
- Passed: no horizontal document overflow at either width; visible Access controls were at least 44px on mobile. Mobile directory screenshot was inspected after the empty-group cleanup.
- Transient environment issue: the T3 preview host disconnected during mobile actions. Its status recovered; the interrupted actions were repeated and persisted outcomes rechecked. No remaining browser acceptance blocker.
- Not run by scope: live Clerk login, physical phone/native interaction, production deployment and external delivery. No mobile code changed in this round.

Advisory Impeccable scan returned `[]`. Full gate results are recorded in the final handoff after completion. Session `01a161ee-b0e5-7e60-ac68-1e6cb0ca8807` owned Vite PID 60685, Rails PID 78925 and browser tab `tab_6n_62d87cd1-1de8-4198-b58d-ab023365657f`; all were closed and lifecycle status reports no active owned resources. Shared services and borrowed simulators were untouched.

Final clean web gate at implementation `5fc39b8` passed: npm ci completed, then npm run check using Node 22.22.3 passed lint, typecheck, 105 suites / 648 tests, Netlify/service-worker checks, production build and initial bundle budget. The temporary QA entry was absent. API static/security gates passed: RuboCop 480 files clean; Brakeman zero warnings (one existing ignored warning); bundler-audit no vulnerabilities. The full API result remains pending at this checkpoint.

Final full API run at implementation `5fc39b8`: **938 tests / 5,710 assertions, 1 failure, zero errors/skips**, seed 29551, two isolated workers. The sole failure was unchanged `MessageDeliveryConcurrencyTest#test_concurrent_retries_serialize_created_and_thread_broadcasts` at line 67: “concurrent delivery did not finish” after its five-second join deadline. The full run took 1,680.6 seconds amid substantial concurrent host/database load. Its entire unchanged test file passed immediately in isolation against the dedicated base test database: **6 tests / 43 assertions, zero failures/errors/skips**, seed 60053. No timeout, assertion or messaging implementation was changed. This is evidence for a timing-sensitive failure, not a claim of a clean full API gate. All affected Access/directory regressions passed. Lead retains the gate/review/merge decision.
