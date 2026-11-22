# W9 small-class QA · November 22, 2026

AS-5 adds small-class settings for Code School of Guam cohorts. Admins choose how long each learner can access lessons and get help. Learners see a feedback date on waiting work. Instructors see late reviews on Today and in Grading. The work follows the W9 design proposal sections 2 and 9.5. Verification was repeated after rebasing onto `origin/main` at `98b3f1c9`, which includes learner reminders. The tested implementation tree is `e44f5718`.

## Browser acceptance

Agent-executed on macOS with bundled Chromium, the real web app and Rails API, and the isolated `scripts/qa/run` PostgreSQL database. The fixture creates a guided pilot with on-time and overdue attempts, weekly office hours, and a separate program cohort with Cohort 3’s student-experience switch Off. All people and submissions are synthetic.

| Scenario | 390 light | 390 dark | 1280 light | 1280 dark |
| --- | --- | --- | --- | --- |
| Create a small class and verify its fixed access date in the saved response | Pass | Pass | Pass | Pass |
| Save 12 months of access, eight weeks of support, and a two-business-day review target alongside the response text. Recover from an invalid target and verify all four values after reload | Pass | Pass | Pass | Pass |
| Verify the feedback date on Student Today and My work, the optional check-in and its Join link, and the original learner’s stored terms | Pass | Pass | Pass | Pass |
| Verify the overdue pill in Instructor Today, the grading queue and the opened review. Confirm the on-time item has no pill | Pass | Pass | Pass | Pass |
| Verify the Cohort 3 fixture still opens legacy Today and its grading row has no review-target alert | Pass | Pass | Pass | Pass |

The first mobile pass exposed a clipped delivery label in the native select. Wrapping radio options resolved it at both widths. The spec checks 44px control targets, horizontal overflow, and a text-to-fill contrast ratio of at least 4.5:1 for the overdue pill. The Join destination is a synthetic URL. Native devices and production data were outside this pass.

Run from the repository root with the required gems, npm dependencies, and bundled Chromium installed. The spec resets its fixture before each combination.

```sh
scripts/qa/run start
QA_SPEC=w9-small-class.spec.ts DEV_LIFECYCLE_SESSION=<active-session> \
  node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
scripts/qa/run clean
```

The final Playwright run passed four tests with zero retries or skips. `scripts/qa/run clean` stopped the owned servers and dropped the QA database. The local JSON results and captures are in `.qa-local/results.json` and `.qa-local/test-results/`.

## Automated verification

- The full rebased Rails suite passed on the ASUS runner with three workers. It ran 2,553 tests and 46,470 assertions with zero failures or errors and one pre-existing skip. The initial four-worker run hit a timing-sensitive curriculum-copy concurrency assertion. The affected tests passed in isolation and on the full retry.
- The full prepared Rails suite with OpenAPI coverage passed on the original base before the rebase, with 2,508 tests, 46,198 assertions, and one pre-existing skip.

- Targeted Rails, migration, OpenAPI, and parity tests on Ruby 3.3.14 and PostgreSQL 16 passed with `prepared_statements=true` and with `prepared_statements=false`. Each run had 83 tests, 624 assertions, and zero failures, errors, or skips. Each used `PARALLEL_WORKERS=1` and an owned temporary database.
- The existing golden parity test passed without changes to its fixture or expected output. The new Cohort 3 regression compared raw dashboard, staff Today, My Work, grading, and cohort settings responses before and after enabling the pilot’s settings.
- The review target starts counting after the submission’s Guam calendar date and runs through the end of the target day. Tests cover a UTC-to-Guam date boundary, weekends, school holidays, overdue ranking after help, paginated overdue counts, and fixed dates taking precedence over relative terms.
- RuboCop found zero offenses across 865 files. Brakeman 8.1.1 found zero security warnings under the repository’s existing ignore configuration.
- Mobile `npm run check` passed, including 1,833 Jest tests in 142 suites. Lint reported zero errors and 74 existing warnings. Both OpenAPI type files were regenerated.
- Web `npm run api:check` and `npm run check` passed with Vitest limited to four workers. All 3,544 tests across 258 files passed, along with lint, typecheck, Netlify checks, and the production build and bundle check. The first run hit a timing-sensitive focus assertion in the existing Content Management suite.
- Impeccable’s advisory scan reported no findings on the changed UI.
