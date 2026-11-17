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
| Full API, both prepared-statement modes (ASUS) | See "ASUS gate" below |
| Web | typecheck, lint, `api:check`, vitest 240 files / 2,771 tests, build, `test:bundle`: pass |
| Mobile | `tsc`, lint (0 errors), jest 142 suites / 1,546 tests: pass |
| Impeccable 4.6.0 (advisory), changed UI files | No findings |

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
databases were left alone.
