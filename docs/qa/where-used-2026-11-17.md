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

Harness: `scripts/qa/run start`, then `scripts/qa/where-used-fixtures.rb`. The fixture puts "QA Program 2" (one learner, one submission, one open question) on QA Program Lab alongside QA Program. The QA instructor teaches only QA Program. It also moves "QA Program 3" to its own copy, made by the admin. Spec: `scripts/qa/where-used.spec.ts` in Chromium at 1280 and 390, light and dark. Every recorded screen is checked for no sideways scroll, no serious axe violations and no contrast violations.

| # | Scenario | 1280 light | 1280 dark | 390 light | 390 dark |
| --- | --- | --- | --- | --- | --- |
| 1 | Admin: Content → "Where it's used" → curriculum page (both cohorts, copy history, rubric lessons) → module page (cohort schedules, Module grading) → lesson page (both cohorts) → Submissions row opens Grading filtered to the lesson → Edit lesson → editor breadcrumb links (1280) or Settings "Used in" (390) → Back to the lesson page → Back to the module | Passed | Passed | Passed | Passed |
| 2 | Instructor: usage and editor payloads contain no QA Program 2 / QA Program 3 / their learner; curriculum page shows one cohort and "1 other cohort uses this curriculum…", and "1 more copy was made for cohorts you don't teach"; lesson page shows one cohort, "Open in editor", and a Submissions count equal to their own Grading queue's All count; View as student opens the lesson in QA Program's preview; the editor shows none of the other cohort's names | Passed | Passed | Passed | Passed |
| 3 | Student: `/admin/lessons/:id` shows "No access"; all three usage endpoints answer 404 | Passed | Passed | Passed | Passed |
| 4 | Admin: team member page shows the grading load row and the owned follow-up plan; the plan opens with "Back to Team member · …" and returns | Passed | Passed | Passed | Passed |

16 of 16 passed. Two first-run failures were spec expectations, not app defects. The editor opened from the lesson page says "Back to Lesson · QA Lab 1.1.1", which names its origin per spec §4.2. The lesson page's URL keeps its own `return_to`. Both spec expectations were corrected and the run repeated.

## Fix round 1 (independent review: one P1, two P2, one P3)

Base: the PR head `89e9fe99`. Main had not moved.

- **P1, privacy in the lesson-editing payloads.** An instructor with editing access to Cohort A, which shares its curriculum with B, still got B by name and B's work in counts. `StaffCohortScope` now holds the rule from the usage endpoint: admins see every cohort; instructors see the cohorts they teach by name and in counts, and other cohorts only as a number. It is applied to:
  - the block editor's `access` (`shared_with`, the new `shared_with_others_count`, `message`, and `copy_of.cohort`), the refused-save message, `block_activity` and the knowledge-check `attempt_count`;
  - `lessons#show` attempt counts;
  - the copy preview's `shared_with`;
  - module `submissions_count` in `curricula#show` and `modules#show`.

  The copy-before-edit notice now reads "Read only: 1 other cohort shares this curriculum". Anyone who can edit sees every cohort, and the save path's learner-work protection still checks every learner. Two fields were audited and kept: `deletion_blocked` (an admin-only structural guard with no cohort name or count) and the Content studio's documented `cohorts_count`.
- **P2, counts versus the lists they open.** A lesson or module page focused on a cohort (`?cohort_id=`) shows that cohort's counts and links to its lists. Unfocused, it shows the totals and links without a cohort, which cover exactly those cohorts.
- **P2, help links.** `GET /support_queue` takes `lesson_id` / `module_id`. The filter is applied on the server, inside the viewer's cohorts, and limits the help lists and help counts. It returns `help_filter`, which names the lesson only when it is in the viewer's cohorts. Support shows a removable chip, and a help request opened from the filtered list walks the same list. Every "open help" count on a lesson or module now opens exactly that help.
- **P3.** The query-growth test now runs each viewer and type combination as its own test, and asserts that every kind of record grew between the two measurements. The team-page test asserts the same.

**Tests that fail on the round-0 code:**
- `shared_curriculum_privacy_test.rb`: 4 tests;
- the Support filter test in `record_usage_test.rb`;
- web: focused and unfocused counts on lesson and module pages, the lesson-scoped help list, the Support lesson filter, and the unnamed sharing notice.

Three #276 tests that asserted an instructor sees a cohort they don't teach by name now assert the count instead.

**Gates on the fix commit:**

| Gate | Result |
| --- | --- |
| API full suite, `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1`, default prepared statements | 1,947 runs / 41,312 assertions, 0 failures/errors/skips, coverage check passed |
| API full suite, `?prepared_statements=false` | Same counts, 0 failures |
| RuboCop / Brakeman | 697 files, no offenses / no warnings |
| Web typecheck, lint, vitest, build, `test:bundle`, `api:check` | Passed; 208 files / 2,435 tests |
| Mobile typecheck, lint, Jest | Passed. Lint: 74 warnings, 0 errors, unchanged. Jest: 136 suites / 1,430 tests. |

**After merging main (`aa0cf1b4`, #286):**
- API, both prepared-statement modes: 1,959 runs / 41,385 assertions, 0 failures, coverage check passed. RuboCop (698 files) and Brakeman clean.
- Web: 209 files / 2,443 tests pass, plus typecheck, lint, build, `test:bundle` and `api:check`; the generated types were unchanged by the merge.
- Mobile: typecheck passes, lint has 0 errors, Jest 139 suites / 1,506 tests pass.

**Browser re-run.** The fixture now gives the QA instructor editing access to QA Program (A) only, and adds a question on another QA Program lesson. A new scenario 5 covers the instructor of A:
- six payloads contain no QA Program 2 / QA Program 3 / their learner: block editor, curriculum, module, lesson, copy preview, and Support filtered to the lesson;
- the editor's activity equals their own Grading count;
- the shared lesson's editor reads "Read only: 1 other cohort shares this curriculum" and offers "Make a copy for QA Program";
- the lesson page focused on A shows A's Grading counts;
- its "open help" opens Support filtered to that lesson, with the same number of requests and without the other lesson's question.

All 5 scenarios passed at 1280 and 390, light and dark: 20 of 20, with no sideways scroll and no serious axe or contrast violations. The harness was stopped and its database dropped afterwards.

## Not run

- WebKit / Safari: WebKit doesn't start on the Mac mini. Not run.
- Native mobile: this is staff web. Mobile parity is a follow-up (see the PR).
- Real Clerk sign-in, screen readers and physical phones.

## Cleanup

The harness servers (exact PIDs claimed in the lifecycle session) were stopped and their `csg_qa_` database dropped with `scripts/qa/run clean`. The two Rails test databases (`csg_where_used_test`, `csg_where_used_test_b`) were dropped. The account's shared `agent-postgres` server was left running.
