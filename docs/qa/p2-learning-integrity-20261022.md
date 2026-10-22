# P2 learning evidence integrity

2026-10-22; isolated branch `fix/p2-learning-integrity`, base `3eee7c4`.
Agent-executed affected-flow QA. No simulator or production writes.

CSG Learn serves Code School of Guam learners and a small teaching team. Students submit text/repository evidence, revise ungraded work, and create a new attempt after a redo. Staff review the latest attempt; previous attempts remain inspectable. Enrollment-specific progress is derived from submissions, GitHub sync, grading, or retrieval attempts where applicable. Manual practice and video progress remain writable.

Sources: common audit WORKER_BRIEF.md and PLAN.md (2026-10-22), verify-student.md S2/N-S1, verify-staff.md N-T3; repo AGENTS.md, ContentBlock, Enrollment, SubmissionsController, web/native submission and review components. Brain-Dump code-school/_overview.md supplies historical school context; the newer task brief governs pilot decisions. API deploys on Render and web on Netlify; this PR is held for lead integration. No migration or historical data rewrite.

Required acceptance:

| Case | Fixture/actions and expected result | Status |
| --- | --- | --- |
| P2-1 | Reviewed blocks and retrieval checks reject direct completion/reopening; existing progress unchanged. Manual practice/video still work. | Passed: API integration tests, including a real correct retrieval attempt. |
| P2-2 | Edit current ungraded text/repository submission; PATCH keeps attempt ID. Invalid required fields show named errors and preserve draft, stored work, and progress; valid partial edit saves. | Passed: API/component regressions; browser text Update kept id 2/attempt 2; repository create id 3/attempt 1, note edit PATCH kept id 3/attempt 1 and stored revised note. Clearing required live URL disabled submission and kept the draft; stored URL unchanged. |
| P2-3 | Redo creates a new attempt; passing reviewed work offers inspection. | Passed: browser staff requested R on id 4; learner Resubmit created id 5/attempt 4 and returned to awaiting review. Passing review hides editing in component tests; final browser passing-state render was not observed before cleanup. |
| P2-4 | Staff inspect older attempts in queue/detail/matrix/native; controls read-only and latest action targets correct attempt. | Passed: real web Detail, Grading history, CohortModuleGrading history at 1280×800 and/or 390×844; feedback/grade controls disabled, code/feedback inspectable, latest link navigates to current record. No horizontal overflow in tested views. Native action component passed; installed-device dimension not run. |
| P2-5 | New attempt arrives during review; old grade rejected, reviewer draft kept, no current-progress/notification/GitHub effects. Cross-enrollment attempts independent. | Passed: browser review id 2, concurrent API fixture creates id 4; Grade A rejected, review became read-only, draft retained and latest link targets id 4. DB confirmed grade nil, progress completed, zero grading events. API tests also assert no notification/GitHub calls and cross-enrollment/timestamp-tie behavior. |

Native installed-device QA is not run: no simulator assigned. Component tests cover native changes. Live Clerk/GitHub/email delivery are outside this isolated run. Runtime used real components in a temporary Vite entry and real Rails endpoints, owned ports 5612/3612, database `csg_p2_learning_integrity_dev`. A local-only identity shim replaced Clerk verification; no production identity or credentials were used. Initial development reloads removed that shim; the final runtime used Rails test configuration against the same isolated fixture DB. No auth shim or QA entry is committed.

Browser QA found a successful PATCH could restore stale content while the parent refreshed the same attempt ID. Fixed with a saved-response overlay keyed by learner/cohort/block draft scope, and covered delayed refresh plus cohort switching in a regression. Runtime retest confirmed `Final P2 updated note` stayed visible and saved on id 3. Blank optional artifact fields are sent explicitly by both clients so edits can clear them.

Evidence: isolated API/component tests; browser semantic snapshots and DOM state; stored submission/progress/event checks. Local race screenshot: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-localhost-mvitsp4n-2b1d3088.png`. Monaco text replacement through the browser tool was not completed; the text-edit rejection/preservation is covered by web and native component interaction tests. Browser repository editing and real PATCH persistence were completed.

Final gates: API 797 tests / 4,094 assertions; RuboCop 457 files clean; Brakeman zero warnings (one existing ignored warning); bundler-audit clean. Web full check: 82 files / 472 tests, lint/typecheck/Netlify checks/build/bundle checks. Native full check passed: brand/typecheck/lint and 91 suites / 584 tests; 19 existing lint warnings remain. No dependency changes. Impeccable advisory scan returned `[]` for changed web views.

Lifecycle session `01a16106-4952-7993-80ae-5d5e31e67a41`: owned browser closed, API/web processes stopped, temporary QA entry removed; status shows no active owned resources. Owned test/dev DBs (including the two parallel test copies) were dropped after final gates. Worktree and branch stay available for the integration owner. No merge or deployment performed.
