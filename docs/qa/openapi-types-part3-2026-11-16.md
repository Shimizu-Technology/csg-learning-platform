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
These do not weaken Rails response validation. Native dashboard previews also keep
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
