# Import recording course packages

Admins can use **Content → Import course package** to preview a JSON file, confirm its lesson/block counts, and import an unassigned draft. Attach recordings through the existing lesson editor. Importing does not create enrollment, meetings, payment links or public course availability.

## Package contract

`POST /api/v1/course_packages/preview` validates without writing. `POST /api/v1/course_packages` imports within one transaction. Both require an admin. The browser sends `{ "package_base64": "<strict base64 of UTF-8 JSON>" }` so literal shell, SQL and HTML teaching code can pass through the production firewall as a file payload. The API checks encoded and decoded size, valid UTF-8, JSON object shape and the complete existing importer contract. Legacy `{ "package": <package object> }` requests remain supported; supplying both formats is rejected. Base64 is transport encoding, not encryption; authentication, TLS, log filtering and restricted staff fields remain required. Staff answer text belongs in each block’s `solution`, never its learner `body`. Existing student serializers omit solutions. Treat the source JSON as private staff material.

A schema-v1 package contains `key`, `revision`, `title`, `description`, `total_weeks` and `modules`. Each module has `key`, `title`, `description`, `total_days`, `schedule_days`, optional `module_type` (defaults to `workshop`; supports `prework`, `live_class`, `capstone`, `advanced`, `workshop`, `recording`) and `lessons`. Each lesson has `key`, `title`, `lesson_type`, `release_day`, `required` and `blocks`. Each block has `key`, `block_type`, optional `title`, `body`, `solution`, `filename` and `submission_type`. Use stable keys; release days are zero-based module offsets and must fit the selected schedule.

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

## Authoring in Markdown and converting to JSON

Authors can write and version a course in Git as plain Markdown + YAML files, then compile it into a deterministic schema-v1 JSON package for **Content → Import course package**.

### Repository layout

```text
my-course/
  course.yml
  modules/
    01-core/
      module.yml
      01-read-a-value.md
      02-exercise-1.md
      03-capstone.md
  solutions/
    exercise-1/
      practice.md
```

- `course.yml` (or `course.yaml`) defines `key`, `revision`, `title`, optional `description`, `total_weeks`, and optional default `module_type` (defaults to `workshop`).
- Module directories live under `modules/` (or at the repo root if `modules/` is absent), ordered lexicographically by directory name. Each contains `module.yml` (or `module.yaml`) with `key`, `title`, optional `description`, `total_days`, `schedule_days`, and optional `module_type`.
- Lesson `.md` files live directly in each module directory (ignoring `README.md`) or in a `lessons/` subdirectory, ordered lexicographically by filename.

### Lesson frontmatter and blocks

Every lesson starts with YAML frontmatter containing `key`, `title`, `lesson_type`, `release_day`, and `required`.

- **Single-block lesson:** omit `<!-- block ... -->` markers and write plain Markdown below frontmatter. Optional frontmatter keys `block_key` (defaults to `main`), `block_type` (inferred from `lesson_type`), `block_title`, `filename`, `submission_type`, `rubric`, `solution`, and `solution_file` configure the single block.
- **Multi-block lesson:** split the Markdown body with `<!-- block ... -->` markers using `key=value` attributes, inline YAML, or multiline YAML comments. Complex metadata such as project `rubric` definitions can live in frontmatter `blocks:` keyed by block key or inside a multiline `<!-- block ... -->` comment.

### Private staff solutions

Staff answers always land in `solution` and never appear in learner `body`. Supply a block's solution using **at most one** of the following sources (combining multiple sources for the same block is rejected):

1. An inline `<!-- solution -->` section at the end of the block (optionally closed with `<!-- endsolution -->`).
2. A `solution:` metadata attribute on the block (or on single-block lesson frontmatter).
3. A private file under `solutions/`: module-scoped `solutions/<module-key>/<lesson-key>/<block-key>.md` (or `solutions/<module-key>/<lesson-key>.md` for single-block lessons), or unscoped `solutions/<lesson-key>/<block-key>.md` / `solutions/<lesson-key>.md` when `lesson-key` is unique across the course.
4. An explicit relative `solution_file:` path on the block or lesson frontmatter (must stay inside the repository root and cannot point to a discovered lesson file).

### End-to-end example

`course.yml`:

```yaml
key: python-fundamentals
revision: "2026-10-04"
title: Python Fundamentals
description: Hands-on Python practice for beginners.
total_weeks: 3
```

`modules/01-core/module.yml`:

```yaml
key: core
title: Python Core
description: Learn variables, control flow, and functions.
total_days: 21
schedule_days: daily
```

`modules/01-core/01-read-a-value.md`:

```markdown
---
key: lesson-1
title: Read a value
lesson_type: video
release_day: 1
required: true
blocks:
  project:
    rubric:
      title: Mini-check rubric
      criteria:
        - title: Clear explanation
          description: Explains what the script prints and why.
---

<!-- block key=video type=video -->

<!-- block key=instructions type=text -->
Predict what the script prints, then run it locally.

<!-- block key=practice type=exercise filename=hello.py submission_type=text_submission -->
Explain why the output changes when you reassign `name`.

<!-- solution -->
Reassigning `name` before `print(name)` updates the value printed.

<!-- block key=project type=exercise submission_type=repo_url_submission -->
Push your script to a repository and submit the URL.
```

### Converting and verifying

```bash
# Convert to deterministic pretty-printed JSON
scripts/course-package-convert path/to/my-course -o python-fundamentals.json

# Validate without writing output, checking directly against CoursePackageImporter
scripts/course-package-convert path/to/my-course --dry-run --verify

# Or run via Rails rake task (always verifies against CoursePackageImporter)
cd api && bin/rails 'course_packages:convert_markdown[../path/to/my-course,../python-fundamentals.json]'
```

The converter enforces the exact schema-v1 limits (2 MB JSON, 20 modules, 250 lessons, 20 blocks/lesson, 100,000 chars per body/solution, 1–12 rubric criteria, valid `release_day` for `schedule_days`, no media URLs or S3 keys) and emits stable, byte-identical JSON for idempotent re-imports. Keep all answer-bearing source files private — including lesson Markdown containing inline `<!-- solution -->` markers or a `solution` metadata/frontmatter field, `solutions/` files, and the generated JSON — and treat them as private staff material.
