# Shared API contract — N-1

## Context and acceptance

Base: main `7d520559` (#249), 2026-11-15. Sources: PRODUCT_VISION.md,
API_REFERENCE.md, #247's N-1 proposal, Rails controllers/serializers and existing
integration tests. CSG serves students learning and submitting work, instructors
reviewing it, and administrators maintaining courses. Clerk authenticates both
clients; learning access and evidence remain enrollment-scoped. This change must
preserve those payloads and runtime behavior while removing duplicate transport
shapes. No live data or provider deliveries are used.

Acceptance: migrated notifications/destinations, activity/help/recordings and
learning/submissions compile in both clients; real covered responses validate;
every documented success status is exercised; stale generated copies fail CI;
web build and both native exports resolve types inside their own package.

## Decisions and corrections

The checked-in OpenAPI 3.1 document is hand-maintained. Existing client types seeded
its initial structure, then controller/serializer inspection and request validation
corrected it. There is no continuing TypeScript-to-schema generation step. Rails
response validation is the guard against schema drift, and openapi-typescript is
the only generator. Twin output avoids cross-bundler imports.

Payload/type mismatches corrected without changing the API:

- Help requests include `destination` and `context_destination`.
- Lessons include nullable `repository_name`, `requires_github`, effective submission
  types, media/completion flags and nested video progress metrics.
- Student library recordings differ from staff recording details; they lack staff
  file metadata and include cohort/destination information. Normalized items have
  `item_key`; staff `s3_key`, recording URLs and display sizes can be null.
- Lesson submission briefs include legacy GitHub URLs. Submission detail carries
  `cohort_name`; staff solution/body/video fields can be null.
- Video stream progress omits block id, includes nullable duration, and its envelope
  includes `expires_at`.
- Submission windows use `submissions_close_at`, `submissions_closed` and status;
  native demo fixtures previously used the nonexistent `submissions_open` field.
- Playback input contracts expose optional `watch_credit_version` and cohort context.

Compatibility aliases keep imports stable. Mobile's local submission preview type
allows missing navigation metadata for old caches and locally constructed attempts;
the generated transport schema still requires the actual response keys.

## Verification

Agent-executed affected-flow checks use the existing synthetic Rails request and
web/native component suites: notification destinations, authorized activity,
contextual help, legacy/uploaded recordings, lesson roles and evidence, submission
review, and playback progress. This is a type/schema change; no new visual journey
or device QA is claimed. Native device interaction and Safari are not run on this
headless Mac mini. Build/export checks establish bundler compatibility.

Final gate results and remaining inventory are recorded below before PR handoff.

## Follow-up inventory

At the #249 base the files have 2,141 web lines and 1,200 native lines. After this
migration they have 1,786 and 913 lines, including compatibility aliases/comments.
50 web and 29 native declarations now point to generated schemas. Counting only
remaining handwritten declaration spans (excluding generated aliases, imports,
blank separators and comments outside declarations):

| Remaining category | Web lines | Native lines |
| --- | ---: | ---: |
| Messages and workspaces | 242 | 165 |
| Identity, settings and moderation | 163 | 79 |
| Course/staff management, dashboards and plans | 970 | 397 |
| Other transports and client inputs | 139 | 148 |
| Total handwritten declaration lines | 1,514 | 789 |

Counts are declaration-based, not an estimate of endpoint count. The last category
includes admin content/resource operations, rubric/objective management and local
editor/upload inputs. Some local input/view models should remain client-owned.
Follow-up: migrate message/channel/DM responses first, then admin/cohort management,
weekly/personal plans, detailed staff progress matrices, identity/preferences and
remaining media upload/stream endpoints. Error payloads and full request validation
also remain out of scope. The schema's `paths` is the exact coverage inventory;
closed reusable nested schemas may be used by still-unmigrated endpoints without
claiming that those endpoints are validated.

## Final gates and disposition

Code tested at `30698eb4` (subsequent commit is documentation only), Node 20.19.5
for web and 22.22.3 for mobile, local synthetic DB with `PGGSSENCMODE=disable`:

- API: 1,238 tests / 25,452 assertions, zero failures/errors/skips. All 27 operations
  and 28 success statuses covered with `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1`.
  RuboCop: 536 files, no offenses. Brakeman: zero warnings, one existing ignored
  warning. Zeitwerk passed. Negative schema tests reject missing required fields,
  wrong nested scalar types and extra fields, while nullable fields pass.
- Web: both explicit tsc projects, lint, 163 Vitest suites / 1,840 tests, build,
  test:bundle and test:netlify passed. Dependency audit: no unacknowledged high or
  critical findings. Drift check passed; deliberately appending to the native
  generated twin made it fail as expected; regeneration restored passing parity.
- Mobile: typecheck, lint (zero errors, 33 existing warnings), 127 Jest suites /
  1,151 tests passed. A single Expo export for iOS and Android passed and wrote both
  Hermes bundles to `/tmp/csg-openapi-export`. No device installation is claimed.
- No application servers, tabs, simulators or containers started. The task DB
  `csg_openapi_types_test` was dropped and its absence verified. Shared PostgreSQL
  stays available. The lifecycle helper could not initialize: `Invalid machine
  profile: schema_version must be 1`; cleanup used exact task resource identities.
- Held for lead review per instruction: no merge, watch or deployment verification.
  No independent review is claimed. The branch/checkout remain available for review.

## Fix round 1

Refreshed against PR #250 head `4ebb538`; `origin/main` was already merged.
Acceptance remains unchanged: strengthen the contract and clients without changing
`api/app` payloads. Agent-executed affected-flow checks use isolated request and
component fixtures; browser/device journeys and deployment are outside this round.

- Added populated stream progress (including null counters), student retrieval
  attempts with an active rubric/criterion, staff knowledge-check fields, and
  student watch progress on both recording list routes. The existing submission
  check-run fixture now asserts the populated run in the validated detail response.
- Every response schema must have a validated non-null instance under
  `OPENAPI_COVERAGE=1`; null references and empty arrays do not count. The only
  exceptions are the two request-only input schemas, explicitly listed in the helper.
- Audited guaranteed response keys and made them required. Conditional keys describe
  their role/data/response context. `progresses.video_last_position` and
  `video_total_watched` have defaults but no NOT NULL constraint in `db/schema.rb`;
  stream counters now accept null, matching embedded lesson progress.
- Removed unsent notification actor email and staff recording destination fields.
  Both generated copies carry a source/regeneration warning. Native stream calls
  use the stream envelope, and the web progress wrapper excludes input cohort id.
  Fixtures and local demo/editor previews now supply required transport fields.
- Web typecheck now checks both app and node projects; `npm run check` (used by CI)
  invokes it. Twin destination comments describe normalized import-path parity.
- A documented bodyless success skips body validation only after status validation.
  A regression rejects undocumented 204s. Required-key tests remove expiry/progress
  keys. A temporary serializer probe removed `expires_at` and `context_destination`:
  request validation failed with missing-key errors (11 failures). Both edits were
  restored; the same 56 request tests then passed with 464 assertions. No `api/app`
  changes remain.

API gates: 1,242 tests / 25,474 assertions, zero failures/errors/skips, with full
response and non-null component coverage. RuboCop: 536 files, no offenses.
Brakeman: zero warnings (one existing ignored warning). Zeitwerk passed.
The first run used demo seeds from `db:prepare`, causing unrelated recipient/count
failures; reloading the test schema without seeds resolved them.

Mobile gates: typecheck passed; lint has zero errors and 33 existing warnings;
127 Jest suites / 1,151 tests passed. Web: API drift check, both TypeScript
projects, lint, 163 Vitest suites / 1,840 tests, production build and bundle
budget check passed. Both generated copies match. All 50 response components
(52 total minus two request-only exceptions) have non-null response coverage.

Resource disposition: task DB `csg_openapi_types_fix1_test` dropped and absence
verified; shared PostgreSQL left available. No app servers, browser tabs,
simulators or containers started. Lifecycle initialization still fails with
`Invalid machine profile: schema_version must be 1`, so exact database cleanup
was performed manually. Branch and checkout remain held for lead review;
no merge, watch, live delivery or new independent review was requested.
