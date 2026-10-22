# P10 student workspace — 2026-10-22

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
