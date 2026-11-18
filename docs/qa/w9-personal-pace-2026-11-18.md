# W9.1 personal start date and learner-chosen pace: QA record (2026-11-18)

Slice W9.1 (AS-1 and AS-2) of the self-paced plan Leon approved on 2026-11-18
(`csg-learn-w9-self-paced-design-2026-11-18.md`, sections 2 and 3, slices 9.3a
and 9.4a). Executed by the implementation agent on the Mac mini. Branch
`feat/w9-personal-pace`.

## What changed, in one paragraph

A guided or self-paced cohort can turn on learner-chosen pace with the new
cohort column `learner_pace_weeks` (for example `{3,4,6}`). It is NULL, and so
off, for every existing cohort. With it on, each enrollment has its own start
(a staff-set `enrollments.starts_on`, otherwise the cohort start or the
learner's first open, whichever is later). Guided cohorts open every assigned
lesson on that date. The learner picks a pace on Today, and `LearnerPace`
writes it as an ordinary `LearningPlan` with `source = learner_pace`: one soft
milestone per week, plus the final project on the last day, which is the one
firm date. `LearnerProgress#pace` measures how far behind the learner is
against those milestones.

## Switch and setting design

- No FeatureSwitches key. The gate is the cohort column, and NULL means off.
  #311 (new switch keys default Off) has been merged into this branch, and
  W9.1 adds nothing to `FeatureSwitches::DEFAULTS`.
- Pace needs the cohort's existing `learning_plans` switch, because the pace is
  a learning plan. With plans switched off, `personal_pace.available` is false
  and choosing a pace returns 422. Personal start and release still apply.
- Only guided and self-paced cohorts that aren't alumni can set the column.
  The model validates this, and the settings form only offers it for those
  cohorts.

## Off cohorts are unchanged

`api/test/integration/personal_pace_off_cohort_parity_test.rb` compares learner
and staff payloads with a golden file recorded on unmodified `origin/main`
(6c169d6d), before any W9.1 code existed. The baseline commit is the first
commit on the branch. It covers:

- a program cohort with `student_experience_v2` Off (Cohort 3's shape) and On;
- a guided cohort with pace off;
- the alumni library.

For each, it compares `GET /dashboard` (Today), `/course_outline`,
`/weekly_plan`, `/progress`, each `/modules/:id`, every `/lessons/:id`
status, `LessonReadAccess` per lesson, staff `/progress/student/:id`, and the
daily-unlock digest candidates and preview. All payloads still match byte for
byte after W9.1 and after merging main. The new keys (`personal_pace`, and
`due_on` on outline lessons) are emitted only for cohorts with pace on.

## Automated checks

| Check | Result |
|---|---|
| New API tests: `personal_pace_test.rb` (14 tests: release, late joiner, staff start, choose/change/limit, staff override, editor takeover, auth, switch off, self-paced, digests, two QueryCounter growth tests) | Pass |
| Golden parity test (above) | Pass |
| Migration test (down, insert, up twice, defaults, check constraint, pooled caches cleared) | Pass |
| Related suites locally (outline, Today, learning plans, paused read gates, guided/self-paced access, lesson read access, LearnerProgress, digests, OpenAPI contract, curriculum copy) | Pass |
| Full API suite, prepared statements on and off, RuboCop, Brakeman, web and mobile gates on ASUS (`scripts/qa/w9-personal-pace-gate.sh`) | See "ASUS gate" below |
| Web, local: typecheck, lint, vitest (249 files, 3,485 tests), build, `api:check` | Pass |
| Mobile, local: typecheck, lint (0 errors, existing warnings), jest (141 suites, 1,809 tests) | Pass |

Query counts: Today, the outline and `GET /enrollments/:id/pace` cost the same
with 13 lessons as with 31 lessons and more than 25 planned lessons.
`LearnerProgress.for_all` costs the same for one paced learner as for four.

## Browser QA

Harness: `scripts/qa/run start`, then
`bundle exec ruby ../scripts/qa/w9-personal-pace-fixtures.rb setup` from `api/`,
then from `web/`:
`QA_SPEC=w9-personal-pace.spec.ts QA_THEME=light|dark npx playwright test --config ../scripts/qa/playwright.config.ts`.
The tests use bundled Chromium at 390 and 1280 px, light and dark. Fixture: a
guided "QA Python pilot" cohort that started 3 days ago, offers paces of 3, 4
and 6 weeks, and has 12 exercises and a final project. Two new synthetic
learners (ids 901 and 902), admin persona 1 and program persona 3.

| # | Scenario | 1280 light | 1280 dark | 390 light | 390 dark |
|---|---|---|---|---|---|
| 1 | Learner in a guided pace cohort opens Today. The picker leads the page and its choices are at least 44 px tall. They pick 4 weeks and see Week 1 (0 of 3), On track, and the firm final-project date. After a reload, the server returns the same plan (4 weeks, start today, ends start+27, five milestones). Learn shows "Your pace: 4 weeks", the final-project date and each lesson's target date. No horizontal scroll. | Pass | Pass | Pass | Pass |
| 2 | Learner changes to 6 weeks. "2 more times" becomes "1 more time", and the server has 6 weeks, 1 change left, and an end date of start+41. | Pass | Pass | Pass | Pass |
| 3 | Staff open the student workspace Learning tab. They see 6 weeks, "Set by QA Rehearsal", "1 learner change left" and a note that the plan came from the learner's pace. They set 3 weeks: the status names the change, the panel shows "Set by QA Admin", the learner still has 1 change, the plan editor reloads, and the learner's Today shows 3 weeks. | Pass | Pass | Pass | Pass |
| 4 | Staff set the second learner's start one week out. The learner sees "Every lesson is open from <date>" and picks 4 weeks. The server has their start at +7, Week 1 due at +13 and the end at +34, and the first learner's start hasn't moved. Learn shows each part as "Opens <date>", and lessons are locked with "Opens" and "Due". | Pass | Pass | Pass | Pass |
| 5 | Program cohort learner (pace off). Today has no pace card. The dashboard has no `personal_pace` key, and the outline mode is `program` with no `personal_pace` and no `due_on`. Learn has no "Your pace" and shows "Week 1". | Pass | Pass | Pass | Pass |
| 6 | Cohort settings. The pilot shows "Let learners choose their pace" checked with "3, 4, 6". The program cohort has no such section. | Pass | Pass | Pass | Pass |

Screenshots for every case, width and theme are in
`docs/qa/w9-personal-pace-2026-11-18/`. Two problems found while reviewing
them were fixed and then retested:

- The current week's badge in the staff panel used the brand ruby, which reads
  as a warning. It now uses the info tone.
- An outline part captured mid-expand looked empty. The spec now waits for the
  expand to finish, and locked parts now say when they open.

Final browser pass: see "Final pass" below.

### Not covered here

- WebKit and iPhone Safari: WebKit doesn't start on the mini. The native Expo
  app and TestFlight weren't run either. The mobile app reads lesson dates
  from the dashboard payload, which now carries the personal start (an API
  test asserts this), but nobody looked at it on a device.
- Real elapsed time. "Behind" after a missed milestone is tested in the API
  with `travel_to`, not in the browser.
- The old Today (`student_experience_v2` Off) gets the personal dates through
  existing fields but has no pace card. The pilot cohort uses the new
  experience.

## Resource lifecycle

`dev-lifecycle` isn't installed on the mini, so ownership was tracked by hand.
The harness records its own Rails and Vite PIDs (with identities) and its
`csg_qa_*` database in `.qa-local/state.json`. `scripts/qa/run clean` stopped
those exact PIDs and dropped that database. Every Playwright page is closed in
`afterEach`. The account's `agent-postgres` server was already running before
this task; it is borrowed and was left running. The branch test databases
`csg_w9_pace_test` and `csg_w9_pace_dev` were dropped at the end.

## Residuals and questions for later slices

- W9.2 (deadlines and extensions): the firm date is `learning_plans.target_date`.
  An extension should move it with a reason and regenerate as a staff action.
  Learners currently get two pace changes (`LearnerPace::MAX_LEARNER_CHANGES`),
  as section 2 of the design says. Changing pace doesn't yet ask for a reason.
- W9.3 (reminders): personal-pace cohorts are left out of the daily unlock
  digest, because everything opens at once. The milestone data
  (`LearnerProgress#milestone_pace`) is ready for "due in 2 days" and "behind"
  nudges.
- W9.4 (partially async): this slice ships only the "all open at the learner's
  start" release. Per-learner drip (the cohort calendar shifted to each start)
  isn't built. Personal support and access windows (weeks from the start)
  aren't built either; guided cohorts keep their fixed dates.
- W9.5 (completion and certificate): the final project is the last required
  `project` lesson. There's no explicit flag yet.
- Choosing a pace from a phone reloads only the pace card. The next lesson
  order is unchanged because generated milestones follow course order.
- Question for Leon: should first open also anchor the start when it comes
  before the cohort start date? It currently doesn't, because the start is
  max(cohort start, first open).
