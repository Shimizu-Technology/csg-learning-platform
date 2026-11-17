# "Where used" and content record pages (W5 PR 5.4), 2026-11-17

Backlog items L-3.1 (lesson editor context), L-3.2 ("where used" relationships) and L-5 (staff record pages for curriculum, module and lesson). Base: main `3ec803d7`. Branch `feat/where-used`. Synthetic data only. Executed by the implementation agent on the Mac mini.

## What changed

- **API:** `GET /api/v1/records/:type/:id/usage` (`RecordUsage`) for `curriculum`, `module` and `lesson`. It is staff only. Admins see every cohort; instructors see only the cohorts they teach, with the rest as `other_cohorts_count`. Counts match Grading for the same scope (#281): every attempt, and latest attempts without a grade.
- **Leak fixed in the lesson editor:** `GET /lessons/:id/block_editor` listed every cohort on the curriculum in `context.used_in`, and counted every cohort's submissions and help, for instructors too. It now lists only visible cohorts, adds `other_cohorts_count`, and counts only the listed cohorts. `waiting_count` now counts latest attempts, as Grading does.
- **Leak fixed in curricula:** `live_checkout_offerings` named on-sale cohorts to instructors. Instructors now get an empty list. Only admins can change curriculum status, which is what uses it.
- **Team member page (instructor relationships):** each cohort they teach shows waiting work and open help. A new section lists the active follow-up plans they own, plus a count of the help requests they own.
- **Web:** new pages `/admin/curricula/:id`, `/admin/modules/:id` and `/admin/lessons/:id`, each with a record header, a "Used in" list and a related panel. The record-route registry now points `curriculum`, `module` and `lesson` at them for staff (`view: 'edit'` opens the editor and `view: 'learn'` the learner view), so `RecordLink`, peek cards and related rows lead there. Curriculum names on the cohort workspace header, the Learning tab and cohort settings now link to the curriculum page. Content gets a "Where it's used" button. Staff search results for a curriculum open its page.
- **Lesson editor (L-3.1):** Back names where the editor was opened from (Content, the lesson page, Grading…). With no history it goes to the lesson page. The breadcrumb links Curriculum › Module › Lesson to their pages. The inspector's "Used in" shows each cohort, when the lesson opens there, View as student, and its submissions, waiting work and help.

## Automated gates

| Gate | Result |
| --- | --- |
| API full suite, `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1`, commit `3206baa3` | Default prepared statements: 1,936 runs / 41,218 assertions, 0 failures/errors/skips, coverage check passed. `?prepared_statements=false`: same counts, 0 failures. |
| New API tests | `record_usage_test.rb` (8 tests, including query-count growth for all three types and the team page), editor scoping, team workload and offering-name tests. On the old controllers, 17 tests fail. |
| Query counts | Flat as cohorts, lessons, submissions, rubrics, objectives, copies and follow-ups grow (`endpoint_query_counts_test.rb` and `record_usage_test.rb`) |
| RuboCop / Brakeman | No offenses / no warnings (one existing ignored) |
| Web typecheck, lint, vitest, build, `test:bundle`, `api:check`, Netlify checks | Passed |
| Mobile typecheck, lint, Jest (generated types changed) | Passed. Lint: 74 warnings, 0 errors, unchanged. Jest: 136 suites / 1,430 tests. |
| Impeccable advisory scan of the changed UI files | No findings |

## Real UI checks

Harness: `scripts/qa/run start`, then `scripts/qa/where-used-fixtures.rb`. The fixture puts "QA Program 2" (one learner, one submission, one open question) on QA Program Lab alongside QA Program. The QA instructor teaches only QA Program. It also moves "QA Program 3" to its own copy, made by the admin. Spec: `scripts/qa/where-used.spec.ts` in Chromium at 1280 and 390, light and dark. Every recorded screen is checked for no sideways scroll, no serious axe violations and no contrast violations. Screenshots are under `.qa-local/where-used/` (ignored).

| # | Scenario | 1280 light | 1280 dark | 390 light | 390 dark |
| --- | --- | --- | --- | --- | --- |
| 1 | Admin: Content → "Where it's used" → curriculum page (both cohorts, copy history, rubric lessons) → module page (cohort schedules, Module grading) → lesson page (both cohorts) → Submissions row opens Grading filtered to the lesson → Edit lesson → editor breadcrumb links (1280) or Settings "Used in" (390) → Back to the lesson page → Back to the module | Passed | Passed | Passed | Passed |
| 2 | Instructor: usage and editor payloads contain no QA Program 2 / QA Program 3 / their learner; curriculum page shows one cohort and "1 other cohort uses this curriculum…", and "1 more copy was made for cohorts you don't teach"; lesson page shows one cohort, "Open in editor", and a Submissions count equal to their own Grading queue's All count; View as student opens the lesson in QA Program's preview; the editor shows none of the other cohort's names | Passed | Passed | Passed | Passed |
| 3 | Student: `/admin/lessons/:id` shows "No access"; all three usage endpoints answer 404 | Passed | Passed | Passed | Passed |
| 4 | Admin: team member page shows the grading load row and the owned follow-up plan; the plan opens with "Back to Team member · …" and returns | Passed | Passed | Passed | Passed |

16 of 16 passed. Two first-run failures were spec expectations, not app defects. The editor opened from the lesson page says "Back to Lesson · QA Lab 1.1.1", which names its origin per spec §4.2. The lesson page's URL keeps its own `return_to`. Both spec expectations were corrected and the run repeated.

## Not run

- WebKit / Safari: WebKit doesn't start on the Mac mini. Not run.
- Native mobile: this is staff web. Mobile parity is a follow-up (see the PR).
- Real Clerk sign-in, screen readers and physical phones.

## Cleanup

The harness servers (exact PIDs claimed in the lifecycle session) were stopped and their `csg_qa_` database dropped with `scripts/qa/run clean`. The two Rails test databases (`csg_where_used_test`, `csg_where_used_test_b`) were dropped. The account's shared `agent-postgres` server was left running.
