# W7 PR 7.3 QA: Grading workbench and module grading grid

Date: 2026-11-16. Branch `feat/grading-workbench`, based on `origin/main` at `b0d3309e`.
Executed by the agent on the Mac mini (Chromium only; WebKit does not start on this machine).
All data is synthetic: the QA harness seed plus `scripts/qa/grading-fixtures.rb`.

## Scope

Affected-flow QA for U-4.1, U-4.2, U-4.5, L-2.1, L-2.2, L-2.4 and T-13:
the Grading workbench at `/admin/grading`, the submission review panel it shares
with the record page and the module grid, and the module grading grid.

## How it ran

```sh
scripts/qa/run start
cd api && DATABASE_URL=postgres://localhost/<csg_qa_ database> bundle exec ruby ../scripts/qa/grading-fixtures.rb
cd web && npx playwright test --config ../scripts/qa/playwright.config.ts grading-workbench.spec.ts
scripts/qa/run clean
```

The fixture adds a three-week module to QA Program: week 1 fully graded, weeks 2
and 3 with work waiting from 50 minutes to 9 days, a Markdown answer, a
`ticket-price.js` answer, a redo followed by a resubmission, and two exercises
whose titles look the same once cut. Each instructor run grades one item.

Personas: instructor (`qa_user=2`, teaches QA Program and QA Self paced) and admin (`qa_user=1`).
Widths: 1280 and 390 (height 844). Themes: light and dark.
Each checkpoint recorded sideways overflow, axe WCAG 2.1 A/AA (serious and
critical gated, contrast recorded), the active theme and a screenshot under
`.qa-local/grading-workbench/` (ignored).

## Results

12 of 12 Playwright runs passed (3 journeys × 2 widths × 2 themes), 32 checkpoints.
Every checkpoint: no sideways overflow, no serious or critical axe findings, no
contrast findings, no page errors.

| Scenario | 1280 light | 1280 dark | 390 light | 390 dark | Evidence |
| --- | --- | --- | --- | --- | --- |
| Queue rows show student, item, cohort with week or self-paced, and waiting time, oldest first; 9 d shows in the danger tone | Pass | Pass | Pass | Pass | `queue` |
| Markdown answer renders (bold, list, fenced code in the shared code block) | Pass | Pass | Pass | Pass | `review-markdown` |
| Grade bar pinned in view while reading a long review | Pass | Pass | Pass | Pass | `gradeBarInView: true` |
| Redo with no feedback is blocked: no request, message in the pinned bar, in view | Pass | Pass | Pass | Pass | `redo-blocked`, `alertInView: true` |
| Typing `a b c r` in the feedback box sends no grade | Pass | Pass | Pass | Pass | grade request count 0 |
| Grade A after scrolling to the bottom; the next item opens with its header at the top | Pass (y 24) | Pass (y 24) | Pass (y 64, under the app bar) | Pass (y 64) | `next-at-top` |
| J moves to the next item with focus outside the feedback box | Pass | Pass | Not run (no keyboard on phones) | Not run | URL `submission` changes |
| Module and order filters kept in the URL and restored by a reload | Pass | Pass | Pass | Pass | `filters-after-reload` |
| Phone: the review is full screen, the queue is hidden, Back to queue returns | n/a | n/a | Pass | Pass | `review-markdown` |
| Module grids list: only modules with work, waiting count each | Pass | Pass | Pass | Pass | `module-grid` |
| Grid opens on week 2, the first with ungraded work (week 1 all graded) | Pass | Pass | Pass | Pass | `module-grid` |
| Grid column header: link to the lesson; full title on keyboard focus | Pass | Pass | Pass | Pass | `headerHref` `/lessons/57?cohort_id=1` for the instructor |
| Grid cells and legend use icons, no `✓` or `•` | Pass | Pass | Pass | Pass | table text |
| Grid Back goes to `/admin/grading?cohort_id=1` | Pass | Pass | Pass | Pass | URL |
| Admin: breadcrumb Cohort › Student › Lesson links; Lesson opens the editor | Pass | Pass | Pass | Pass | `admin-review-related` crumbs |
| Admin: Related shows Lesson (Edit) and "All submissions for this lesson", which opens the workbench narrowed to that lesson with a removable filter | Pass | Pass | Pass | Pass | `admin-lesson-filter` |
| Admin: grid column headers open the lesson editor | Pass | Pass | Pass | Pass | href `/admin/lessons/:id/edit` |

Found and fixed during the pass:

- On a phone the expanded grade bar (feedback box, Redo message, grades) was taller
  than the space under the long record header and slid behind the tab bar. Sticky
  positioning can't lift the bar above its panel's top. Fixes: a shorter feedback
  box, an icon-only Feedback toggle on phones so the four grade buttons stay at
  44px or more, the module-grid link moved out of the phone context line, and the
  bar scrolls itself into view after Redo opens the feedback box.

## Not run, and limits

- WebKit and mobile Safari: not run (WebKit does not start on this machine). The
  iOS keyboard over the pinned bar is untested.
- Expo app: unit tests only (`tsc`, jest). No device or simulator here.
- Instructor with lesson editing access in the browser: covered by API and unit
  tests (`record_related_test.rb`, `recordRelated.test.ts`), not by a browser run.
- The Student context drawer and Message were visible and enabled; opening them
  was not exercised in this pass (unchanged code, covered by existing tests).
- Peek cards on names were not exercised.

## Gates

| Gate | Result |
| --- | --- |
| API full suite, `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1`, seed 11873 | 1734 runs, 0 failures, 0 errors |
| API full suite, same, seed 52417 | 1734 runs, 0 failures, 0 errors |
| RuboCop | 658 files, no offenses |
| Brakeman | 0 warnings (1 existing ignored) |
| Web lint, typecheck, vitest | pass; 198 files, 2327 tests |
| Web build, `test:bundle`, `api:check` | pass |
| Mobile typecheck, jest | pass; 135 suites, 1408 tests |

## Query counts

`QUERY_COUNT_REPORT=1`, 1 then 5 records (`endpoint_query_counts_test.rb`), compared with `origin/main`:

| Endpoint | main | this branch |
| --- | --- | --- |
| `GET /api/v1/submissions?ungraded=true` (grading inbox) | 13 → 13 | 13 → 13 |
| `GET /api/v1/submissions` (workbench, every attempt) | 13 → 13 | 13 → 13 |
| `GET /api/v1/submissions?cohort_id=` | 15 → 15 | 15 → 15 |
| `GET /api/v1/cohorts/:id/modules/:module_id/submissions` (grid) | 23 → 23 | 23 → 23 |
| `GET /api/v1/records/submission/:id/related` | 17 → 17 | 20 → 20 |

The submission Related panel costs three more queries per request (the lesson
editing access check and the lesson's submission count), the same for 1 and 5 records.

## Cleanup

The harness's two processes (Rails, Vite) were stopped and its `csg_qa_` database
dropped with `scripts/qa/run clean`. The branch test database
`csg_grading_workbench_test` was dropped after the final runs.
