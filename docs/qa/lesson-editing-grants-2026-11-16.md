# Lesson editing grants, move and duplicate (part 2a) — November 16, 2026

W5 PR 5.3 part 2a: per-cohort lesson editing access for instructors (decision 1 in `docs/design/2026-11-platform-redesign/README.md` §12) and T-12's lesson move and duplicate. Base: main `6ae6e62` (#267), merged with main `7540297` (#260, #270) before pushing. Branch: `feat/lesson-editor-grants`. Synthetic data only.

## Split

The brief allowed splitting part 2. This PR is **2a**: grants, enforcement, move and duplicate. **2b** is "Make a copy for this cohort" (copy a shared curriculum and move that cohort's learner data onto it). Until 2b lands, an instructor whose cohort shares its curriculum sees it read only, and the notice says only an admin can change that version. Curriculum, module and cohort cloning beyond 2b's copy stay a later PR.

## What changed

**API**

- Migration: `can_edit_lessons`, `edit_granted_by_id` and `edit_granted_at` on `cohort_instructor_assignments`. Additive, each step in its own transaction with `SET LOCAL lock_timeout = '5s'`; the foreign key is added `NOT VALID` and validated separately (DEPLOYMENT.md migration rules). Migration test covers up, rerun and down.
- `LessonEditAccess`: admins edit everything. An instructor edits a curriculum only when every cohort that uses it (any status, including ended ones) is a cohort they have a grant for. Otherwise `reason` is `shared` (with the other cohorts) or `no_grant`.
- Enforced on every write path: `PUT /block_editor`, `PATCH /lessons/:id/editor` (installed mobile builds), `POST /lessons/:id/content_blocks`, `PATCH`/`DELETE /content_blocks/:id`, block video presign, objective alignments, and objective and rubric creation in that curriculum. Generic video presign and content-video multipart uploads need a grant for at least one cohort. Refusals are 403 with `code` `lesson_editing_not_granted` or `curriculum_shared` and a plain message.
- Each write re-checks access inside its transaction, under `FOR SHARE` on the instructor's grant rows, before the lesson lock. A revoke or removal waits for a save already past its check, and every later save is refused (two-connection test).
- `PATCH /cohorts/:cohort_id/instructor_assignments/:user_id/lesson_editing` (admins). Grants and revokes record `lesson_editing_granted` / `lesson_editing_revoked` activity events (actor admin, subject instructor, cohort). Removing a granted instructor records a revoke. The events are a new `content` category and stay out of the learner-centred feeds unless `category=content` or the event type is requested.
- `GET /block_editor` is now open to staff, with an `access` object; `GET /curricula/:id` carries the same object as `editing`.
- `POST /lessons/:id/move`: any day and place in any module of the same curriculum. Lesson and block ids don't change, so progress, submissions, watch credit, quiz attempts and lesson assignments stay attached. Refused when the target module doesn't meet that day, when it's another curriculum, when the lesson is archived, when `base_updated_at` is stale (409), or when learners with work in the lesson aren't assigned the target module (`learner_access`). `dry_run` returns who would stop or start seeing the lesson. Locks: curriculum, modules ascending, lessons ascending, blocks against learner writes (two-connection test: a completion committed while the move waits blocks it).
- `POST /lessons/:id/duplicate`: new lesson, new blocks, own retrieval checks and objective alignments, no learner data, archived on the same day. Hosted videos are shared by key (cleanup is reference-counted).
- Fixed during the work: a second `before_action :require_staff!` replaces the first in Rails, which briefly opened `GET /modules/:id/lessons` to students. Each controller now declares it once; a test covers the three indexes.

**Web**

- Cohort › Teaching team: a "Lesson editing" switch per instructor, with "Leon gave this access on Nov 14" under it. Turning it on asks first; turning it off doesn't.
- Lesson editor: instructors without access see the lesson read only with the reason ("Read only: Cohort 4 shares this curriculum … Leon gave you this access on Nov 14." or "Only admins can edit lessons…"). Granted instructors get the editor with "You can edit Cohort 3's lessons. Leon gave you this access on Nov 14." Admins get Duplicate lesson and Move to week or day in ⋯; archive and restore stay admin-only.
- Move dialog: module, week and day, place in that day. A module change runs a dry run first and shows how many students start or stop seeing the lesson before "Move anyway"; a move that would hide student work is blocked with the reason.
- Content: "You can edit" or "Read only: shared with other cohorts" per curriculum for instructors, and the Edit button where they can edit.

**Mobile**: no UI change. Installed builds only offer editing to admins; the server applies the same rules and the editor shows its 403 message (test added).

**OpenAPI**: new schemas `LessonEditAccess`, `LessonEditGrant`, `CohortInstructorAssignment(s)Response`, `LessonMoveImpact`, `LessonMoveResult`; paths for instructor assignments, lesson editing, move and duplicate with path parameters and request bodies; `access` on `LessonBlockEditorResponse`, `editing` on `CurriculumDetail`. Both generated type files regenerated.

## Decisions

- **Grant UI on the cohort's Teaching team**, as the brief asked. The mockup puts it in School settings › Content editing access; a school-wide list is a follow-up if Leon wants one.
- **No cable reset on grant changes.** No channel depends on grants, and every write re-checks them server-side.
- **Lesson structure stays admin-only** (create, settings, archive, restore, move, duplicate, delete). Grants cover changing a lesson's content and its day in the block editor.
- **Duplicates start archived** so learners never see two identical lessons; the admin edits the copy and restores it.
- **Ended cohorts count as using a curriculum.** Their learners keep read access to past lessons, so an instructor's edit would reach them.

## Results

Tested commit: `8dbf3b5` (functional and screens), gates rerun on the merge with main. Mac mini, Chromium (Playwright 1.64.1), Ruby 3.3.7, Node 22.23.5, PostgreSQL 16 (pixi).

**Automated**

- API: rubocop clean, Brakeman 0 warnings, zeitwerk OK, full suite with `OPENAPI_COVERAGE=1`: 1626 runs, 0 failures on the merge with main (`e24386f`).
- Web: lint, typecheck, `api:check`, vitest (2206 tests), build, `test:bundle`, on the merge.
- Mobile: typecheck, jest (1377 tests), on the merge.
- New tests: permission matrix (admin; granted, ungranted, revoked, removed, archived instructor; exclusive, shared, ended cohort, grants on every sharing cohort, grant on another curriculum), every write path for granted, ungranted and shared, grant/revoke API and audit events, revoke-while-saving and move-while-learner-writes (two connections), move and duplicate, migration, web editor states, teaching team switch, Content page, mobile refusal.

**QA harness** (`scripts/qa/run`, synthetic personas), all passed:

1. Admin turned on lesson editing for QA Instructor on QA Program; the row showed "QA gave this access on Nov 16" and one `lesson_editing_granted` event was stored.
2. Instructor saw "You can edit" on QA Program Lab, opened lesson 1, saw the granted notice, changed the exercise title and saved.
3. The program student opened lesson 1: new title shown, their submission still there.
4. A second cohort was put on QA Program Lab: the instructor's editor turned read only with "Read only: QA Program 2 shares this curriculum", no Save button, and Content showed "Read only: shared with other cohorts".
5. Admin moved lesson 2 to first place in its day, then to Wednesday; positions and day checked in the database.
6. Admin moved lesson 1 (with a student submission) to QA Week 2: the submission rows were identical before and after, and the student still saw their work.
7. Admin duplicated lesson 1: archived copy, 5 new blocks, 0 submissions, 0 progress.
8. Screens at 1280 and 390, light and dark: teaching team, read-only editor, Content, granted editor, ⋯ menu, move dialog. No horizontal overflow, no page errors.

Not tested: Safari/WebKit (doesn't start on this host), native mobile builds on a device, screen readers. "Make a copy for this cohort" is part 2b.

Resources: the QA harness servers (PIDs 94161, 94179) and database were stopped and dropped with `scripts/qa/run clean`; the branch test databases were dropped. The shared `dev-lifecycle` helper refused to start on this host ("Invalid machine profile: schema_version must be 1"), so ownership was tracked through the harness's own PID records.

## Fix round 1 (independent review)

Merged main (#263, #270, #260, #271). #263 took migration version 20261116100000, so the grants migration is now 20261116120000.

- **Curriculum membership is locked with the grants.** The locked re-check takes the curriculum row FOR SHARE before the grant rows and reads grants and sharing cohorts after that, past the query cache (the early check in the same request had cached the cohort query, so a cohort committed in between was missed). Cohort saves that change membership lock both the old and the new curriculum FOR UPDATE, ascending. The lock order (video keys, curriculum, grant rows, modules, lessons, blocks) is documented once, in `Curriculum.lock_for_content!`.
- **Objective and rubric creation re-check in their transaction.** Aligning a new objective to a lesson takes the lesson's authoring lock and advances its version. The audit of every grant-checked endpoint found no other write without the re-check: block create/update/delete, block editor, mobile editor and objective alignments already had it; `video_presign`, `POST /video_presign` and multipart uploads write nothing to the database.
- **Move decides access with `LessonReadAccess.readable?`**, before and after, for every enrollment with read access on the curriculum, so module schedules, start and lesson overrides and paused cutoffs count. The dry run uses the same calculation. A move that takes the lesson away from a learner with work is refused, between modules or to a later day of the same module.
- **Duplicate locks curriculum, module, lesson**, after the storage checks.

Tests that fail without the fix (each was run against the reverted code):

- No-op'd in-transaction re-check: all 16 two-connection request tests fail (8 write paths × revoke / cohort joining).
- No curriculum lock in the re-check: 6 of 6 membership tests fail (new cohort, cohort moving on, granted cohort moving off; each with the save first and the cohort change first).
- Locking only the joined curriculum: both "granted cohort moving off" tests fail.
- Old Duplicate order: the duplicate/move test fails with `ActiveRecord::Deadlocked`.
- Old existence-based Move check: the future-module (the reviewer's case), later-day schedule and paused-cutoff tests fail.

Read policy kept: an instructor without editing access still gets the editor payload with solutions, read-only, as they do when grading.

#274 (content studio) landed during the round and rewrote the Content page. After merging it, I re-applied the grant states to the new page: the "You can edit" and "Read only: shared with other cohorts" badges, Edit on lessons for granted instructors (through `LessonRow canEdit`) and the header text. The Content component test covers them.

Gates after both merges and the fixes: API full suite with `OPENAPI_COVERAGE=1` 1685 runs, 0 failures; rubocop, Brakeman (0 warnings), zeitwerk OK. Web lint, typecheck, `api:check`, vitest (2239), build. Mobile typecheck, jest (1380). Web and mobile need the repo's Node (mise, 20.19.5 / 22): under Node 26 vitest fails 316 tests on `localStorage`. The browser QA journeys were not rerun. Visible changes: the Move refusal message, and the grant badges and Edit button on #274's rewritten Content page, which only the component test covers.

## Follow-ups

- Part 2b: Make a copy for this cohort.
- A school-wide "Content editing access" list (mockup 01, Admin variant) and an audit view for the `content` events.
- Up/down reordering directly in the Content list (the editor's Move dialog covers it today).
