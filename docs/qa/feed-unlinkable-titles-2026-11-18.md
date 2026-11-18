# Activity feed subject privacy — 2026-11-18

CSG Learn serves Code School of Guam learners, instructors and administrators. Its staff feeds summarize learner activity; cohort teaching access and curriculum membership constrain the records staff may open. Sources: `PRODUCT_VISION.md`, `ROADMAP.md`, `ActivityEventsController`, `StaffCohortScope`, and the #290 `RecordDetail::ActivityEventPage`, inspected on base `6c169d6d`. Leon's supplied 2026-11-18 decision requires titles to follow those links' access boundary. Production deployment was not inspected; this PR is held for its parent implementation coordinator.

The detail page and staff feeds now share `RecordDetail::ActivitySubject`. It checks the event cohort, viewer visibility, learner membership, record ownership/cohort and curriculum (including submission curriculum). Membership is loaded for the whole page. Staff responses expose a subject label and record ID only with an allowed destination. The web renders “Activity recorded” for an unavailable subject. Admins retain allowed subjects; mismatched references remain hidden even for admins.

Learner personal timelines still use the existing loading, labels, IDs and learning access checks. Regression coverage confirms expired access removes the learning destination while keeping the learner's historical label and ID. No migration or production prepared-statement configuration changes are needed. OpenAPI already allowed nullable labels and record IDs; its clarified description was regenerated into both web and mobile type files.

Agent-executed acceptance:

- Instructor: mismatched curriculum block/submission, another cohort's recording, and a learner outside the event cohort return null label, record ID and destination. Same-cohort allowed subjects retain their labels and destinations. Staff no-feed history is covered too.
- Admin: allowed other-cohort recording retains its title and link; inconsistent references stay hidden.
- QueryCounter: cohort feed grows from 3 to 18 events and school feed from 6 to 36, adding distinct learners, cohorts, lessons, blocks, submissions, enrollments and recordings. All expected destinations are present; total query counts do not grow.
- Browser: Chromium at 1280×844 and 390×844, synthetic instructor cohort feed and admin school feed. All four cases passed: secret title absent, neutral row visible without a subject link, allowed exercise link opens the exact block, Back restores the feed. Fresh isolated QA fixtures, real API responses and Vite UI; external browser requests blocked. Safari/native and production Clerk/provider behavior were not tested.

Tested implementation commit: `1003aaca75c030fe74b07b1fcf80f33cda69e4e5` (the committed source matches the local test and browser runs). The later evidence commit changes documentation only.

Automated checks on the final implementation:

- Focused API: `activity_history_test`, `record_detail_test`, `record_detail_query_counts_test`, with `PARALLEL_WORKERS=1` and task-owned database URL using `prepared_statements=true` and `false`: 52 runs / 536 assertions / zero failures, errors or skips in each mode.
- RuboCop: 797 files, zero offenses; final expanded query test also linted.
- Brakeman: zero warnings (one existing ignored warning).
- Web: affected feed, learner timeline/destinations and record-detail tests: 4 files / 39 passing tests; typecheck, lint and `api:check` pass. `npm run api:generate` regenerated both clients. Impeccable advisory scan: no findings.
- Full ASUS gate passed: 2,295 runs / 43,864 assertions / zero failures or errors / one skip in each prepared-statement mode. Mode assertions, both full suites, remote RuboCop and remote Brakeman all returned zero; gate failed stages: 0. Invoked once through `asus-test --postgres csg_learning_platform_test <worktree> -- bash scripts/qa/scheduled-jobs-gate.sh`. This runs the full Rails suite in both prepared modes, RuboCop and Brakeman. Its source snapshot contains the same implementation and the initial passing query regression; only the query fixture was strengthened afterward and rerun locally in both modes.

The first local focused attempt hit a macOS `pg` native crash during Rails process forking. It was stopped and rerun successfully with one worker. Task-owned local API/Vite servers, Chromium contexts and QA database were cleaned after browser QA; the focused test database was dropped. The borrowed PostgreSQL service was preserved. The held worktree and PR remain available for review.

The ASUS wrapper exited successfully; its trap cleaned the disposable PostgreSQL container/database and stopped WSL. The lifecycle registry has no remaining owned resources. No PR watch or merge was requested or started.
