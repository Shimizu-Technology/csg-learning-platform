# Student Today and My work: W8 PR 8.2

Branch `feat/student-today`, from `main` at `5fa85024`, merged with `origin/main` at `59c4a3a8` (#291). Implementation worker, 2026-11-17. Open a PR for the lead; don't merge or watch it.

## Context and acceptance

CSG Learn's Today is where students land. The audit measured a behind student's Today at 18,552px: "Week 37 · This week" listed about 200 "Open from earlier" items, with no catch-up plan and no help-request status. The API already returned `recently_graded`, but Today never showed it. There was no page for submitted work, and support copy contradicted itself between pages.

Sources: `docs/design/2026-11-platform-redesign/README.md` (§§1–7, decisions 4, 5 and 7 in §12), mockups `07-student-today.html` and `11-my-work.html`, PR #293 (the `student_experience_v2` switch), `LearnerProgress` (#266, #272) and the learning-plan model from #285.

Backlog items: U-5.1, U-5.2, L-1.2, S-11, U-5.5, U-6.7, L-1.3, L-1.4.

Acceptance:

- Only an explicit, resolved `student_experience_v2: true` shows the new Today and My work. Off, unknown or a failed lookup keeps today's views. Cohort 3 (Lance) is Off and stays byte-identical, on web and native.
- Every status, count and "next" comes from `LearnerProgress`. My work's counts equal its lists. Students see no staff data beyond the names of the people who graded or answered them.
- Switched-off features disappear: help requests, office hours, learning plans and private meetings. Paused and alumni keep their rules.
- 390/1280, light and dark, no horizontal scroll, 44px phone targets, reduced motion respected.
- Query counts stay flat as fixtures grow.

## What changed

**Server.** The dashboard adds `student_today` only when the cohort's switch is explicitly on, so an Off cohort's payload is unchanged. It's built by `StudentToday` from `LearnerProgress`:

- `LearnerProgress#pace` gives the overdue required work: lessons scheduled before this Monday that are open and not handed in. It's measured in the course's typical week, the median number of required lessons scheduled per week, so one old straggler doesn't read as months behind. Self-paced, alumni and read-only enrollments have no pace.
- `awaiting_review_submissions` and `graded_submissions` join `redo_submissions`. `MyWork` (`GET /api/v1/my_work`) serves all three lists, and Today reuses them, so Today's "Waiting on your instructor (n)" equals My work's Waiting count.
- Needs you holds three kinds of item: redos with feedback, help answers whose notification is still unread, and the newest unread staff message per conversation. Blocked people are left out.
- "Your questions" lists help requests still waiting for a first reply.
- Next session is the first upcoming office hour or live class, past this week, with its `meeting_url`.
- Lesson submissions now carry `grader` (id and name), and the lesson payload carries `reviewer`, the cohort's support instructor or else its first instructor.
- Help-answer notifications and Today link to `/lessons/:id?cohort_id&help_request=:id` (L-1.3). The `help_request` lesson context is in the shared web/native destination contract. Other links to the lesson stay plain.

**Web.** `/dashboard` goes through `StudentExperienceSwitch`: the new `StudentTodayPage` when On, the untouched `Dashboard` otherwise. `/my-work` exists only when On; Off sends it to Today. With the switch On:

- My work joins the nav, with a phone tab: Today, Learn, My work, Messages.
- The lesson's help button reads "View response" after a reply, and the link from Today opens that request's dialog.
- Lesson blocks name who graded the work and who will review it.
- The personal plan's "waiting for review" count links to My work.

None of this renders when Off.

**Native.** No visual change. A jest test proves the native Today renders the same tree whether or not the payload carries `student_today`. Native ignores the new `help_request` param.

**Migrations.** None. The catch-up plan reuses `learning_plans` and `learning_plan_revisions`.

### Catch-up plan (Leon's decision 4)

- A plan counts as agreed when staff saved it: an active learning plan with the `learning_plans` switch on. That's the only plan a student sees. Today shows its target date, who saved it last and when (from the latest revision), and its remaining required lessons in milestone order. Five show at first, with "Show all n" in place. "Ask Audreana to change it" opens the conversation with a link to Learn.
- With no agreed plan, a behind student sees "You're about N weeks behind", the next required lesson as the one primary action, and "Ask Audreana for a catch-up plan". No unreviewed suggestion is generated or sent.
- **Follow-up:** the instructor-side "suggest a plan" generator. It would build milestones from the remaining required work and a target date, for staff to adjust in the #285 editor. It isn't in this PR.

## Measurements: page height and first actionable item, before and after

The harness ran 7 persona setups × 2 widths × 2 themes in each state. "Before" is the switch Off (today's Dashboard), "after" is On. Light and dark gave identical numbers. y is the top of the first button or link in the next-action area; the phone viewport is 390×844, with the tab bar from y≈776. Raw numbers are in [`student-today-2026-11-17/measurements.json`](student-today-2026-11-17/measurements.json).

| Persona (cohort) | Width | Before: first action y / page height | After: first action y / page height |
| --- | --- | --- | --- |
| Behind, 0 of 127, seven redos, no plan | 390 | 354 / **12,662** | 405 / **2,262** |
| | 1280 | 274 / 9,603 | 309 / 1,324 |
| Redo with feedback, help answer, message (Alex) | 390 | 354 / 8,737 | 405 / 2,342 |
| | 1280 | 274 / 6,646 | 337 / 1,436 |
| Behind with an agreed catch-up plan | 390 | 382 / 1,875 | 342 / 1,452 |
| Personal plan, work waiting for review | 390 | 326 / 1,807 | 342 / 1,640 |
| Self-paced, halfway, two waiting | 390 | 772 / 1,516 | 695 / 1,445 |
| Paused | 390 | 416 / 844 | 469 / 1,117 |
| Alumni library | 390 | 324 / 1,650 | 245 / 844 |

The first actionable item is on the first phone screen for every persona, before the tab bar. The longest Today fell from 12,662px to 2,342px. Pages got shorter because lists are capped at five and the module list and stat rows are gone.

The paused page grew by 273px because it now says what stays open and offers "View your past work". The self-paced Continue sits at y=695 because the existing Start here card comes first; W8 PR 8.4 redesigns first run.

The audit's 18,552px came from production's longer course and "Week 37" schedule. The harness's 127-lesson canonical program gives 12,662px for the same layout.

## Scenarios

| Case | Behavior | Status |
| --- | --- | --- |
| T01 | Switch Off: `/dashboard` renders `Dashboard` with markup identical to rendering it directly; a stored snapshot of Lance's shape guards it. A cohort list without the key is not "on". The API payload has no `student_today` and its keys are otherwise unchanged. Browser Off pass at 1280/390, light/dark: no `data-today="v2"` and no My work link (28/28). | passed (unit, API, browser) |
| T02 | One primary action (S-11): only Continue and Join use the primary style. The hero shows module, week, "Lesson 4 of 5" and "155 of 243 lessons". | passed (unit, browser) |
| T03 | Needs you quotes the redo feedback as Markdown with the grader and when; its link opens `#block-:id`. On the lesson, the feedback card is the first thing in the block, 153px from the top at 1280 and 200px at 390. | passed (browser journey) |
| T04 | View response links to `?help_request=:id`, marks the notification read and opens the dialog with the reply. After a reload the answer has left Needs you. The help button reads "View response". | passed (unit, browser journey) |
| T05 | An unread instructor message shows under Needs you with Reply, which opens that conversation. A message from someone the student blocked never shows. | passed (API, unit, browser) |
| T06 | Waiting on your instructor (n) links to My work's Waiting tab and names the reviewer: "QA usually reviews within 2 days". | passed (unit, browser) |
| T07 | My work: Needs you, Waiting for review and Graded tabs, with the tab in the URL. Each count equals its rows (API test, plus the browser journey on every tab). The grader is named. Ask about this feedback opens the grader's DM with "Question about: [Feedback on …](lesson#block)" in the composer, and nothing is sent. Graded shows ten at a time. Empty tabs say what counts as work. | passed (API, unit, browser) |
| T08 | Behind without a plan: "You're about N weeks behind", Continue on the next required lesson, and "Ask QA for a catch-up plan" opening the DM. No plan card or suggestion. | passed (API, unit, browser) |
| T09 | Behind with an agreed plan: "Catch-up plan · agreed with QA", the target date, who and when, five lessons, Show all 14 expanding in place, and Ask to change it. With learning plans switched off, there's no plan. | passed (API, unit, browser) |
| T10 | Next live class past this week, with Join to its `meeting_url`. Office hours off means no card. Help requests off means no questions or answers, and the instructor card offers a message instead of Ask for help. | passed (API, unit) |
| T11 | Paused: since when, work saved, what's open, how to resume, Message CSG staff, View your past work, and "Where you left off" (read only). No pace, Join or Continue. | passed (API, unit, browser) |
| T12 | Alumni: the library card and recently added. No progress, next step, Needs you or instructor card. Self-paced: no pace or weeks. | passed (API, unit, browser) |
| T13 | U-5.5: one support message, built from the same rules lessons use. "Asking an instructor for help isn't available" no longer appears on Today when On. | passed (unit) |
| T14 | Long lists show five rows plus Show all n. Show all n expands in place: the 200ms accordion, instant under reduced motion. | passed (unit, browser) |
| T15 | No horizontal scroll at 390/1280. No phone tap target under 44px. No console errors. | passed (56 page checks) |
| T16 | Native Today renders the same tree with or without `student_today` in the payload. | passed (jest); device UI not_run |

## Automated verification

Focused local runs, before the full gate:

- API: `student_today_test.rb` (11 tests) plus the adjacent suites (lessons, query counts, destinations, notifications, OpenAPI contract, help requests): 152 runs, 0 failures. A full local API run passed except three `MigrationDatabaseProcessTest` cases that need the ASUS port adapter. One push-destination expectation was updated for the new `help_request` param.
- Query counts: `GET /dashboard` with `student_today` and `GET /my_work` cost the same queries for 3 submissions or 15, and for 1 help answer and message or 5. The test checks the fixture really grew.
- Web: typecheck, lint, and vitest for `Today.test.tsx` (10), `MyWork.test.tsx` (7) and `shellNavigation.test.ts`, plus the student and shared component suites.
- Mobile: typecheck, the destination-contract suites, and `assigned-content-screens.test.tsx` (17).
- RuboCop and Brakeman are clean on the changed files. Impeccable 4.6.0 advisory: `[]`.
- Each fix has a test that fails on the old code: the routes, page, `student_today` and `my_work` didn't exist, the help button had no "View response", lesson blocks had no names, and the destination contract had no `help_request` row.

### Full gate

The ASUS runner was unreachable (the MacBook was on a phone hotspot, and `asus-test` timed out, which also cut off an earlier run). So the full gate ran **locally on the MacBook**, one stage at a time, on `5ae11cbc`. That commit is this branch merged with `origin/main` at `59c4a3a8`, and `main` hadn't moved when the PR was opened.

- API, `PARALLEL_WORKERS=1 OPENAPI_COVERAGE=1`, against the owned local database `csg_student_today_test` (schema freshly loaded): with prepared statements on (`postgres://localhost/csg_student_today_test`) and off (`?prepared_statements=false`), **2,067 runs and 42,240 assertions** each, with 0 failures, errors or skips. The migration-process tests ran against the local server (`MIGRATION_PROCESS_TEST_DATABASE_URL=postgresql://<user>@localhost/postgres`).
  - A first prepared run with that URL missing its user failed those 2 tests: the production guard requires a user in the URL. With the user added, the file and then the full suite passed.
- RuboCop: 734 files, no offenses. Brakeman: no warnings.
- Web: typecheck, lint, vitest (229 files, 2,582 tests), build, `test:bundle` and `api:check` passed.
- Mobile: typecheck, lint (0 errors; the same 74 warnings as `main`) and jest (141 suites, 1,544 tests) passed.

An earlier ASUS run on `e4fe4507`, before the guard fixes, passed every stage except web vitest. Four repo-wide guards failed there:

- a retired name ("Instructor support");
- sentence case in "Could not load My work";
- no page title for `/my-work`;
- a cohort name not rendered as a record link.

They're fixed in `5ae11cbc`, and the local gate above covers that commit.

## Not run

- Native device UI and native visual parity (follow-up).
- Safari/WebKit and real phones; Chromium sizes the phone viewport.
- Real Clerk, push delivery and production data.

## Follow-ups

- Suggest a catch-up plan: generate milestones from the remaining required work and a target date, for staff to adjust (decision 4). Students keep seeing only the agreed plan.
- Staff "View as student" still previews today's Dashboard for Today; it doesn't build `student_today` for a previewed learner.
- Native Today and My work in the redesign (W10), reading `student_today` and `/my_work`, and opening `help_request` on the lesson.
- Cohort home lists sessions without Join (`StudentCohortHome`). When On, cohort home redirects to Learn and Today has the Join card, so that page only exists for Off cohorts and stays unchanged for Lance.
- The weekly-plan projection still lists only this week's events. Today no longer reads it when On.
- The self-paced Start here card sits above Today's hero (W8 PR 8.4).

## Resources

- Lifecycle session `2a22c646-2f4f-4bc8-acaa-b14cad908eea`.
- Three harness runs: servers `93920`/`93952`, `84921`/`85052` and `3626`/`3696` (the last on the merged head). Each was claimed, then stopped and its database dropped with `scripts/qa/run clean`. Playwright pages were claimed and released per test by the spec.
- The owned local test database `csg_student_today_test` was dropped at the end.
- The ASUS wrapper removes its own container; its retry loop was stopped once the ASUS was known to be unreachable. Shared PostgreSQL and other sessions' worktrees were left untouched.
