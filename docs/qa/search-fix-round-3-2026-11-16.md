# Search integration and query-count fix — 2026-11-16

PR #263, `feat/search-everything`, in the user-requested clean root checkout.
Merged `origin/main` at `75402971` into prior head `1428f3e`, including #260,
#267, #270 and #271. No other checkout was changed.

Context: CSG is the learning hub for Code School of Guam (`PRODUCT_VISION.md`).
Learners search readable learning and conversation records; staff search their
authorized records. Acceptance for this follow-up is the combined contract,
populated search results, preserved curriculum hash navigation, deterministic
query counts, and the requested API/web/mobile automated gates. Execution is by
the agent using synthetic local data. Browser/device/deployment journeys are not
part of this follow-up's executed coverage.

## Changes and evidence

- Preserved main's stricter OpenAPI schemas and path parameter declarations.
  Search has no path placeholders and keeps its query parameter declaration.
  `SearchResponse`, `SearchResultGroup`, and `SearchResultItem` are closed named
  components. The response requires `groups`; `partial` remains optional.
  Each group requires `type` and `results`; each item requires all four emitted
  fields. Existing populated authorization-matrix request tests exercise these
  components. Both generated transport twins were regenerated from this spec.
- Kept both sides of the adjacent native test conflict: search destination
  navigation and main's mention-author messaging cases. ContentManagement retains
  `#curriculum-<id>` scrolling after loading and its existing regression that
  preserves expanded module URL state. No new UI behavior was introduced.
- `LessonReadAccess` is identical to main, including `check_many`. Search does not
  participate in the support-queue request. Help-request serialization adds no
  search-related per-record query on the measured lesson-context path.
- SQL tracing found two batched user preloads: help-request students and attention
  enrollment users. For one record their ID lists may coincide; at five records
  they may differ in order. Ignoring cache hits therefore makes one read disappear
  from the count depending on unspecified row order. This is independent of a
  transaction pooler and does not indicate a new per-record query.
- The query counter now counts logical SQL queries, including cache hits. The
  exact 1-versus-5 equality assertion is unchanged. This also detects repeated
  per-record reads that caching previously concealed. A focused regression varies
  only IN-list order: the old helper reports `[1, 2]`, and the new helper requires
  `[2, 2]`. Both new tests fail against the old helper and pass with the fix.
  An outer `uncached` block was investigated but not retained because Rails
  request executor hooks can re-enable caching.

## Verification

Final results are recorded below after completion. Node 22.23.5, Ruby 3.3.7,
`PGGSSENCMODE=disable`, `PARALLEL_WORKERS=1`; task-only local database
`csg_search_263_test`, loaded from schema without application seeds. No local
PgBouncer executable or running process was found, so transaction-mode repetitions
are not run. CI provides the pooler-specific check.

Lifecycle initialization failed with `Invalid machine profile: schema_version
must be 1`. The shared-context read-only check also failed because this account
lacks `~/.config/shimizu-technology/agent-context.json`; synced guidance was read
directly. Resource tracking is explicit: the local database is owned; the
existing PostgreSQL service and dependencies are borrowed. No app server, browser
tab, simulator or container was started. No PR merge, watch, deployment or new
independent review is requested or performed.

Final combined-source results:

- Direct PostgreSQL: the full endpoint query-count file passed 20 consecutive
  runs with randomized Minitest seeds, 28 tests / 144 assertions each (560 tests /
  2,880 assertions total). Support queue was 29 → 29 in every run. Earlier
  diagnostic runs are excluded from these totals.
- API: `OPENAPI_COVERAGE=1` full suite passed, 1,626 tests / 38,745 assertions,
  zero failures/errors/skips. No missing operations, success statuses, shared
  errors or response components. RuboCop passed (636 files), Brakeman passed
  (zero warnings, one existing ignore), and Zeitwerk passed.
- Web: api:check, typecheck, lint, 186 Vitest files / 2,207 tests, build and
  test:bundle passed. Regenerated twins are byte-identical. Final generation was
  followed by api:check, both clients' typechecks, and web build/bundle checks.
- Mobile: typecheck, lint (zero errors, 73 warnings), 135 Jest suites / 1,379 tests
  passed. No native device, Safari or browser journey is claimed.
- No new application runtime code changed beyond integrating main. The regression
  tests and populated search contract ran on the combined source. No final-head
  CI result or new independent review is claimed by these local results.

Cleanup: task database `csg_search_263_test` dropped and absence verified through
`pg_database`. No owned running resources remain. Borrowed PostgreSQL and other
sessions' resources remain available. The branch and requested checkout remain
for lead review. Commit/push only; no merge or watch.
