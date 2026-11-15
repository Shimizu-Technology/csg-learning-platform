# Block lesson editor, part 1 — November 16, 2026

W5 PR 5.3, part 1: backlog B-3, U-2.1–U-2.4 and the lesson-editor part of U-6.8. Base: main `3b1f8c6` (#258). Branch: `feat/block-lesson-editor`.

Sources: `docs/design/2026-11-platform-redesign/README.md` (§2 glossary, §9 two-mode editor, §12 decision 1) and mockup `03-lesson-editor.html`, plus the task brief. Brain Dump isn't on this host. Synthetic data only.

## Split

The brief allowed a split if one PR was too big to review well. It was, so:

- **Part 1 (this PR):** the block editor with every block type, the inspector, the sticky bar, Preview, autosave with an optimistic lock, the leave guard, the add-exercise modal fixes, and the API that saves a lesson's blocks atomically without losing learner work.
- **Part 2 (next PR):** move and reorder lessons within and between modules, duplicate a lesson, per-cohort editing access for instructors (admin grant and revoke, API enforcement), and "Make a copy for this cohort" before editing a shared curriculum. Curriculum, module and cohort cloning beyond that copy stays a later PR.

Until part 2 lands, lesson editing stays admin-only, as it is on main. Instructors see the lesson read-only.

## What changed

**API**

- `GET` and `PUT /api/v1/lessons/:id/block_editor` (admin). `PUT` saves lesson settings, every block in order, removals and objective alignments in one transaction. The lesson row is locked during the save and `base_updated_at` must match, so a second admin saving from an older version gets `409 stale_editor` and nothing changes.
- **Block identity is stable.** Reordering only rewrites positions. Blocks are never deleted and recreated, so progress, submissions, watch credit and the next-step answer AS-10 is building keep pointing at the same rows.
- **No silent loss of learner work** (#261's restrict approach): every existing block must be listed in `blocks` or `removed_block_ids`; a block with submissions, progress past "not started", watch time or check attempts can't be removed or change type; a check with attempts can't be removed or edited; replacing a hosted video that students have watched needs the block in `confirm_watch_reset_block_ids`, and the reset keeps the progress rows. `ContentBlock` now refuses deletion while it holds learner work, which also covers lesson and module deletes and the older content-block endpoint.
- The lesson serializer moved into a concern so both endpoints return the same `LessonDetail`. `PATCH /lessons/:id/editor`, which installed mobile builds use, is unchanged.
- `docs/openapi.json` documents both operations, the response (`LessonBlockEditorResponse`, `BlockLearnerActivity`, `LessonEditorContext`) and the request body with its validation (`LessonBlockEditorInput`, `LessonBlockInput`: 1–20 blocks, enums, 2–6 choices, size limits). Generated types are regenerated for web and mobile.

**Web**

- Every block shows in order as a card: Text, Video, Recording, Exercise, Code challenge, Checkpoint. Each card has a drag handle (arrow keys, Home and End also move it), Duplicate, Delete and a ⋯ menu with Move up and Move down. A + between cards adds any type there. Moves are announced to screen readers and focus stays on the handle.
- The inspector has a Lesson tab (title, required, week and day, objectives and which block each applies to, where the lesson is used with submission and help counts) and a tab for the selected block (heading, kind, submission type, filename, code runner, retrieval objective, rubric, and a note when students have work on it). On phones it opens from the Settings button.
- The sticky bar has Back to Content, the breadcrumb (curriculum › module › week and day), the save state ("Saved · 5s ago", "Unsaved changes", "Saving…", "Couldn't save", "Not saved: newer version"), Preview, and ⋯ (Copy link, Archive or Restore lesson).
- **Autosave**, as in the mockup: 1.5 s after the last change, one save at a time; ⌘S or "Save now" saves at once. A half-written retrieval question pauses saving and says what's missing. A conflict keeps your edits and offers "Reload latest version".
- Leaving with unsaved edits asks "Leave without saving?" with Keep editing, Discard and Save and leave, through the router's one leave guard (#251).
- Text blocks, exercise and code challenge instructions and checkpoint instructions use the Rich | Markdown editor (U-6.8); Markdown mode's Preview uses the lesson renderer. The exercise solution opens in a dialog with the code editor.
- Preview renders every block the way students see it, including unsaved changes.
- Add-exercise modal (U-2.4): the empty-body rule is stated first, instructions come right after the title and use the two-mode editor, the title is full width, and week, day, submission type and filename sit in a two-column grid so the select can't overflow.
- Layout: the main column now clips horizontal overflow (`overflow-x-clip`) instead of hiding it. `overflow-x: hidden` made `<main>` a scroll container, so no `position: sticky` element on any page stuck to the window. Messages keeps its own overflow rules. Pages that already declare sticky panels (Grading, cohort section tabs, Recordings, Updates) now get the behavior they ask for; worth a glance on review.

## Decisions

- **Autosave rather than a Save button**, because the approved mockup shows it. The risk is that half-typed text reaches students sooner. Mitigations: incomplete questions don't save, Preview shows the student view, and every save is a normal versioned write.
- **Restrict, not soft-archive, for blocks with learner work.** Archiving blocks would change what every learner query and AS-10's next-step logic must filter. Restricting keeps the data model as it is; staff can still edit the content of such a block or archive the whole lesson.
- **Lesson text is written with the editor's `written` target**, and Markdown Preview renders with the lesson renderer. One difference remains: a Shift+Enter line break in Rich mode is stored as a single newline, which lesson text (CommonMark) reads as a space. Legacy HTML lesson bodies show as locked blocks in Rich mode and are saved unchanged.
- **One retrieval question per Checkpoint block**, as the data model has one check per block. The mockup shows a three-question checkpoint; that would need a schema change.
- **Uploading a video file needs a saved block.** A new Video block takes a link at once; upload is offered once autosave gives the block an id.

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
