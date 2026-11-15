# Make a copy for this cohort (part 2b) — November 16, 2026

W5 PR 5.3 part 2b: "Make a copy for this cohort", decision 1 in `docs/design/2026-11-platform-redesign/README.md` §12 (confirmed by Leon 2026-11-15). An instructor with editing access for a cohort whose curriculum other cohorts share makes a copy for that cohort before editing. The copy keeps the cohort's progress, submissions and release dates; later changes to the shared version don't reach it. Admins can make the copy too, and can still edit the shared version. Base: main `9bb714b` (#273). Branch `feat/copy-before-edit`. Synthetic data only.

## What changed

**API**

- `CurriculumCopyForCohort` copies the curriculum (modules, lessons including archived ones, blocks, knowledge checks with their options, learning objectives, rubrics and criteria, objective alignments, ready course files, package revision/digest/snapshot) and moves the cohort to it. New ids come from each table's sequence in ascending old-id order, so lessons that share a position sort the same way. Links inside copied blocks to other lessons and modules of the curriculum point at the copy.
- The cohort's learner data is updated in place, so submission, help request, follow-up and progress ids never change. Learner rows include the cohort's enrollments in any status, and rows without an enrollment (older data) for learners who have no other cohort on the shared curriculum.
- Old ids keep working: each copied module, lesson, block and knowledge check gets a `content_redirects` row for the cohort. `MovedContent` applies a redirect only when the viewer can't reach the original (a learner none of whose cohorts use it, or a request naming the copied cohort). It costs one query when nothing was copied, so the record-peek query budgets (#247) still hold.
- One transaction, in #273's lock order: video keys verified first (advisory locks), shared curriculum `FOR UPDATE`, the instructor's grants `FOR SHARE` (re-checked under lock), the cohort and its enrollments `FOR UPDATE`, modules and lessons `FOR SHARE`, blocks `FOR UPDATE` against learner writes. Before commit, `LearnerProgress` (#266) runs for every learner of the cohort before and after (every lesson's status, review status, availability, requirement, counts and submission window; every module; overall counts; next step; redo list). Any difference rolls everything back (`verification_failed`). Last, `enrollments.content_moved_at` is stamped.
- A learning write that began before the copy committed is refused with `409 content_moved` ("Reload, then save again"), through the enrollment guard restarts already use, or through the block re-check when it waited on the block lock. Help requests and lesson message sources wait on the cohort row and resolve to the copy. `module_access` re-checks the module's curriculum after its cohort lock.
- Endpoints: `GET`/`POST /api/v1/cohorts/:cohort_id/curriculum_copy` (dry run with per-table counts and blockers; copy). A retry after success returns the same copy (`200`, `already_copied`); a failure leaves nothing behind. A cohort copies a given curriculum once (unique index).
- `LessonEditAccess` JSON adds `copy_cohorts` and `copy_of`. The shared-curriculum refusal message now says to make a copy. `GET /lessons/:id` adds `moved_from` (old lesson id and old → new block ids) when it served the copy for an old id.
- Audit: `curriculum_copied` activity event (content category, actor = subject = the staff member) and a `curriculum_copies` row with who, when, source, copy and the counts. Grants live on the cohort's assignment rows, so the instructor's access now covers the cohort's own copy (`reason: granted`).
- Migration: `curriculum_copies`, `content_redirects`, `enrollments.content_moved_at`, and `curriculum_resources.s3_key` changed from a unique to a plain index (built concurrently, invalid builds rebuilt on rerun). Migration test covers up, rerun and down.

**Every table that references content** (`CurriculumCopyForCohort::TABLES`; a test checks the list against the database's foreign keys):

| Table | Decision |
|---|---|
| curricula, modules, lessons, content_blocks, knowledge_checks, learning_objectives, rubrics, rubric_criteria, objective_alignments, curriculum_resources | Copied |
| cohorts (`curriculum_id`, `content_defaults` module keys), cohort_module_schedules, cohort_module_submission_windows | Remapped for the cohort |
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

## Follow-ups

- Copies are one-way: there's no "merge changes from the shared version" yet.
- Mobile staff have no copy button (the refusal message points to Content on the web).
