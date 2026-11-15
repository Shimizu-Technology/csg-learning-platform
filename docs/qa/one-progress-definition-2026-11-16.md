# One definition of complete and next (AS-10), 2026-11-16

W9 PR 9.2. Branched from `origin/main` at `ebef5d3c`, then merged `main` at `3b1f8c65` (#258, #261, #262). The comparison and UI check ran before that merge; the gates below ran after it. All data is synthetic.

## The definition (`api/app/services/learner_progress.rb`)

| Thing | Rule |
|---|---|
| Reviewed step (`gradable_work_block?`) | Follows its latest submission: Redo → `redo_requested`; no grade → `submitted`; any other grade → `complete`. |
| Any other step | Follows its progress row: manual "Mark complete", a correct knowledge check, or the watch credit a video needs (`WatchCredit`). |
| Switched-off knowledge checks / GitHub sync | Fall back to the manual or text path, so completion is never blocked (#240). |
| Lesson steps | `Lesson#completion_blocks` (unchanged). |
| Handed in | `submitted` or `complete`. Counts toward progress (`completed_blocks`, `overall_progress`), as before. |
| Lesson `completed` field | Every step handed in. A redo is never handed in. |
| Lesson status | Shared learner vocabulary, same precedence as `fixtures/shared-logic-parity.json` `statuses` (tested in Ruby against that fixture): `redo`, `awaiting_review` ("Submitted · waiting for review"), `done`, `upcoming`, `closed`, `in_progress`, `open`. |
| Available | `LessonReadAccess.readable?`, the rule behind `GET /lessons/:id`. Paused learners see only what they could read before pausing. |
| Counted lessons | Required lessons when a personal plan is on, every assigned lesson otherwise (unchanged). |
| Next step | First required lesson whose status is `redo`, `in_progress` or `open`, in personal-plan milestone order (when the `learning_plans` switch is on), then course order. |

Consumers now reading it: `DashboardController` (Today), `WeeklyPlanProjection`, `LearningPlanProjection`, `LessonsController#lesson_json`, and the staff learner view (`ProgressController#student`, which "View as student" rebuilds Today from).

## Payloads

Field names and shapes are unchanged. Additive fields:

- `learner_status` on dashboard `modules[].lessons[]`, weekly-plan lesson items, personal-plan lessons, and `GET /lessons/:id` (students).
- `next_step` (`{id, title, module_id}` or null) on `GET /lessons/:id` (students): the same lesson as `continue_lesson` and the plans' `next_lesson`. `prev_lesson`/`next_lesson` stay outline navigation.

`LessonDetail`, `LearnerLessonStatus` and `LearnerNextStep` are documented in `docs/openapi.json` and the generated types are refreshed. Dashboard and weekly-plan schemas are not on `main` yet (#260 adds them), so whichever of #260 and this PR lands second must add `learner_status` there.

## Comparison: old vs new on synthetic learners

`scripts/qa/progress-comparison/` (seed, dump, compare) ran against one local `csg_qa_` database, once from a detached `origin/main` worktree and once from this branch. Views are read the way their clients read them. The new server had no disagreements in any of the 15 states (the compare script fails otherwise).

| Learner state | Where the old answers disagreed | New single answer |
|---|---|---|
| fresh | None | Next: Lab l1 counter |
| redo, stale completed flag (imported history) | Today and the staff view counted Lab l1 complete while it read Redo; the weekly plan left it out; Today's next skipped it (Lab l2) | Next: Lab l1 (redo) |
| redo, regraded | Lab l2 reading: Today and lesson page "in progress", weekly plan "to do" | Next: Lab l1; Lab l2 in progress everywhere |
| redo resubmitted | None | Next: Lab l2 |
| pending grades | Lab l2 reading: same weekly-plan split | Next: Lab l2; in progress everywhere |
| one of two steps done | Lab l2 and l3: same weekly-plan split | Next: Lab l2; both in progress everywhere |
| all open work done | None | Next: none |
| personal plan with a redo | Today and the staff view counted the redo complete | Next: Lab l4 (milestone order); Lab l1 redo |
| plan covering one lesson | None | Next: Lab l7 (milestone first) |
| self-paced with a redo | Today and the staff view counted the redo complete; Today and the weekly plan's next skipped it | Next: Lab l1 (redo) |
| closed submission week | The mobile lesson page said "to do" for five closed lessons; Today's next pointed at a closed lesson (Lab l2) | Next: Lab l7 (week 2); the five lessons read "closed" everywhere |
| knowledge checks and GitHub sync off | Lab l2: weekly-plan split | Next: Lab l2; manual check and text fallback both count |
| lesson-only assignment | None | Next: Lab l2 |
| paused | Same as the stale-flag redo | Next: Lab l1 (redo) |
| alumni library | None | Next: Lab l1 |

### Every payload value that changed

44 values across 5 learners; the other 10 had none.

- **Redo with a stale completed flag** (guided, self-paced, paused, personal plan): the lesson's `completed` true → false and `completed_blocks` 1 → 0 on Today and the staff view; module `completed_blocks` and `overall_progress.completed`/`percentage` drop by that step (for example 1 → 0, 9.1% → 0.0%).
- `continue_lesson`: moves to the redo lesson (Lab l2 → Lab l1) for the stale-flag, self-paced and paused learners; self-paced `course_overview.next_lesson` the same.
- Weekly plan: the stale-flag redo is now carried forward, so `summary.required_count` +1 (6 → 7; paused 4 → 5); with a plan, `summary.required_completed_count` 1 → 0.
- Closed week: `continue_lesson` moves from a closed lesson (Lab l2) to the first open one (Lab l7).
- One existing test encoded the old inconsistency (`weekly_plan_projection_test`: a redo with a stale flag gave "no next lesson" while the same plan listed it as a redo). It now expects the redo as next until resubmitted.

## Tests added

- `test/services/learner_progress_test.rb`: fixture parity, a 17-row matrix of step types × evidence, switches off, upcoming and closed, next-step ordering, personal plan on/off, self-paced, paused, lesson-only.
- `test/integration/learner_progress_consumers_test.rb`: Today, weekly plan, personal plan, every lesson page and the staff view agree on status and next (guided, personal plan, self-paced); "nothing to act on"; the status enum matches OpenAPI and the fixture; query counts flat from one to five lessons of each state for all four endpoints in three modes.
- Web and mobile: server status preferred, local fallback for older payloads; Today trusts a null `continue_lesson` once lessons carry `learner_status`.

Query counts (existing `endpoint_query_counts_test`, 1 → 5 records): student dashboard 26 → 24 on this branch; student lesson page 22 → 27 (it now builds the learner's progress); both stay flat.

## Gates (Mac mini, after merging `main`)

- API: 1,521 runs, 38,010 assertions, 0 failures, 0 skips, with `OPENAPI_COVERAGE=1` (full inventory passed); RuboCop clean (621 files); Brakeman 0 warnings; `zeitwerk:check` ok.
- Web: `api:check`, typecheck, lint, 2,123 tests, build, landing bundle budget. With default workers, 15 to 29 tests in messaging, support-queue and brand files timed out while the machine's load average was about 35 from other work; they pass alone and the whole suite passes with `--maxWorkers=3`.
- Mobile: typecheck, lint (0 errors, 33 warnings; the ones in touched files are on unchanged lines), 1,173 tests. No iOS export run.

## Real UI check

`scripts/qa/run` harness, program persona (id 3), Chromium at 1280 and 390. Setup added one lesson-only unlock date a week out (QA Lab 1.3.2) and finished the non-reviewed steps of QA Lab 1.3.1 so its ungraded submission leaves it waiting for review.

| Lesson | Server | Learn | Lesson page |
|---|---|---|---|
| QA Lab 1.2.1 (Redo) | redo | "Redo" | "Redo requested" |
| QA Lab 1.3.1 (ungraded) | awaiting_review | "Waiting for review" | "Submitted · waiting for review" |
| QA Lab 1.3.2 (locked) | upcoming | "unlocks Nov 22", not a link | refused ("No access") |
| QA Lab 1.1.1 (next step) | in_progress | "In progress" | "In progress", and other lesson pages show "Up next: QA Lab 1.1.1" |

Both widths gave identical results. Today shows the redo as its hero and the personal plan lists QA Lab 1.1.1 as "Required · In progress"; Learn's filter counts were Redo 1, In review 1, Done 0, Locked 1. Page errors appeared only on lesson pages, from the Monaco editor loader on cdn.jsdelivr.net, which the spec blocks with all non-local traffic. Not checked: Expo/native, Safari, dark mode. The harness was cleaned (servers stopped, database dropped).

## For Leon to confirm

1. **Closed weeks are skipped as the next step.** Before, Today could point at a lesson whose submissions had closed (the weekly plan already said "closed"). Now the next step skips it. A video-only lesson in a closed week is skipped too, even though watching it would still complete it.
2. **Web Today puts a redo first; the server's next step doesn't.** The web hero shows the newest redo, while `continue_lesson` (and mobile's "Next best action") follow plan/course order, so the two can name different lessons. Ranking redos first on the server would change the plan's "Next required task" too.
3. **Paused learners still get a next step** (the lesson they could read), as before, though they can't submit.
4. **Redo on a step that isn't reviewed work** (only imported history has one): still listed in Today's and the weekly plan's redos, but it doesn't hold the lesson open, matching `review_status`.
5. **Mobile lesson-page percentage** counts only reviewed work, while Today, Learn and the plans count submitted work as progress (the decision above). The header status now comes from the server; the percentage bar is unchanged.
6. **Locked lesson page copy**: a released-later lesson refuses with the generic "No access" page (existing behaviour, not changed here).

## Follow-ups not in this PR

- Staff aggregates (`AttentionProjection`, `LearningInsightsProjection`, `CohortHomeProjection`) still count completed progress rows directly; the stale-flag redo case could differ there.
- Learn's filter tabs still classify from `completed`/`review_status` rather than `learner_status`.
- Mobile lesson screen has no "Up next" link yet.
