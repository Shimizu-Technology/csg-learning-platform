# Content studio — W5 PR 5.2

Implemented against main `cc48ec0d`, with application code tested at `d2566a73`.
Execution owner: implementation agent. All fixtures are synthetic, created in the
local signed-in QA harness. No production services or data were used.

## Context and acceptance

The platform is Code School of Guam's shared learning hub (PRODUCT_VISION.md).
This task changes the staff content library, not learner delivery or staff status.
The approved reference is `docs/design/2026-11-platform-redesign/02-content-library.html`.
The starting library fetched every curriculum's details and rendered every course
and learner-file form on one page. Admin authoring and instructor read-only access
must remain distinct. Existing publication, archive, delete and reorder safeguards
must remain in force.

Acceptance: Active/Draft/Archived groups, search and cohort filtering, selected-only
detail loading, module editing/reordering, sortable lesson tables, saved URL context,
real lesson/editor/preview links, creation/import navigation, shared confirmations,
self-paced sequence defaults, scheduled calendar views and phone drill-down.

## Implementation

- Curriculum summaries supply module counts; only the selected curriculum's tree
  is loaded. Cohort summaries supply usage and delivery information.
- Left-rail curriculum search and filters are URL-backed. Debounced existing
  search API results also expose matching modules and lessons across the library;
  its existing result limits and partial-result behavior still apply. The outline
  has a separate search scoped to the selected curriculum.
- Name, description and status controls retain version checks and existing guards.
  Module editing opens inline. Reordering retains drag and keyboard controls.
  Curriculum deletion uses the existing guarded DELETE endpoint.
- Sequence and calendar share `contentStudio/LessonTable.tsx`. `LessonRow` exposes
  an `actions` slot for W5.3 move/duplicate work. No lesson move, duplicate, editor
  grant or copy-before-edit behavior was added.
- Learner files render once in the right pane or phone drill-down. Package import
  is a single page action. The temporary, unsaved Add Week action was removed;
  calendar weeks come from saved lessons and scroll horizontally with a cue.
- Creation selects/focuses the new curriculum, opens/scrolls the new module, or
  opens the new exercise editor. Import selects the returned curriculum ID.

## Verification

Required web gate passed: typecheck, ESLint, Vitest (186 files, 2,213 tests),
production build and test:bundle. `api:check` also passed. No API implementation,
schema or endpoint changes were made; the full Rails gate was not required/run.
Impeccable advisory scan returned `[]` for the library and learner-file panel.

`content-studio.spec.ts`: 12/12 Chromium scenarios passed on the synthetic harness:

| Journey | 1280 | 390 |
| --- | --- | --- |
| Admin, light and dark: calendar/sequence, anchors, editor return, search, confirmation cancel, cohort filter, files | passed | passed |
| Instructor, light and dark: browse, preview, editor return, search, cohort filter, files; no authoring controls | passed | passed |
| Create curriculum → create module → create exercise → editor | passed | passed |
| Import → selected draft → reload retains selection | passed | passed |

The browser scenarios verified selected-only initial requests, focus on selection,
open-module state after editor return, self-paced defaults, phone pane visibility
and zero horizontal document overflow. Additional unit coverage verifies status
ordering, selected-only fetches, saved Week 14, cancel/error paths, deletion refusal,
inline editing and import callbacks carrying the saved curriculum ID. Existing
module keyboard/drag reorder and authoring-authority coverage remains passing.

Shared preview checks additionally exercised phone selection, self-paced sequence,
files-pane focus, instructor permissions, desktop three-column sizing (240/428/260)
and inline editing. Initial browser test failures came from ambiguous locators and
an empty exercise fixture hitting required-content validation; corrected fixtures
and locators passed on rerun.

Not run: real phone hardware/keyboards, Safari/WebKit (unsupported on this host),
screen reader operation, production Clerk/S3 uploads, provider delivery or release
verification. Chromium viewport coverage does not establish native mobile behavior.

## Follow-up and ownership

Curriculum duplication has no existing endpoint and remains a follow-up; no
placeholder action pretends to duplicate content. Lesson move/duplicate and grants
remain W5.3's scope. Shared-row extensions should use the `actions` slot.

The requested checkout/branch was used and retained for lead review. Main was
fetched and merged before push. No merge or PR watch was requested or performed.
The installed lifecycle helper rejected its machine profile with
`schema_version must be 1`; the QA harness's exact PID identities and database
ownership records were used instead. The owned preview tab was closed, harness
servers stopped and its `csg_qa_*` database dropped. The pre-existing account
Postgres service was left running.

## Fix round 1

Review fixes made on `feat/content-studio` from `6cf861d`; requested fetch,
checkout, fast-forward pull and merge of origin/main were already up to date.
Execution owner: implementation agent, Node 22.23.5, local synthetic fixtures.
Acceptance covers the two P2 regressions plus the listed authoring, focus,
navigation, search and role-specific usage corrections.

- Detail refreshes use an AbortSignal, abort superseded requests and reject
  responses for a different current selection. Initial deep links request one
  detail tree. Reloads retain focus; successful structure edits restore Edit focus.
- Unknown cohort/curriculum IDs are replaced away after the relevant summaries
  load. Curriculum/module hashes scroll once and are consumed with replace history.
  Choosing another curriculum resets its explicit view choice.
- Search filters displayed lessons while authoring placement uses the complete
  module. Search results can be collapsed. Archived Review links retain Content
  return context; lesson titles use RecordLink again, including peek cards.
  Repository-plus-live-URL submission badges remain distinct.
- The actions menu closes on Escape/outside pointer down, contains no duplicate
  learner-files action, and the search shortcut respects dialogs/handled events.
- The rail uses the existing slim accessible-cohort endpoint. Additive
  curriculum_id/course_delivery fields support its filters and accessible links.
  Curriculum index summaries add global cohorts_count/course_delivery_modes, so
  inaccessible cohorts still contribute to usage and auto view without exposing
  their details. OpenAPI and both generated clients were updated.
- CI unit tests now cover the held-response race, invalid URLs, deep-link request
  count, search placement/toggling, global usage, shortcut/menu guards, view reset,
  Edit focus, one-time hashes, creation jumps and editor return context.

Validation: web lint, typecheck, Vitest (186 files, 2,228 tests), Netlify checks,
build, test:bundle and api:check passed. Changed Ruby files passed RuboCop.
The advisory Impeccable scan returned no findings. Focused API/contract tests:
31 runs, 200 assertions, no failures/errors/skips.

Chromium harness: 16/16 scenarios passed at 1280 and 390, including admin and
instructor light/dark flows, creation/import/editor return, the held Program
reload followed by selecting Self paced, and invalid cohort/query/hash IDs.
The shared preview separately confirmed unknown cohort/curriculum recovery.
An earlier run hit navigation during source editing; rerunning without UI edits
passed. The race test now chooses an available move control so persisted fixture
order does not stall later runs.

The first full API run caught usage fields accidentally added to detail/mutation
responses. They were restricted to index summaries; focused contracts then passed.
Final full API contract coverage results are recorded below.

Limits remain real devices, Safari/WebKit, production providers and deployment.
The shared preview tab was closed; harness PID identities were verified and its
servers/database cleaned. The lifecycle helper still rejects the installed
machine profile (`schema_version must be 1`), so exact harness ownership records
were used. Borrowed Postgres and shared services remain running. PR stays open;
no merge or watch was performed.

Final full API run: `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1 bundle exec rails test`
passed with 1,627 runs, 38,757 assertions, zero failures/errors/skips, including
complete documented success-response/schema/shared-error coverage. Its isolated
`csg_content_studio_fix1_test` database was dropped after completion.
