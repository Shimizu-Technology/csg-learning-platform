# Shared API types part 3 — bounded migration

## Context and acceptance

Base: `9ba95d91` (#257), 2026-11-16. Sources: `PRODUCT_VISION.md`,
`docs/qa/openapi-types-2026-11-15.md`, current Rails controllers and projections,
and populated request regressions. CSG's students use Today to continue assigned
learning; staff use attention and progress summaries and manage curricula/modules.
Clerk identity and enrollment-scoped access remain unchanged. Installed TestFlight
47 payloads must remain compatible. No files under `api/app` change.

This takes the explicitly allowed smaller scope: #257's three follow-ups,
dashboards/Today (including weekly and personal plan projections), curriculum and
module management, and users list/detail/create/update. Course offering/checkout,
cohort/roster/enrollment management, staff progress matrices and the remaining
admin transports remain follow-up work. This is not a claim that N-1 is finished.

Agent-executed acceptance uses synthetic Rails requests and existing web/native
component suites. Required: production JSON and empty-body 404s, no conditional
placeholder on required keys, no session-only flags inherited by users#index,
all documented operations/statuses and non-null response components exercised,
generated twin parity, and all requested automated gates. UI behavior is unchanged;
no browser/device journey, Safari check or installed TestFlight test is claimed.

## Contract decisions

- Production Rails 404 JSON requires `status` and `error`; detailed exception
  middleware may also supply `exception` and `traces`. Without JSON Accept the
  production response can be empty. Shared error validation runs only for JSON.
- Removed the stale role-conditional descriptions from required keys recursively;
  the contract regression visits nested schemas as well as named components.
- Users management has its own closed `UserListItem`, plus enrollment and opt-in
  pagination shapes. It does not inherit session `community_policy`, `is_admin`
  or `is_staff` fields.
- Curriculum/module mutations emit summaries, while show includes collections.
  Module-show editor blocks differ from lesson-detail blocks. They have a separate
  schema rather than falsely requiring lesson-only video/rubric metadata.
- Dashboard fields are conditional on student/staff and enrollment contexts, with
  descriptions on optional fields. Shared user and nested populated projections
  are validated. Attention rows include invitation/presence and weekly metrics.
- Self-paced weekly `course_overview.next_lesson` can contain the personal-plan
  projection, including required/available/completed/review metadata.

## Local models and remaining declarations

Client snapshots/previews derive their scalar and nested field types from generated
schemas. `Preview<T, K>` retains explicitly missing newer metadata for old caches
and synthetic demos: attention actions/reasons/rows, personal-plan lessons and
submission deadlines, weekly lesson review status, student dashboard modules,
lesson metadata, action items, announcements and recently graded navigation ids.
These do not weaken Rails response validation. Weekly-plan preview redos/recording cards may omit navigation ids. Native dashboard previews also keep
local office-hour cards and resource models. The native module mutation adapter
allows a read of `lessons?: never` for existing fallback code: mutations do not
send lessons.

`UserListItem`'s web UI projection permits absent role flags because an existing
workspace discovery mapper reads them. `DirectoryUserSummary` permits the same
absence when user discovery combines session and users#index sources.

Inputs remain local: lesson/editor, exercise, module, objective/rubric creation,
learning plan, submission, attachment/upload and thread-window options. Optimistic
messages, pending attachments, realtime events, worker messages and cache envelopes
also remain local. Existing compatibility aliases stay where callers use them.

Remaining handwritten response interfaces are enumerated, by file and declaration,
in `web/scripts/transport-types-baseline.json`. They include cohort summaries/home/
student views, enrollment and assignment management, announcements, resources,
private meetings, support interventions/recovery, learning insights, content block
management and staff progress/video matrices. Native objective/snippet responses
and corresponding admin operation envelopes remain for a later migration.

The TypeScript AST heuristic in `transport-types.mjs` scans both clients' source:
all interfaces in the canonical transport declaration files, plus interfaces named
`*Response` or `*Payload` elsewhere. It skips generated files, tests and fixtures.
`api:check` rejects declarations absent from the baseline; new local models in the
canonical files need an explicit reviewed exception. It does not detect arbitrary
inline fetch generics, aliases with object literals, or responses with unrelated
names outside those files. The baseline is a ratchet for unfinished work, not proof
that handwritten transports have reached zero. Its detector has a regression test.

## Verification and disposition

Gate results are recorded below after execution. The lifecycle helper failed at
initialization (`Invalid machine profile: schema_version must be 1`). The only
runtime resource created is local database `csg_openapi_types3_test`; shared
PostgreSQL is borrowed and stays available. No application servers, browser tabs,
simulators or containers were started. Task worktree:
`/Users/agent/work/csg-openapi-types-3`, branch `feat/openapi-types-3`.

Held for lead/repository review as requested: no merge, watch or deployment.


The canonical type files retain 852 web interface declaration lines and 315 native
interface declaration lines (including inputs, local events and unfinished
transports; excluding schema-derived aliases). The guard baseline is the precise
remaining interface inventory. There are 104 documented operations, 112 success
statuses and 157 components, with two request-only coverage exceptions.

Final gates on source `58498e2b` (last source edit only changes native array type
syntax to satisfy ESLint; native typecheck/lint rerun after that edit):

- API: 1,360 tests / 37,840 assertions, no failures/errors/skips, with
  `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1`. No uncovered operations, statuses,
  shared errors or response components. RuboCop: 561 files, no offenses.
  Brakeman: no warnings, one existing ignored warning. Zeitwerk passed.
- Web (Node 20.19.5): API drift check and AST detector regression, both typecheck
  projects, ESLint, 174 Vitest suites / 1,994 tests, build and bundle check passed.
- Mobile (Node 22.22.3): typecheck, lint (zero errors, 30 warnings in unchanged
  code), 129 Jest suites / 1,171 tests, and iOS Expo export passed. The export is
  `/tmp/csg-types3-ios-final`. No device build/install or Safari test was run.
- All changes remain types/contracts/tests only. No new unsafe casts or runtime
  API changes. Page changes remove local type declarations or swap type imports;
  colour classes are untouched. `origin/main` was fetched and merged before push.
- Database `csg_openapi_types3_test` dropped; its absence verified through
  `pg_database`. Task dependency symlinks removed. No owned running resources
  remain; shared PostgreSQL was left available. The clean task worktree and
  branch remain for PR review. No merge/watch or independent reviewer is claimed.

## Fix round 1

Refreshed the clean PR worktree from `d12b552f` and merged `origin/main`
`e7927777`, including #262–#266. Checkout from the requested project directory
was refused because this branch already belongs to `/Users/agent/work/csg-openapi-types-3`;
all edits and checks use that existing isolated worktree. The API implementation
matches main; no serializer/controller payload changes were made.

Agent-executed acceptance: populated request fixtures cover alumni weekly library
mode, unenrolled weekly/dashboard responses (including absent resources), weekly
events and future unlocks, and staff dashboard with no accessible cohorts. The
full coverage gate must exercise every named response component with non-null
data. Browser/device journeys, Safari, installation and deployment remain not run.

- Required `learner_status` on dashboard lessons, weekly lessons and personal-plan
  lessons; retained #266's lesson-page status, counts and next-step fields.
  Local cache/demo projections still permit pre-AS-10 lessons.
- Restored optional native dashboard resources and an empty demo fallback.
- Removed stale staff-only descriptions on the four required LessonSummary keys.
  The recursive guard rejects `Included only`, `Included for` and other `only`
  wording on required properties; a regression checks four variants and ensures
  optional properties may retain their conditional descriptions.
- Named weekly event/unlock/redo/recording items, dashboard action/resource/graded/
  purchase items and personal-plan collection items, so empty arrays cannot satisfy
  their component coverage. Staff has a separate closed cohort schema requiring
  features and all three counts. Cohort start dates, announcement authors and
  course_access no longer accept null. Updated the web progress adapter and native
  staff demos to match those guarantees. Regenerated both transport twins.
- Web createUser now returns UserUpdateResponse. Native users, studentContext and
  StudentContextEnrollment derive from UsersListResponse, UserDetailResponse and
  UserEnrollment.

Remaining users scope, explicitly deferred: DELETE `/api/v1/users/{id}`, PATCH
`/api/v1/users/{id}/unarchive`, and POST `/api/v1/users/{id}/resend_invite` have no
OpenAPI entries. Their web inline response generics are not migrated. The AST
ratchet still detects interfaces only; arbitrary inline fetch/request generics
and object aliases remain outside its detection. Broadening it requires a separate
inventory and reviewed baseline of those transports, rather than silently claiming
coverage from interface removal.

Resource tracking: lifecycle initialization again failed with `Invalid machine
profile: schema_version must be 1`. Task database: `csg_openapi_260_fix1_test` on
local PostgreSQL. Task dependency links point to the baseline checkout's installed
packages. No servers, browser tabs, simulators or containers started. Final gate
results and exact cleanup are recorded below.

Final round-1 gates on the combined source (merge parent `e7927777`; committed
with this record), Node 20.19.5 web / 22.22.3 mobile:

- API: `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1` full suite passed: 1,542 tests,
  38,114 assertions, zero failures/errors/skips. All 104 operations, 112 success
  statuses, shared errors and 169 response components exercised (171 components
  total, with the same two request-only exceptions). RuboCop: 622 files, no
  offenses. Brakeman: zero warnings, one existing ignored warning. Zeitwerk passed.
- Web: api:check, typecheck (both projects), lint, 177 Vitest files / 2,125 tests,
  build and test:bundle passed. The advisory Impeccable scan returned `[]` for
  the changed progress adapter. No UI journey or visual acceptance is claimed.
- Mobile: typecheck, lint (zero errors, 36 warnings), 133 Jest suites / 1,318
  tests and iOS Expo export passed. Export artifact: `/tmp/csg-260-fix1-ios`.
  No native device installation or Safari execution was performed.
- Cleanup: dropped `csg_openapi_260_fix1_test` and verified its absence. Removed
  only the two task-created dependency symlinks. Shared PostgreSQL and baseline
  dependencies remain available. No owned running resources remain.
- Held as instructed: commit/push and update PR #260; no merge, watch, deployment
  or new independent review. Final-head CI/review remains for the lead.

## Path parameter follow-up (#260)

Base `a9823d7b`, 2026-11-16, in the requested clean checkout
`/Users/agent/work/csg-learning-platform-d` on `feat/openapi-types-3`.
Acceptance is limited to contract validity and generated client types for existing
curriculum, module and user management endpoints. No runtime/UI behavior changes.

- Audited all 35 templated paths. Only the four reported paths lacked declarations;
  each now declares its required integer identifier at path-item level.
- Added `OpenapiContractTest` coverage for every placeholder in each operation,
  accepting declarations at either level. A synthetic nested-path regression
  checks missing declarations on one operation, wrong names, query parameters and
  non-required parameters. The document guard failed against the original spec
  with all 10 affected operations and passed after the fix.
- Added offline whole-document validation using the installed json_schemer 2.5
  OpenAPI 3.1 document meta-schema. Filtered the coverage inventory to HTTP methods
  so path-item parameters are not mistaken for operations (still 104 operations).
- Regenerated both identical client twins with Node 22.22.3. Web api:check and
  typecheck, mobile typecheck, and API RuboCop (622 files) passed. The focused
  contract suite passed: 10 tests, 59 assertions, no failures/errors/skips.
- No browser, device or deployment checks were run; this change affects only the
  spec, generated types and contract tests.

The lifecycle helper could not initialize (`Invalid machine profile: schema_version
must be 1`). The shared-context read-only check also failed because this host lacks
`~/.config/shimizu-technology/agent-context.json`; canonical synced guidance was
read directly. No shared guidance or machine configuration was changed. Shared
local PostgreSQL is borrowed; the only created resource is test database
`csg_openapi_260_path_parameters_test`. No app servers, tabs or containers started.

Final API coverage gate passed on this follow-up source: 1,545 tests, 38,124
assertions, zero failures/errors/skips with `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1`.
No uncovered operations, statuses, shared errors or response components remained.
Dropped the task database and verified its absence in `pg_database`. No owned
runtime resources remain; shared PostgreSQL remains available. The branch and
checkout are retained as requested. No merge, watch or new review is claimed.
