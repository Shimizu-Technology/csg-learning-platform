# Staff home, scheduled updates and record pages (W6.4 + L-5.1), 2026-11-18

Agent-executed affected-flow QA. Branch `feat/staff-home-scheduled-updates` from main `90f075e3`.
Browser runs used application source `1b3f1589` on the local harness (database `csg_qa_30696_1794932708`,
Rails test env, Vite, Chromium). Synthetic fixtures only.

## Context

CSG Learn is the Code School of Guam learning hub. Staff post updates to a cohort, the school or
staff. #279 added drafts, edit after posting and one composer, and left scheduling planned. #291
added the hourly `scheduled:tick` (Render cron, advisory lock, per-task checkpoints). This work adds
scheduling on that tick, and finishes the backlog items listed below.

## Backlog status

| Item | Status | Where |
| --- | --- | --- |
| T-6 card destinations | Already done in #280 (Instructor Today). "Active enrollments checked" is gone; each summary chip opens the inbox filtered to its kind; "Access & invitations" opens `/admin/students?filter=never-signed-in` (cohort-scoped). Verified in the browser (case B1). | `AdminDashboard.tsx` |
| U-3.4 duplicate enrollment cards | Already done in #280: the two cards were replaced by distinct chips. Verified (B1). | same |
| U-3.5 School activity twice | Fixed here: the feed no longer repeats the page's "School activity" heading. A cohort tab keeps "Cohort activity". | `StaffActivityFeed.tsx` |
| U-3.6 scheduling | Built here. | API, web, mobile |
| L-5.1 submission page | Mostly done in #287/#290 (identity header, lesson and module grading rows, Back). Added: cohort link in the header line (the breadcrumb hides on phones), a Module row to the module page, and the Rubric row now opens the rubric page (`rubric_id` added to the related item). | `SubmissionDetail.tsx`, `recordRelated.ts`, `record_related.rb` |
| L-5.1 announcement page | Cohort link and rendered Markdown already existed (#279). Added: staff read count (`read_summary`). | `Announcements.tsx`, announcements controller |
| L-5.1 help request and follow-up pages | Already done in #282; recorded in `docs/qa/help-followup-pages-2026-11-17.md`. Not re-run here; nothing on those pages changed. | — |

## Scheduling design

- A scheduled update is a **draft with `scheduled_for`**. Every reader path already hides drafts
  (`visible_now` is published-only; `drafts_visible_to` limits drafts to their author and admins),
  so students never see one in the feed, its page, Today, cohort home, search, notifications or push,
  on web or mobile, before it posts. Announcements send no email.
- Times are chosen as a day and an hour in the school's zone (`Pacific/Guam` by default; cohorts have
  no zone of their own). The composer says "Sends about 9:00 AM ChST… Scheduled updates go out with
  the hourly run, not to the minute."
- The tick's new `scheduled_updates` task runs once per UTC hour. For each due update it locks the
  row, re-checks that it is still a scheduled draft that is due, checks that `scheduled_by` can still
  post to the audience, then posts it through the same fan-out as "Post update". Push is enqueued after
  commit. A refused scheduler returns the update to an unscheduled draft. A failure rolls back, stays
  scheduled and fails the task, so the next hour retries.
- Migration `20261118040000` (unique, later than main's `20261118030000`): nullable `scheduled_for`,
  `scheduled_by_id` (FK `NOT VALID` then validated, `on_delete: nullify`), `scheduled_send_push`
  (default false), and a partial index for the tick. Each step runs in its own transaction with
  `SET LOCAL lock_timeout`. Its test clears every pool's statement cache.

## Browser scenarios

`scripts/qa/staff-home-scheduled-updates.spec.ts` with `staff-home-scheduled-updates-fixtures.rb`.
Each case ran at 1280 and 390, light and dark: **20 of 20 passed**. Every recorded screen had no
sideways scroll, no serious axe violations and no contrast violations. Screenshots and JSONL are in
ignored `.qa-local/staff-home-scheduled/`.

| Case | Steps and expected outcome | Result |
| --- | --- | --- |
| B1 Staff home (instructor) | Summary chips have distinct labels (Help requests, Waiting for review, Unread conversations) and each opens `/admin?…kind=…`. No "enrollments checked" text. "Access & invitations" → `/admin/students?filter=never-signed-in&cohort_id=1`, which shows the filter; browser Back returns to Today. "Open cohort" → `/admin/cohorts/1`. | Passed ×4 |
| B2 School activity (admin) | One "School activity" heading. | Passed ×4 |
| B3 Schedule → reschedule → cancel → schedule again | Instructor fills the composer and picks Schedule. Day defaults to tomorrow, 9:00 AM; Save draft hides. Sends-about text shows. Schedule update → audience confirmation → Manage › Scheduled lists it with the badge and "Sends about". On its page: Edit or reschedule → 10:00 → Save schedule (notice shows 10:00). Cancel schedule → Draft, notice gone. Edit draft → Schedule (tomorrow 9:00 prefilled) → Schedule update. | Passed ×4 |
| B4 Hidden before posting | Student 3: the Updates feed, `/announcements/:id` ("Update not found"), Today and Notifications don't show the title. | Passed ×4 |
| B5 Forced tick posts once | Fixture `due` moves the time a minute back, then `tick` runs the real `ScheduledTick` three times: run → `claimed 1, sent 1`; same hour → `skipped`; checkpoint reset → `run, claimed 0, sent 0`. Update `published`, 2 notifications (both active learners), 1 push job. The student then sees it in the feed and opens it, with no read count. | Passed ×4 |
| B6 Update page | Instructor opens the pinned "QA read count update" from Manage: "N of 2 people it went to have read it"; Markdown renders (bold, two list items, a code block; no literal `**`); cohort link → `/admin/cohorts/1?tab=communication`; "Back to Updates" returns to the filtered Manage list. As the student: rendered Markdown, no read count. | Passed ×4 |
| B7 Submission page | From a Grading return path: header has the cohort link (in view at 390), the student link and the lesson title; Back reads "Back to Grading · All submissions". Lesson, Module and Rubric rows link to their pages. Rubric page → "Back to Submission #1" → submission; Module page → same; then Back → `/admin/grading?cohort_id=1&filter=all`. From the student's Work tab, Back returns to that tab. | Passed ×4 |

### Failures found and retested

1. **Schedule didn't suggest a day** (application bug). Choosing Schedule should prefill tomorrow at
   9:00 AM. The suggestion used the wrong field names, so the Day field stayed empty. B3 caught it
   when reopening a cancelled schedule. Fixed in `8804d535`. The unit test now checks the suggested
   day, which fails on the old code. B3 then passed ×4.
2. Spec and fixture issues, not application bugs: the forced tick met the hourly checkpoint left by
   an earlier combination (by design; the fixture now starts from a fresh slot). Breadcrumb list items
   were counted as Markdown items. The seeded student is named "QA Program", like the cohort. The read
   update fell to page 2 as runs posted more updates (it is now pinned). The Back label carries the
   queue's filter. All were retested in the final full run.

## Automated checks

| Check | Result |
| --- | --- |
| Focused API (local, prepared statements on) | `scheduled_updates_test` 14, `scheduled_update_races_test` 3 (two connections: a second publisher and a cancel each wait on the row lock and then post nothing, or get 422), migration test, `update_drafts`/`updates`/`update_races`/`scheduled_tick`/`user_hard_delete`/`record_related`/`record_detail_query_counts`: all passing |
| Query counts | Tick posting to 1 or 10 recipients: same count. Manage › Scheduled with 1 or 5: same count (author and admin). Update page read count with 1 or 10 recipients: same count. |
| Full API, both prepared-statement modes (ASUS) | Passed on `2c19b5d1` (see "ASUS gate" below) |
| Web (on merged `2c19b5d1`) | typecheck, lint, `api:check`, vitest 242 files / 2,776 tests, build, `test:bundle`: pass |
| Mobile (on merged `2c19b5d1`) | `tsc`, lint (0 errors), jest 142 suites / 1,546 tests: pass |
| Impeccable 4.6.0 (advisory), changed UI files | No findings |

## Fix round 2 (re-check P1, the access-expiry regression, CodeRabbit)

- **The 404 was too broad.** On `af861072`, `CourseExpirationTest` failed in both CI API jobs and on
  ASUS: learners with expired, dropped or paused-past-expiry access got 404 instead of the course-access
  403 the clients show as "access ended". The uniform 404 now covers only staff acting on drafts and
  scheduled updates they can't act on. Posted updates and every learner read are as on main, and
  `CourseExpirationTest` is unchanged (`50845257`).
- **Settlement race** (re-check P1): see Fix round 1 above (`50845257`).
- **CodeRabbit** (`6b72925a`):
  - A replayed scheduled create is reconciled when the push choice changed.
  - Plain-draft saves send `scheduled_for: null`, which cancels a replayed schedule.
  - Only `null` or `""` cancels a schedule; other non-time values return 422.
  - The update page's notice is keyed to its update.
  - The QA fixture counts only the target update's push jobs and uses one `now` for the three ticks.
  - Mobile staff fetch read counts on tap and long-press for posted updates that aren't unread for
    them.

  Each new web and mobile test failed on the previous code before the fix.
- Merged main `4ff3ad8c` (#301 picomatch audit exception).

Retest at `6b72925a`:

- Focused API (15 files, including `CourseExpirationTest`), prepared statements on and off: 179 runs /
  1,486 assertions each, 0 failures.
- Full local API run (prepared on): 2,219 runs, 0 failures. Its 3 errors are local-environment
  `MigrationDatabaseProcessTest` cases that need ASUS's `postgres` role and port adapter.
- Web: 242 files / 2,779 tests, typecheck, lint, `api:check`, build, `test:bundle`;
  `api:generate` gives no diff.
- Mobile: 142 suites / 1,548 tests, typecheck, lint (0 errors).
- **ASUS full gate on `6b72925a`:** prepared statements on (seed 24633) and off (seed 48561), 2,219
  runs / 43,214 assertions each, 0 failures/errors/skips. RuboCop: 767 files, no offenses. Brakeman:
  0 warnings (1 existing ignored). The port adapter was kept and `OPENAPI_COVERAGE=1` set. The
  `af861072` run had stopped on the `CourseExpirationTest` regression and then lost its connection;
  it was superseded by this run.

## ASUS gate (first round)

`asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/scheduled-jobs-gate.sh` on head
`2c19b5d1` (this branch merged with main `096cc89a`, #298). `OPENAPI_COVERAGE=1` and `PARALLEL_WORKERS=1`
were set, the 55432 migration-process port adapter was kept, and nothing was excluded.

| Stage | Result |
| --- | --- |
| Prepared statements enabled (asserted), seed 60296 | 2,204 runs / 43,032 assertions, 0 failures/errors/skips |
| Prepared statements disabled (asserted), seed 33438 | 2,204 runs / 43,032 assertions, 0 failures/errors/skips |
| RuboCop | 765 files, no offenses |
| Brakeman | 0 security warnings (1 existing ignored) |

The first gate, on `d6f27bf0`, failed one test in both modes: the OpenAPI contract rule rejected
`read_summary`'s description because it used conditional wording ("only … for staff"). The key stays
required and nullable, as #279's contract expects; the description was reworded in `777c9ecf`. That
run's other 2,203 tests passed in both modes. The gate was rerun once after the fix and the merge with main.

## Fix round 1 (independent review of `2c19b5d1`)

The review confirmed student invisibility (Today On and Off, counts included), the lock and
transaction design, atomic notifications with push after commit, the additive migration and the
record pages. It reported one P1, two P2s and one P3, each reproduced with a test. Its adversarial
tests are adapted into `scheduled_update_races_test.rb` and `scheduled_updates_test.rb`.

| Finding | Fix | Evidence |
| --- | --- | --- |
| P1: a crash after the post commits loses the push | Push outbox (migration `20261118050000`). Posting with push sets `push_requested_at` in the posting UPDATE. `PushNotificationJob` claims each recipient per provider under the update's row lock, as messages do, then sets `push_settled_at`. The tick re-requests a push still unsettled after 5 minutes (one older than 24 hours is settled without sending). The fix covers request posts and scheduled posts, which shared the gap. Announcements send no email. | Forked child dies at the after-commit enqueue; a rerun inside the grace period sends nothing; after it, one re-request pushes each recipient once per provider; later runs send nothing. A request post whose job never ran is re-requested once by the tick. Two jobs at once push each recipient once per provider. After Expo reports "not started" for one recipient, the retry pushes only that one, with no repeated web push. |
| P2: the 100-update cap leaves due updates behind the checkpoint | Drains in batches until a batch comes back short, within a 5-minute budget. Running out fails the task without advancing the checkpoint, so the next run continues, even in the same hour. A failing update is skipped for the rest of the run. | 101 due → one tick posts all 101. Batch 2 with no budget: 5 due drain over three runs in the same hour, the first two failing the task. One failing update doesn't loop. |
| P2: non-uniform denials | For staff, show, edit, post, reschedule, cancel and delete on a draft or scheduled update in a cohort they can't act on (`StaffCohortScope`, now also given the assignments reloaded under the lock), or that isn't theirs, return the missing-id 404. That includes an assignment removed mid-request. Posted and archived updates and every learner read keep main's 403. A first version also turned those into 404, which broke the course-access contract (`CourseExpirationTest`); it was narrowed to drafts and scheduled updates. | Colleague, outsider and removed author on a scheduled update and a plain draft: every action's status and body match a missing id. Posted updates still return 403. `CourseExpirationTest` is unchanged and passing. |
| P3: the instructor's query-count fixture stayed empty | Grows the instructor's own drafts and scheduled updates and asserts each response's size at 1 and 5, for the instructor and the admin, on both lists. | Passing |

**Re-check P1 (settlement race).** If job A held web claims mid-send while job B claimed Expo and
settled, and A's provider then reported "not started", A released its web claims, but the push stayed
settled and was never recovered. Releasing a claim now clears `push_settled_at` under the same row lock.
The re-check's race test is adapted, plus a test of a release after settlement with no other job
running. Both fail on the previous code and pass now. The re-request then sends web to the released
recipients once, and Expo to nobody again.

The composer now says "Times are in Guam time, the school's time zone, for every cohort." Cohorts
have no time zone field.

Retest at `af861072`:

- Focused API, prepared statements on and off: 130 runs / 1,172 assertions each, 0 failures. Both
  migration tests also pass.
- Web gate: 242 files / 2,776 tests, typecheck, lint, `api:check`, build, `test:bundle`. On the first
  run, one unrelated `ContentManagement` focus test failed while Playwright was loading the machine. It
  passed 3× alone, and the full gate then passed.
- Browser recheck: B3–B5 (schedule → reschedule → cancel → schedule again, hidden from the student,
  forced tick posts once, `push_requeued 0`) passed 4/4 at 1280/390 light/dark on a fresh harness,
  which was then cleaned.
- API responses are unchanged, so the generated types have no diff and mobile needed no re-run.

## Not run

- Native devices or simulators, real Expo or Web Push delivery, and the real Render cron. The tick
  was run in-process against the harness database with push on the test adapter.
- WebKit and mobile Safari; screen readers.
- Student redesign switch: no student-facing output changes. `scheduled_for` and `read_summary` are
  null on everything a student can see, so On and Off cohorts (Lance's Cohort 3 is Off) are unchanged.
  This rests on the API tests, not a separate Off-cohort browser pass.

## Cleanup

The harness servers (PIDs 30913, 30985) and their database were claimed under lifecycle session
`18fefdff-f751-4de3-98c5-0d32cab88632` and stopped with `scripts/qa/run clean`. The scratch schema
database `csg_shsu_schema_20261118` was dropped. Borrowed local Postgres and other sessions' QA
databases were left alone. The ASUS wrapper can't be claimed (the lifecycle helper protects
commands containing `postgres`); each run was tracked by PID, exited on its own, and the helper
removed its container and database. No `asus-test` process of this task is left running.
