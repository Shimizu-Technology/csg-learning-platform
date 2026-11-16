# Make a copy for this cohort (part 2b) — November 16, 2026

W5 PR 5.3 part 2b: "Make a copy for this cohort", decision 1 in `docs/design/2026-11-platform-redesign/README.md` §12 (confirmed by Leon 2026-11-15). An instructor with editing access for a cohort whose curriculum other cohorts share makes a copy for that cohort before editing. The copy keeps the cohort's progress, submissions and release dates; later changes to the shared version don't reach it. Admins can make the copy too, and can still edit the shared version. Base: main `9bb714b` (#273). Branch `feat/copy-before-edit`. Synthetic data only.

## What changed

**API**

- `CurriculumCopyForCohort` copies the curriculum (modules, lessons including archived ones, blocks, knowledge checks with their options, learning objectives, rubrics and criteria, objective alignments, ready course files, package revision/digest/snapshot) and moves the cohort to it. New ids come from each table's sequence in ascending old-id order, so lessons that share a position sort the same way. Links inside copied blocks to other lessons and modules of the curriculum point at the copy.
- The cohort's learner data is updated in place, so submission, help request, follow-up and progress ids never change. Learner rows include the cohort's enrollments in any status, and rows without an enrollment (older data) for learners who have no other cohort on the shared curriculum.
- Old ids keep working: each copied module, lesson, block and knowledge check gets a `content_redirects` row for the cohort. `MovedContent` applies a redirect only when the viewer can't reach the original (a learner none of whose cohorts use it, or a request naming the copied cohort). It costs one query when nothing was copied, so the record-peek query budgets (#247) still hold.
- One transaction, in the lock order in "Fix round 1" below (cohort and enrollments `FOR NO KEY UPDATE`, the shared modules, lessons and blocks `FOR SHARE`), with `SET LOCAL lock_timeout = 5s` and `statement_timeout = 30s`. Before commit, `LearnerProgress` (#266) runs for every learner of the cohort before and after (every lesson's status, review status, availability, requirement, counts and submission window; every module; overall counts; next step; redo list), plus each exercise's effective submission type and GitHub repository, watch credit totals and checkpoint answer counts on the cohort's curriculum. Any difference rolls everything back (`verification_failed`). Last, `enrollments.content_moved_at` is stamped.
- A learning write that began before the copy committed is refused with `409 content_moved` ("Reload, then save again"), through the enrollment guard restarts already use, or through the block re-check when it waited on the block lock. Help requests and lesson message sources wait on the cohort row and resolve to the copy. `module_access` re-checks the module's curriculum after its cohort lock.
- Endpoints: `GET`/`POST /api/v1/cohorts/:cohort_id/curriculum_copy` (dry run with per-table counts and blockers; copy). A retry after success returns the same copy (`200`, `already_copied`); a failure leaves nothing behind. A cohort copies a given curriculum once (unique index).
- `LessonEditAccess` JSON adds `copy_cohorts` and `copy_of`. The shared-curriculum refusal message now says to make a copy. `GET /lessons/:id` adds `moved_from` (old lesson id and old → new block ids) when it served the copy for an old id.
- Audit: `curriculum_copied` activity event (content category, actor = subject = the staff member) and a `curriculum_copies` row with who, when, source, copy and the counts. Grants live on the cohort's assignment rows, so the instructor's access now covers the cohort's own copy (`reason: granted`).
- Migration: `curriculum_copies`, `content_redirects`, `enrollments.content_moved_at`, and `curriculum_resources.s3_key` changed from a unique to a plain index (built concurrently, invalid builds rebuilt on rerun). Migration test covers up, rerun and down.

**Every table that references content** (`CurriculumCopyForCohort::TABLES`; a test checks the list against the database's foreign keys):

| Table | Decision |
|---|---|
| curricula, modules, lessons, content_blocks, knowledge_checks, learning_objectives, rubrics, rubric_criteria, objective_alignments, curriculum_resources | Copied |
| cohorts (`curriculum_id`, `content_defaults` and `settings.module_github_config` module keys), cohort_module_schedules, cohort_module_submission_windows | Remapped for the cohort |
| module_assignments, lesson_assignments, progresses (watch position and credit included), submissions, submission_criterion_results, knowledge_check_attempts | Remapped for the cohort's learners |
| learning_plans (milestone lessons, lesson exceptions), learning_plan_revisions | Remapped, so history matches the plan |
| help_requests (lesson and exercise context, `context_path`) | Remapped for the cohort |
| messages with a lesson source (#244/#253) | Remapped in the cohort's channels and DMs; elsewhere resolved when read |
| notifications (`/lessons/…#block-…` paths) | Rewritten for the cohort's learners unless the path names another cohort, or the learner also has a cohort on the shared curriculum |
| activity_events (`ContentBlock` records) | Remapped for the cohort |
| github_check_runs | Kept: keyed by submission, whose id doesn't change |
| watch_progresses | Kept: class recordings belong to the cohort, not the curriculum |
| interventions (`evidence_snapshot`), enrollment_restarts (`snapshot`) | Kept: dated records, never restored; their links still resolve |

**Blocked** (dry run lists the reason, copy refuses): rows without an enrollment that could belong to either cohort (`unassigned_learner_work`), an archived shared curriculum, a cohort that already copied this curriculum and was moved back, and media that kept changing (3 attempts).

**Media: share, don't copy.** Hosted lesson videos are referenced by key; `S3ObjectCleanup` deletes an object only once no block references it (as #273's Duplicate does). Published course ZIPs are never deleted (abandon refuses ready files; a curriculum with files can't be destroyed), so the copy's row names the same object. Copying objects would double storage and leave orphans after a rollback. Pending uploads aren't copied. The course package key stays with the shared curriculum, so a re-import updates only that.

**Web**: the read-only notice in the lesson editor and Content offer "Make a copy for Cohort 3" (admins get "Make a copy for one cohort" with a cohort choice). The dialog shows the dry run ("Moves with Cohort 3": steps with progress, submissions, checkpoint answers, release dates or access settings, plans, help requests, links) and any blocker, then reopens the same lesson in the copy. The editor then says "You're editing Cohort 3's copy"; Content shows "Cohort 3's copy". A learner opening an old lesson link lands on the copy's URL with the `#block-` anchor translated. Staff activity labels for the content events.

**Mobile**: installed builds keep working without an update. Cached lesson ids, delivered push paths and deep links open the copy (server redirect), and progress, submissions, checkpoint answers and video progress against old block ids land on the copy. Newer builds also replace the route's lesson id and block anchor (`moved_from`), and a module link from before the copy opens the copy's module.

**OpenAPI**: `CurriculumCopyPreview(Response)`, `CurriculumCopy(Response)`, `CurriculumCopyOrigin`, `LessonEditAccess.copy_cohorts`/`copy_of`, `LessonDetail.moved_from`; generated types regenerated for web and mobile.

## Results

Tested commit: see the PR head. Mac mini, Chromium (Playwright 1.64.1), Ruby 3.3.7, Node 24, PostgreSQL 16 (pixi).

**Automated**

- API: rubocop clean, Brakeman 0 warnings, zeitwerk OK, full suite with `OPENAPI_COVERAGE=1`: 1725 runs, 39407 assertions, 0 failures.
- Web: lint, typecheck, `api:check`, vitest 188 files / 2249 tests, build, `test:bundle`.
- Mobile: typecheck, jest 135 suites / 1383 tests (lint 0 errors; existing warnings).
- New tests: the full remap matrix with the other cohort's rows and the shared tree byte-for-byte unchanged; `LearnerProgress` identical before and after; dry run counts equal the copy's; retry after success; rollback after each of the nine stages; verification failure rolls back; video replaced during the copy restarts it (and gives up after three); blockers; permissions (granted instructor, admin, ungranted, learner, curriculum no longer shared); copy of a copy; table list against the foreign keys; old ids for lesson, module, progress, writes, checkpoint, video, submission, help request, message source, record peek, notification destination; stale write `409`; two-connection tests (a learner save waiting on the copy gets `content_moved` and the retry saves on the copy; a help request waiting on the copy is saved on the copy); migration; web editor, dialog and Content; learner URL redirect; mobile lesson and module redirects.

**QA harness** (`scripts/qa/run`, synthetic personas plus `scripts/qa/copy-fixtures.rb`, which puts "QA Program 2" on QA Program Lab and gives the QA instructor editing access for QA Program). Fresh harness, all passed:

1. Before the copy, at 1280 and 390, light and dark: the instructor's editor for QA Lab 1.1.1 is read only with "Read only: QA Program 2 shares this curriculum" and "Make a copy for QA Program"; the dialog shows "QA Program switches to its own copy of QA Program Lab (18 lessons)…" with the counts; Content shows the badge and the button. No horizontal overflow.
2. The instructor made the copy (1280): the editor reopened the same lesson on the copy with "You're editing QA Program's copy"; they renamed the video block and saved; the change survived a reload.
3. After the copy, at 1280 and 390, light and dark: Content shows "QA Program Lab (QA Program)", "You can edit", "QA Program's copy". The program student opening `/lessons/1` landed on the copy's lesson with the edit, their graded submission and feedback. QA Program 2's learner (checked through the API: the browser stub only signs in personas 1–8) still gets lesson 1, unchanged, with their own submission.
4. `copy-fixtures.rb verify`: for all four learners (three in QA Program, one in QA Program 2), every lesson's status, counts and availability, the overall counts, the next step and their submissions were identical before and after.

Harness servers and the QA database were stopped and dropped after the run.

Not tested: Safari/WebKit (doesn't start on this host), native builds on a device (installed-build behaviour is covered by server tests of the old-id paths and by jest), screen readers, the transaction pooler CI job locally (no PgBouncer here; CI runs it), real S3 (tests stub storage).

## Fix round 1 (Codex review of `204ef1f`)

The review's evidence is in `review276-evidence-204ef1f/` on the Mac mini. Each finding has a regression test that fails on `204ef1f`.

**P1-1: a copy and a learner save could deadlock.** The copy held the cohort `FOR UPDATE` and then waited for an enrollment. A learner save held that enrollment and then inserted an activity event, whose `cohort_id` foreign key check takes `FOR KEY SHARE` on the cohort, which conflicts with `FOR UPDATE`. The copy now takes the cohort and its enrollments `FOR NO KEY UPDATE`. That still serializes copies and still waits for (and blocks) help requests and lesson message sources (`FOR SHARE` on the cohort), but it doesn't conflict with foreign key checks. There are no retries.

Lock order (also at the top of `CurriculumCopyForCohort`):

| Step | Lock | Taken by |
|---|---|---|
| 0 | Hosted video keys' advisory locks, after the storage check | Copy |
| 1 | Shared curriculum: copy `FOR UPDATE`, authors `FOR SHARE` | Copy, authors |
| 2 | The copying instructor's grant rows `FOR SHARE` | Copy, authors |
| 3 | Cohort: copy `FOR NO KEY UPDATE`; help requests and lesson message sources `FOR SHARE`; learner inserts' foreign key checks `FOR KEY SHARE` (compatible with the copy) | Copy, help requests, messages |
| 4 | Enrollments: copy `FOR NO KEY UPDATE`, ascending; each learner write takes its one enrollment `FOR UPDATE` (`with_learning_write_guard`) first | Copy, learner writes |
| 5 | Modules, lessons and blocks: copy `FOR SHARE`, ascending; learner writes `FOR KEY SHARE` on their block; authors `FOR NO KEY UPDATE`/`FOR UPDATE` | Copy, learners, authors |

Learner write paths:

- **Progress, video credit, checkpoint answers, submissions:** enrollment `FOR UPDATE` (4), then the block `FOR KEY SHARE` (5), then inserts and updates whose foreign keys take `FOR KEY SHARE` on block, knowledge check, user, enrollment and cohort (3, compatible). Progress, video credit and submissions also record an activity event, which was the deadlock.
- **Help requests:** the cohort `FOR SHARE` (3), then the insert. No enrollment lock.
- **GitHub sync and the prework importer:** the same enrollment guard (4), then their blocks `FOR KEY SHARE`.
- **Legacy `import_cohort_data` rake task:** blocks `FOR KEY SHARE` only. It doesn't wait for a copy. It writes rows without an enrollment, and the copy blocks on those (`unassigned_learner_work`) rather than guessing which cohort they belong to.

Tests (`CurriculumCopyConcurrencyTest`, two connections):

- Learner first, for progress, video credit, checkpoint answers and submissions: the save holds its enrollment when the copy starts. The save finishes, and the copy then moves its row. On `204ef1f` the progress, video credit and submission tests fail with a deadlock. The checkpoint path records no activity event, so it never deadlocked.
- Copy first, for each path: the save waits and gets `409 content_moved`; the retry saves on the copy.
- Help request learner first: the request holds the cohort, the copy waits for it, and then the copy moves it.

**P1-2: per-module GitHub settings were left on the old module ids.** `move_cohort!` now remaps `settings.module_github_config` (`requires_github`, `repository_name`) in the same transaction. Other settings, and keys that name no copied module, stay as they were. They are written with `update_columns`, so Cohort's class-resource callback doesn't restamp `available_at`. Test: a legacy exercise (no stored submission type, a filename, a module that requires GitHub) resolves to `prework_github_sync` and `module-specific-repo` before and after the copy, and the other cohort's settings don't change.

JSON, settings and text columns that can hold content ids (the foreign key inventory can't see these):

| Column | What it holds | Decision |
|---|---|---|
| `cohorts.content_defaults` | Module id keys | Remap (already) |
| `cohorts.settings.module_github_config` | Module id keys: `requires_github`, `repository_name` | Remap (this round) |
| `cohorts.settings.class_resources`, `recordings` | Staff-entered links. An in-app `/lessons/:id` link resolves through `MovedContent` | Keep |
| `cohorts.settings.announcements`, `features` | Text, switches | Keep (no ids) |
| `content_blocks.body`, `solution` | Links to lessons, modules and blocks | Rewritten on the copy (already) |
| `content_blocks.metadata` | Package keys, language | Copied as is (keys, not ids) |
| `content_blocks.submission_config` | Editor settings for the exercise | Copied as is (no ids) |
| `knowledge_checks.options` | Answer strings | Copied as is |
| `learning_plans.milestones`, `lesson_overrides`; `learning_plan_revisions.snapshot` | Lesson ids | Remap (already) |
| `help_requests.context_path`, `notifications.path` | `/lessons/:id#block-:id` paths | Rewritten (already) |
| `messages.body`, `announcements.body`, `notifications.body` | Free text | Keep. Links resolve through `MovedContent` |
| `messages` recipient and notification id arrays | User and notification ids | Keep (no content ids) |
| `interventions.evidence_snapshot`, `enrollment_restarts.snapshot`, `records_removed` | Dated records | Keep. Links still resolve |
| `curriculum_copies.counts` | Counts | Bookkeeping |
| `feature_switch_changes.before`, `after`; `school_settings.features` | Switches | Keep (no ids) |
| `course_purchases.checkout_attempt` | Stripe request | Keep (no content ids) |
| `private_meeting_booking_events.details` | Booking changes | Keep (no content ids) |
| `solid_queue_jobs.arguments` | Job arguments: submission, message, notification and help request ids | Keep. Jobs never take content ids, and those rows keep their ids |
| `enrollments` | No JSON columns | n/a |

**P2: the progress guard compared state, not behavior.** The before/after signature now also has, per learner, each exercise's effective submission type and GitHub repository (for each lesson the learner has), watch credit totals (credited count, credit fraction, seconds watched) and checkpoint answer counts (per check, total and correct). Watch credit and answers are counted only on the cohort's current curriculum, so a row left on the shared ids shows up as missing. Query count stays bounded: `LearnerProgress` per learner, plus two grouped queries and one tree load per pass. Tests: GitHub settings left on the old module ids, video credit left on the shared block and checkpoint answers left on the shared check each roll the copy back. On `204ef1f` all three commit, because `LearnerProgress` doesn't change.

**P2: shared-block locks made other cohorts wait.** The copy now takes the shared modules, lessons and blocks `FOR SHARE`. Authors' saves still wait, but learners in other cohorts (`FOR KEY SHARE`) don't. One exception: the first player ping of a hosted video with no stored duration updates the block row, so it waits. `remap_column` is now one `UPDATE … FROM unnest(old_ids, new_ids)` per table instead of one per old id. A test asserts one statement per table. The copy runs with `SET LOCAL lock_timeout = '5s'` and `statement_timeout = '30s'`. A lock timeout, statement timeout or deadlock rolls the whole copy back and returns `409` `busy` ("…Nothing was copied. Try again in a moment."), and the web dialog shows that message. Tests: another cohort's progress, video credit, checkpoint and submission saves finish while the copy holds its locks (the request connection has a 2 s lock timeout; on `204ef1f` the first save times out). A copy that waits more than its lock timeout on an author's block lock answers `409 busy` with nothing changed, and the retry copies.

Scale (Mac mini, local PostgreSQL 16, 40 modules, 401 lessons, 2,005 blocks, 30 learners, 60,150 progress rows; the learner saves start once the copy holds its locks; same probe for both):

| | `204ef1f` | This round |
|---|---|---|
| Copy wall time | 6.59 s | 4.80–5.61 s |
| SQL statements in the copy | 2,424 | 387–388 |
| Learner save in another cohort, wait | 6.50 s | 0.013–0.056 s |
| Learner save in the copied cohort, wait | 6.49 s, then `content_moved` | 4.73–5.52 s, then `content_moved` |

The review measured 5.69 s, 2,478 statements and a 5.67 s wait on its own run. About 4 s of the copy is the before and after `LearnerProgress` passes (30 learners with progress on every block), and those passes are what make the copy safe. The copied cohort's own learners still wait for the whole copy and then reload; on Neon that is the copy's time plus about one round trip per statement (387 statements). Removing the per-learner `LearnerProgress` cost would mean changing `LearnerProgress` itself, which is out of scope here.

**Results this round** (Mac mini, Ruby 3.3.7, Node 22, PostgreSQL 16):

- API: full suite with `OPENAPI_COVERAGE=1`, `PARALLEL_WORKERS=1`: 1740 runs, 39463 assertions, 1 failure. The failure is `LearnerProgressConsumersTest` personal plan (line 52), which is date-dependent, also fails on base `9bb714b`, and is being fixed on main separately. Rubocop: no offenses. Brakeman: 0 warnings.
- Web: typecheck, lint, `api:check`, vitest 188 files / 2249 tests, build, `test:bundle`.
- Mobile: typecheck, jest 135 suites / 1383 tests.
- QA harness, fresh: copy fixtures, now with per-module GitHub settings on QA Program; "before the copy" at 1280 (2 passed); "makes the copy" at 1280 (1 passed); "after the copy" at 1280 and 390, light and dark (4 passed). `copy-fixtures.rb verify`: all four learners identical, now including each exercise's submission type and repository, and the GitHub settings are on the copy's modules. Harness servers and database were stopped and dropped.

## Follow-ups

- Copies are one-way: there's no "merge changes from the shared version" yet.
- Mobile staff have no copy button (the refusal message points to Content on the web).
