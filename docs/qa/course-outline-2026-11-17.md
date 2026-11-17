# Course outline: W8 PR 8.1

Branch `feat/course-outline`, from `main` at `e0af0801`. Implementation worker, 2026-11-17. Hold for the lead: open a PR, don't merge or watch it.

## Context and acceptance

CSG Learn is the Code School of Guam learning platform. Learners in live programs, self-paced courses and the alumni library use Learn to find their next lesson. The audit (U-5.6) measured Learn on a phone. The first lesson sat at y=769 under a banner, stats, search, five filter chips and Expand/Collapse. Every row said "Exercise · 0/1 blocks", and Alex's page was 6,836px tall. The course structure also appeared in four places: Today "Your course", Materials, ModuleView and cohort home (S-9, C-2).

Leon's decision (Nov 17): build the whole student redesign now, behind a switch that is off for Cohort 3. Lance is the only active learner until Dec 19, and he must see today's experience unchanged.

Sources: `docs/design/2026-11-platform-redesign/README.md` (§§1–7) and the approved mockups `08-learn.html`, `09-lesson.html` and `07-student-today.html`. Also `LearnerProgress` (#266), `FeatureSwitches`, the QA harness and the canonical production-authored prework export already in the repo (`scripts/prework_exercises.json`).

Acceptance:

- A **New student experience** switch (`student_experience_v2`) uses the existing feature-switch system: the school default is On, cohorts can override it, admins manage it, and changes are audited. Cohorts that are running with active learners get an Off override from a data-safe migration.
- With the switch Off, Learn, a module page, the cohort page, Today and the lesson page render exactly as before. Unit tests compare the markup, and the browser pass runs Lance's shape (a running program cohort with the switch Off).
- With the switch On, Learn is one course outline for every delivery mode:
  - a sticky Continue bar;
  - collapsible weeks with "n of m", where the current week opens on its own;
  - real lesson kinds and a status icon on every row;
  - one "Show: All / To do / Needs redo" control.
- Self-paced courses show numbered lessons and sections with no weekday schedule. The alumni library has no progress counts or next step.
- Every status, count and "next" comes from `LearnerProgress`. Lesson kinds are derived on the server, in one place.
- Paused learners can read past lessons but get no next step. Personal plans decide what counts and what's next.
- One completion control per manual exercise (S-14) when the switch is On.
- Links keep `cohort_id` (L-1.10).
- Query counts stay flat.
- 390/1280, light/dark, no horizontal scroll, 44px phone targets.

## Measurements: where the first lesson lands and the page height

The harness ran 8 persona setups × 2 widths × 2 themes in each state. "Before" is the switch Off, which renders today's Materials. "After" is the switch On. Light and dark gave identical numbers. Raw numbers are in [`course-outline-2026-11-17/measurements.json`](course-outline-2026-11-17/measurements.json).

| Persona (cohort) | Width | Before: first lesson y / page height | After: first lesson y / page height | Continue bar y |
| --- | --- | --- | --- | --- |
| Program, 127 production lessons, 40 in (Alex's shape) | 390 | 933 / 6,673 | **440 / 2,852** | 72 |
| | 1280 | 691 / 6,319 | 352 / 2,112 | 32 |
| Program, personal plan (QA Program, 18 lessons) | 390 | 901 / 2,553 | 440 / 1,162 | 72 |
| Program, behind (5 of 127) | 390 | 707 / 8,589 | 440 / 2,852 | 72 |
| Program, paused | 390 | 707 / 8,904 | weeks collapsed / 872 | none (read-only) |
| Self-paced, halfway (63 of 127) | 390 | 797 / 5,025 | 546 / 2,620 | 72 |
| Self-paced, personal plan (18 lessons) | 390 | 991 / 2,139 | 440 / 1,162 | 72 |
| Self-paced, brand new | 390 | 797 / 8,994 | 440 / 3,032 | 72 |
| Alumni library | 390 | 587 / 8,784 | 316 / 2,648 | none (library) |

On a phone, the next lesson's Continue bar sits right under the app header (y=72). The first lesson row is on the first screen for every learner who has a next step. The longest page fell from 8,994px to 3,032px.

For a paused learner, the weeks start collapsed with no "This week", because they aren't on the schedule. Opening a week shows that week's lessons, read-only.

The canonical course has 127 lessons. With the switch On, Learn now names 103 exercises, 14 videos and 10 readings, where the stored `lesson_type` called almost all of them exercises.

## Scenarios

| Case | Behavior | Status |
| --- | --- | --- |
| C01 | Switch Off: `/materials`, `/modules/:id` and `/cohorts/:id` render today's components with markup identical to rendering them directly. No outline request is made. (Unit test plus the browser Off pass at 1280/390, light/dark, 8 persona setups.) | passed |
| C02 | Until the cohort's switch is known, Learn shows today's own spinner and neither view. | passed (unit) |
| C03 | Switch On: Continue opens the next lesson (`?cohort_id`). Back restores the outline. Only the current week is open. Week rows show "n of m", a redo badge and "This week" (once per course). A locked week shows "Opens Mon, Nov 23". | passed (browser + unit) |
| C04 | Show: To do / Needs redo use the server's `todo` and `redo` buckets. A redo row links to `#block-<id>`. Search looks across every week. Filter, search and the open week survive a reload. | passed |
| C05 | `/modules/:id` goes to `/materials?cohort_id&module=:id` with that module open. `/cohorts/:id` goes to Learn for that cohort. ModuleView no longer fetches the dashboard (S-9). | passed |
| C06 | Self-paced: numbered lessons, sections and "Part n · lessons a–b". No weekday, "Week n" group or "Opens" date (S-1). Continue reads "lesson 64 of 127". | passed |
| C07 | Alumni: "CSG Alumni library", no counts, no Continue, no Show control. Long sections split into undated parts. | passed |
| C08 | Paused: the notice says since when and that the work is saved. There is no next step and no To do filter. Newer content stays hidden. | passed |
| C09 | Personal plan: the milestone order decides "next". Optional lessons are marked and left out of the counts. | passed (API) |
| C10 | S-14: a manual exercise has one "Mark complete" control when the switch is On. When Off, both of today's controls and today's copy remain. | passed (unit + browser, both states) |
| C11 | L-1.10: cohort home "Go to Learn", ModuleView "Back to Learn", Today Meetings/Resources/Learn links and the update notification keep `cohort_id`. The staff preview's redo cards keep `#block`. These fixes apply in both states and don't change how anything looks. | passed (unit/API) |
| C12 | Today, switch On: one "Your course · n of m lessons done" link to Learn replaces the module list. When Off, the module list stays. | passed (unit) |
| C13 | Staff View as student, switch On, with a learner selected: the outline is read for that learner. The cohort template keeps today's Learn (see follow-ups). | passed (unit) |
| C14 | Native: with the switch On, the module screen shows the server's lesson kind. When Off, it shows the stored type exactly as before. | passed (jest); native device UI not_run |
| C15 | No horizontal scroll at 390/1280. No phone tap target under 44px. No console errors. | passed (64 page checks) |

## Automated verification

Focused local runs:

- API: 13 new tests (course outline, lesson kinds, migration, notification) plus adjacent suites, all passing on the owned local database.
- Web: 2,528+ vitest tests across the suite, plus typecheck and lint.
- Mobile: typecheck, lint (0 errors) and the new jest test.

The advisory `impeccable detect` returned `[]`. ASUS results are under [Full gate](#full-gate).

## Execution notes

- During the first On pass, the 1280 interaction case once timed out after a reload: "Loading Learn…" was still showing 5s later. It passed in two later full passes and in 8 of 8 repeats, so it is recorded as an unexplained flake, not a fix.
- In that first pass, one capture also caught every week open for an instant. "This week" was then computed per module, so two modules each had one. It is now computed once per course, and the anomaly did not recur.
- The browser pass ran on the Learn code at `e847426f`. The later commit only changed Today's v2 link to carry `cohort_id`, which unit tests cover.

## Resources

- Lifecycle session `d2b93457-45cf-4be6-b94b-17bb3d00a7fe`.
- QA harness servers: two runs (`87836`/`88831`, `62464`/`62524`, `87875`/`87899`). Each was claimed, then stopped by `scripts/qa/run clean`, which also dropped the exact owned `csg_qa_*` database, and then released.
- Playwright pages were claimed and released per test by the spec.
- The ASUS wrapper can't be claimed: its command line matches the protected `postgres` pattern. `asus-test` removes its own container.
- Owned local databases `csg_course_outline_dev` and `csg_course_outline_test` were dropped at the end.
- Shared PostgreSQL, other sessions' worktrees and the other ASUS run were left untouched.
