# Block lesson editor, part 1 — November 16, 2026

W5 PR 5.3, part 1: backlog B-3, U-2.1–U-2.4 and the lesson-editor part of U-6.8. Base: main `3b1f8c6` (#258). Branch: `feat/block-lesson-editor`.

Sources: `docs/design/2026-11-platform-redesign/README.md` (§2 glossary, §9 two-mode editor, §12 decision 1) and mockup `03-lesson-editor.html`, plus the task brief. Brain Dump isn't on this host. Synthetic data only.

## Split

The brief allowed a split if one PR was too big to review well. It was, so:

- **Part 1 (this PR):** the block editor with every block type, the inspector, the sticky bar, Preview, an explicit Save with an optimistic lock (autosave until fix round 1), the leave guard, the add-exercise modal fixes, and the API that saves a lesson's blocks atomically without losing learner work.
- **Part 2 (next PR):** move and reorder lessons within and between modules, duplicate a lesson, per-cohort editing access for instructors (admin grant and revoke, API enforcement), and "Make a copy for this cohort" before editing a shared curriculum. Curriculum, module and cohort cloning beyond that copy stays a later PR.

Until part 2 lands, lesson editing stays admin-only, as it is on main. Instructors see the lesson read-only.

## What changed

**API**

- `GET` and `PUT /api/v1/lessons/:id/block_editor` (admin). `PUT` saves lesson settings, every block in order, removals and objective alignments in one transaction. The lesson row is locked during the save and `base_updated_at` must match, so a second admin saving from an older version gets `409 stale_editor` and nothing changes.
- **Block identity is stable.** Reordering only rewrites positions. Blocks are never deleted and recreated, so progress, submissions, watch credit and the next-step answer AS-10 is building keep pointing at the same rows.
- **No silent loss of learner work** (#261's restrict approach): every existing block must be listed in `blocks` or `removed_block_ids`; a block with submissions, progress past "not started", watch time or check attempts can't be removed or change type; a check with attempts can't be removed or edited; replacing a hosted video that students have watched needs the block in `confirm_watch_reset_block_ids`, and the reset keeps the progress rows. `ContentBlock` now refuses deletion while it holds learner work, which also covers lesson and module deletes and the older content-block endpoint.
- The lesson serializer moved into a concern so both endpoints return the same `LessonDetail`. `PATCH /lessons/:id/editor`, which installed mobile builds use, keeps its payload; fix round 1 changed its locking and watch-reset behavior (below).
- `docs/openapi.json` documents both operations, the response (`LessonBlockEditorResponse`, `BlockLearnerActivity`, `LessonEditorContext`) and the request body with its validation (`LessonBlockEditorInput`, `LessonBlockInput`: 1–20 blocks, enums, 2–6 choices, size limits). Generated types are regenerated for web and mobile.

**Web**

- Every block shows in order as a card: Text, Video, Recording, Exercise, Code challenge, Checkpoint. Each card has a drag handle (arrow keys, Home and End also move it), Duplicate, Delete and a ⋯ menu with Move up and Move down. A + between cards adds any type there. Moves are announced to screen readers and focus stays on the handle.
- The inspector has a Lesson tab (title, required, week and day, objectives and which block each applies to, where the lesson is used with submission and help counts) and a tab for the selected block (heading, kind, submission type, filename, code runner, retrieval objective, rubric, and a note when students have work on it). On phones it opens from the Settings button.
- The sticky bar has Back to Content, the breadcrumb (curriculum › module › week and day), the save state ("Saved · 5s ago", "Unsaved changes", "Saving…", "Couldn't save", "Not saved: newer version"), Preview, and ⋯ (Copy link, Archive or Restore lesson).
- **Save** (fix round 1 replaced autosave): edits stay on the page until Save or ⌘S / Ctrl+S, one save at a time. A half-written retrieval question blocks saving and says what's missing. A conflict keeps your edits and offers "Reload latest version". Unsaved edits are backed up in this browser and offered back after a crash.
- Leaving with unsaved edits asks "Leave without saving?" with Keep editing, Discard and Save and leave, through the router's one leave guard (#251).
- Text blocks, exercise and code challenge instructions and checkpoint instructions use the Rich | Markdown editor (U-6.8); Markdown mode's Preview uses the lesson renderer. The exercise solution opens in a dialog with the code editor.
- Preview renders every block the way students see it, including unsaved changes.
- Add-exercise modal (U-2.4): the empty-body rule is stated first, instructions come right after the title and use the two-mode editor, the title is full width, and week, day, submission type and filename sit in a two-column grid so the select can't overflow.
- Layout: the main column now clips horizontal overflow (`overflow-x-clip`) instead of hiding it. `overflow-x: hidden` made `<main>` a scroll container, so no `position: sticky` element on any page stuck to the window. Messages keeps its own overflow rules. Pages that already declare sticky panels (Grading, cohort section tabs, Recordings, Updates) now get the behavior they ask for; worth a glance on review.

## Decisions

- **A Save button, not autosave** (lead decision in fix round 1). README §9.7 gives lesson editors their own Save button, and the mockup defines save states but no autosave interval and no draft/publish boundary. Lesson rows are live for every cohort on the curriculum, so autosave would show half-typed text to students.
- **Restrict, not soft-archive, for blocks with learner work.** Archiving blocks would change what every learner query and AS-10's next-step logic must filter. Restricting keeps the data model as it is; staff can still edit the content of such a block or archive the whole lesson.
- **Lesson text is written with the editor's `written` target**, and Markdown Preview renders with the lesson renderer. One difference remains: a Shift+Enter line break in Rich mode is stored as a single newline, which lesson text (CommonMark) reads as a space. Legacy HTML lesson bodies show as locked blocks in Rich mode and are saved unchanged.
- **One retrieval question per Checkpoint block**, as the data model has one check per block. The mockup shows a three-question checkpoint; that would need a schema change.
- **Uploading a video file needs a saved block.** A new Video block takes a link at once; upload is offered once the block has been saved and has an id.

## Results

Tested commit: `b163e5d` plus this record. Mac mini, Chromium (T3 preview), Ruby 3.3.7, Node 22.23.5, PostgreSQL 16 (pixi).

**Automated**

- API: `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1 bin/rails test`: 1,522 runs, 37,854 assertions, 0 failures. New `test/integration/lesson_block_editor_test.rb` (18 tests): permissions (admin, instructor, student), every block type saved in order with stable ids, duplicates with their own check, alignments to new blocks, rollback of a failing save, the listing rule, removal with and without learner work, type and check protection, lesson and module deletes refused, watch-reset confirmation, a two-admin conflict, a missing version, the 20-block limit, schedule validation, foreign blocks, and the unchanged mobile endpoint. RuboCop clean (622 files), Brakeman 0 warnings, `zeitwerk:check` ok.
- Web: typecheck, lint, `api:check`, Vitest 179 files / 2,134 tests, production build, bundle check. New `LessonEditor.test.tsx` (8) and `blockDraft.test.ts` (6): every block type editable, add between, keyboard reorder with announcement, duplicate, delete and the learner-work lock, the payload order, autosave and save state, inspector tabs, schedule change, Preview of every block, Save and leave, the conflict banner, the solution dialog, and Rich | Markdown on all four formatted fields.
- Mobile: typecheck, Jest 129 suites / 1,171 tests (generated types changed).
- Impeccable 4.6.0 advisory scan of the changed UI files: no findings.

**In the browser** (synthetic QA harness, admin unless noted)

| Scenario | Result |
| --- | --- |
| Build a lesson from one Text block to six blocks covering every type (Text, Video, Exercise, Code challenge, Checkpoint with a question, Recording) | Passed; autosaved, rows 271–276 in order |
| Reorder with the keyboard (Recording up two places) | Passed after a fix: the first try crashed because the Monaco solution editor moved with its card; the solution now opens in a dialog |
| Reorder by drag | Logic passed with real HTML5 drag events (drop line shown, block moved). The preview tool's mouse drag doesn't send native drag events, so a hand drag wasn't run |
| Duplicate the checkpoint | Passed; new row 277 with its own question; reordered blocks kept ids 271–276 |
| Preview | Passed; all seven blocks render as students see them |
| Leave with an unsaved edit, then Save and leave | Passed; dialog shown, edit saved, arrived at Content |
| Block with a student submission | Passed; Delete disabled with the reason, inspector explains, badge shows "1 submission" |
| Another admin saves first | Passed; "Someone else saved this lesson…", edits kept, "Reload latest version" loads theirs |
| 1280 and 390, light and dark | Passed after a fix (card bodies were 54 px too wide at 390). Sticky bar holds at both widths after the layout fix; settings sheet works on phones; no control under 44 px at 390; no horizontal scroll |
| Instructor opens the editor URL | Passed; read-only lesson, no editor API call |

Not run here: Safari and WebKit (they don't start on this host), real devices, hosted video upload to S3, and the part 2 scenarios (granted instructor, copy before editing).

Owned resources: QA servers (PIDs 98456, 98496) stopped and database `csg_qa_98426_1794763798` dropped; preview tab closed; the test database is dropped after the final run.

## Fix round 1

An independent Codex review of `f0e7832` confirmed the lesson lock before the version check, transactional saves, stable ids on reorder, the HTTP delete guard, admin-only endpoints, sanitized rendering, keyboard announcements and no overflow at 390. It found four P1 and two P2 problems. Changes:

1. **Learner work could be deleted by a concurrent completion (P1).** Learner writes (`Progress`, `Submission`, `KnowledgeCheckAttempt` saves) now take `FOR KEY SHARE` on their content block. Deleting a block or changing its type takes `FOR UPDATE` on the block and only then counts learner work, so a completion either commits first and is seen, or waits and finds the block gone. The block editor locks every block of the lesson before it counts learner work. Lesson and module deletes go through the same block callback. Both are row locks scoped to the transaction, so they work behind the Neon pooler. Learners don't wait for each other or for ordinary block edits.
2. **The older block PATCH could change a block's type (P1).** `ContentBlock` now refuses a type change while the block has learner work, under the same lock, so every update path gets the rule.
3. **Mobile and legacy video replacement reset watch time without asking (P1).** `PATCH /content_blocks/:id` and `PATCH /lessons/:id/editor` now keep students' watch progress unless the request sends `confirm_watch_reset=true` (`editor.video.confirm_watch_reset` on the editor). Installed mobile builds (TestFlight 47) can't send that flag, and losing watch time without a prompt is the worse failure, so leaving it out keeps progress. The trade-off: kept watch time counts toward the new video, so a student who watched most of the old one may complete the new one sooner. The web block editor still asks first and resets only blocks listed in `confirm_watch_reset_block_ids`. **Superseded in fix round 2:** keeping the credit let it complete the new video unwatched, so these paths now refuse the replacement instead.
4. **Legacy block writes skipped the version check (P1).** `Lesson#with_authoring_lock` locks the lesson row and advances its `updated_at`. Block create, update and delete on `/content_blocks`, the mobile `PATCH /editor`, objective alignments, lesson delete and the block editor all use it, and course package import touches lessons whose blocks changed. A block editor save from an older version now gets `409` after any of them. The lesson lock is `FOR NO KEY UPDATE`, so learner rows that reference the lesson don't wait on it.
5. **Saves could overlap (P2).** Autosave is gone (lead decision above). Saves run through one queue, one at a time, and each builds its payload and base version when it starts, so a save asked for during another sends the newest edits on top of the version the first produced.
6. **Deleting a new block during its first save broke later saves (P2).** When a save returns an id for a block that was deleted while the save ran, that id is queued in `removed_block_ids`, so the next save accounts for it.

Web save model: a Save button in the sticky bar (icon only on phones, 44 × 44), disabled when nothing changed. States stay "Unsaved changes", "Saving…", "Saved · 2s ago". ⌘S / Ctrl+S saves. Leaving asks Keep editing, Discard or Save and leave. Unsaved edits are written to `localStorage` per user and lesson (guarded with try/catch); on the next open the editor offers Restore or Discard. Restoring only fills the editor, and the person still has to Save. A backup taken from an older lesson version can't be restored over a newer one.

Possible follow-up for Leon: **draft vs publish for shared curricula.** Explicit Save still publishes immediately to every cohort on the curriculum. A draft/publish step (or part 2's "Make a copy for this cohort") would let staff save work in progress without students seeing it.

Results (Mac mini, Ruby 3.3.7, Node 20.19.5, PostgreSQL 16):

- API: `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1 bin/rails test`: 1,530 runs, 37,932 assertions, 0 failures. New `test/models/content_block_learner_work_concurrency_test.rb` uses two real connections: a completion committed while a block delete, lesson delete or type change waits is kept (all three fail without the locks); a learner write that starts while a delete holds the lock waits and finds the block gone; two learners on one block don't wait for each other. New integration tests: type change refused through `/content_blocks`, the block editor and the model; watch time kept without confirmation and reset with it, on both `/content_blocks` and mobile `/editor`, for removal and replacement; a block editor `PUT` from before a legacy PATCH, POST, DELETE, alignments update or mobile editor save gets `409`. RuboCop clean (624 files), Brakeman 0 warnings, `zeitwerk:check` ok.
- Web: typecheck, lint, `api:check`, Vitest 179 files / 2,141 tests, build, `test:bundle`. New tests: Save only when asked (button and Ctrl+S) with the save state; one save in flight with the second built from the newest edits and the first save's version; a new block deleted during its first save queued for removal; local backup restored only on request and not over a newer version; Keep editing and Discard in the leave guard.
- Mobile: typecheck, Jest 129 suites / 1,171 tests.
- Browser (QA harness, Chromium headless, admin, lesson 54, at 1280 and 390): Save disabled when clean; "Unsaved changes" with no request after 2.5 s; Save and ⌘S each send one `PUT` and show "Saved · 1s ago"; reload offers the backup and Restore fills the editor without saving; Back to Content asks Keep editing, Discard or Save and leave, and Save and leave saves and navigates; no horizontal overflow; Save is 44 px on phones. 24 of 24 checks passed after one fix (Save was 40 px wide on phones).

Not run: Safari and WebKit (they don't start on this host), real devices, the mobile app against the new watch-reset default, hosted video upload to S3.

Owned resources for this round: QA harness servers (PIDs 28286, 28297) stopped and database `csg_qa_28271_1794765694` dropped; test database `csg_lesson_editor_fix1_test` dropped after the final run.

## Fix round 2

The Codex re-review of `230d50d` confirmed single-block locking, `FOR KEY SHARE` for learners, completions surviving deletes and type changes, refused legacy type changes, stale `PUT` conflicts, serialized saves, in-flight delete reconciliation, the backup restore rules and the transactional package import. Three findings and one performance note, all fixed (evidence in `review-artifacts/pr267-230d50d5`):

1. **Old watch credit completed replacement media (P1).** Fix round 1 kept watch progress when an installed mobile build replaced a video. The reviewer showed that 300 s of credit on a 400 s video completed a 300 s replacement on a ping reporting 0 s at position 0. Lead decision: `ContentBlock` now refuses, on every path, to change what a block plays (hosted upload, or the link when there's no upload) while students have progress on it, unless the save confirms the reset. The 422 says "Students have watched this video. Replace it from the web lesson editor, which asks before resetting their watch time." A confirmed replacement resets that progress (completion included, unless a check or reviewed submission controls it). A video nobody has progress on is replaced without asking. Changing a watched video's link now needs the same confirmation as an upload. The block editor's 422 carries `block_ids`, and the web dialog resends with them. Watch rows are reset rather than kept under a media revision id: keeping them would need a migration and changes to every watch-credit reader, so it isn't cheap.
2. **Multi-block learner writes could deadlock with editor saves (P2).** Every path that locks more than one block now does it in ascending id order. GitHub sync takes `FOR KEY SHARE` on all the blocks it will write, inside the enrollment guard and before any submission or progress row (`ContentBlock.lock_for_learner_writes!`); a block deleted since lookup is skipped. The legacy cohort import rake task does the same. The block editor, mobile `PATCH /editor`, and lesson, module and curriculum deletes lock their blocks in one ascending pass. Other learner writes (progress, submissions, check attempts, watch pings) touch one block per transaction.
3. **Local backups survived sign-out (P2).** Signing out removes the departing viewer's lesson backups (every lesson backup if the session never loaded), and another account signing in removes the previous one's. Clearing bumps a generation number, so a backup timer scheduled before sign-out can't write afterwards.
4. **Lock scope and S3 (performance).** Only blocks being removed, changing type, losing a retrieval check or getting new media take `FOR UPDATE`; every other block takes `FOR NO KEY UPDATE`, which `FOR KEY SHARE` doesn't wait for, so watch pings and submissions on ordinary blocks no longer wait for a save. New hosted-video keys are checked in S3 (`HEAD`) before the lesson or any block is locked, inside the saving transaction and under the key's advisory lock, so a cleanup can't delete the object before commit. Validation then only confirms the key matches what was checked. Same for the legacy block PATCH/POST and mobile `PATCH /editor`.

Results (Mac mini, Ruby 3.3.7, Node 20.19.5 web / 22.22.3 mobile, PostgreSQL 16):

- API: `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1 bin/rails test`: 1,564 runs, 38,308 assertions, 0 failures. New tests: unconfirmed replacement with watch progress refused on `/content_blocks` and mobile `/editor` (upload removed, upload swapped, upload swapped for a link), confirmed replacement resets, no-progress replacement allowed; the reviewer's repro (0 s ping after a confirmed replacement doesn't complete); the block editor returns `block_ids` and asks before a link change; storage checked once and before any lesson or block lock on all four save paths; two-connection GitHub sync vs. an ascending author lock pass with files in the opposite order (fails with `PG::TRDeadlockDetected` on `230d50d`'s sync, passes now); an ordinary block editor save completes while a learner write holds its block. RuboCop clean (627 files), Brakeman 0 warnings, `zeitwerk:check` ok.
- Web: typecheck, lint, `api:check`, Vitest 179 files / 2,150 tests, build, `test:bundle`. New tests: sign-out removes the viewer's backups and drops a write scheduled before it; sign-out before the session loads removes all backups; an account switch removes the previous viewer's; the watch-reset dialog resends with the server's `block_ids`.
- Mobile: typecheck, Jest 133 suites / 1,320 tests. New tests: the API client turns the 422 into an `ApiError` with the server's message, and the editor shows it and keeps the draft. Checked against the current source, not the installed TestFlight 47 binary.

Not run: browser QA for this round (no UI layout changed; the confirm dialog is covered by Vitest), Safari/WebKit, real devices, the installed TestFlight 47 app, S3 upload.

Owned resources for this round: test databases `csg_lesson_editor_r2_test*` dropped after the final run; no servers or browsers started.
