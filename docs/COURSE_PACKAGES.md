# Import recording course packages

Admins can use **Content → Import course package** to preview a JSON file, confirm its lesson/block counts, and import an unassigned draft. Attach recordings through the existing lesson editor. Importing does not create enrollment, meetings, payment links or public course availability.

## Package contract

`POST /api/v1/course_packages/preview` validates without writing. `POST /api/v1/course_packages` imports within one transaction. Both require an admin and accept `{ "package": <package object> }`. Staff answer text belongs in each block’s `solution`, never its learner `body`. Existing student serializers omit solutions. Treat the source JSON as private staff material.

A schema-v1 package contains `key`, `revision`, `title`, `description`, `total_weeks` and `modules`. Each module has `key`, `title`, `description`, `total_days`, `schedule_days` and `lessons`. Each lesson has `key`, `title`, `lesson_type`, `release_day`, `required` and `blocks`. Each block has `key`, `block_type`, optional `title`, `body`, `solution`, `filename` and `submission_type`. Use stable keys; release days are zero-based module offsets and must fit the selected schedule.

A project block can include `rubric: { title, description, criteria: [{ title, description }] }`. Criteria appear in the existing learner self-review and staff grading flow. Put public acceptance criteria there; keep private solutions in `solution`. Rubrics allow 1–12 criteria. Point weights can be stated in each criterion’s title/description; the importer does not invent numeric scoring rules or entitlements.

Limits: 2 MB JSON, 20 modules, 250 total lessons, 20 blocks per lesson, 100,000 characters per body/solution. An empty `video` block is a recording placeholder. Media URLs and S3 keys are rejected; attach media in the normal authenticated upload flow.

## Revisions and preservation

The package key identifies only a package-created curriculum. Legacy bootcamp and alumni curricula are separate. Reimporting identical JSON returns the existing ID without changing any records, including attached media and subsequent staff corrections.

Changed content requires a new revision. Updates are allowed only on an unassigned draft whose content and structure still match the last import. Removing package items, overwriting manual edits, or revising an active/assigned curriculum is rejected. Once staff edits or assigns the course, use the content editor or a deliberately new package key for a separate course version. Do not duplicate a key merely to bypass an enrollment safeguard.

Importer transactions lock the curriculum and its descendants. Detected concurrent database conflicts roll back and ask staff to preview again. Media is excluded from content snapshots, so attaching a recording does not prevent a safe draft content revision.

## Course preparation

1. Export the current private course package. Compare it with its learner instructions, exact recording script and private key.
2. Preview and import the unassigned draft. Check its orientation, nine lessons, twelve exercises, two checkpoints, project/rubric and optional extension. Verify empty recording slots rather than a fabricated video link.
3. Record from the numbered code states, upload the corresponding clip, and check captions, legibility and playback.
4. Before assignment, rehearse the delivered Hafa/local environment and Learn with a separate learner profile. Confirm submissions, feedback, messaging, course switching and the selected edition’s access.
5. Configure the real cohort calendar, instructor and guided booking capacity separately. A day-zero module anchor on November 30 makes day-one material available December 1; check actual dates before assigning a December course.
6. Keep admissions and checkout closed until recordings, learner QA, approved offer terms and payment-to-access rehearsal pass.

The web importer is admin-only. Mobile users can edit imported curricula through the existing content controls; package-file import is a web staff operation.
