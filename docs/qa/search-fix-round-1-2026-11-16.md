# Search PR #263: fix round 1

## Context and acceptance

This revision updates `feat/search-everything` from `de46607` with main at
`e7927777` (#262 agent tokens, #265 mobile navigation, #266 learner progress).
The root checkout is the implementation workspace; the lesson-editor worktree
was not accessed. Sources: `docs/PRODUCT_VISION.md`, `AGENTS.md`, the PR's four
CodeRabbit inline comments, `ModulesController#authorize_module_read!`,
`LessonReadAccess`, and enrollment read-cutoff methods.

CSG learners use search to reopen learning materials and conversations. Staff
also search students and operational records. Results must preserve enrollment,
release, read-cutoff, channel visibility, message deletion, blocking, and feature
rules. Staff access must avoid loading whole matching tables. Destinations must
remain usable after main's navigation changes. Clerk authentication and existing
REST destination contracts remain in use.

Agent-executed acceptance covers both block directions and own messages, deleted
messages, staff-only channels, draft recordings/announcements, empty and locked
modules, enrollment removal, paused lesson/recording/resource cutoffs, SQL result
limits, learner pagination beyond denied matches, decoded entities and exact
resource ranking, and pooler-safe timeout recovery with partial completed groups.
The larger-set test inserts 1,000 matching lessons, checks a 2.5-second sanity
bound, and verifies constant staff query counts after another 100 inserts.

Frontend acceptance uses component tests for stale asynchronous responses,
independent Recent revalidation, result-count announcements, Close-button focus,
and mobile member-name DM destinations. ContentManagement scrolls to a curriculum
fragment after loading and on hash changes. Resources retains its query control
for URL-seeded filters even with four or fewer resources.

## Verification and limits

- Search and migration regression tests exercise real local PostgreSQL, including
  actual statement cancellation and repeated concurrent index migration retries.
  Index tests preserve the correct index OID and replace same-named indexes with
  the wrong method, expression, or predicate.
- Final full API run: 1,555 tests, 38,259 assertions, no failures/errors/skips.
  Web: 179 files, 2,135 tests passed. Mobile: 133 suites, 1,319 tests passed,
  plus the expanded 14-test message-context suite including the new DM regression.
  Mobile lint passed with 38 warnings; Brakeman reported no warnings (one ignored).
  The Impeccable advisory scan returned an empty findings list.
- Full API gate: `OPENAPI_COVERAGE=1`, `PARALLEL_WORKERS=1`, Minitest, RuboCop,
  Brakeman, and Zeitwerk. Web gate: Node 22 typecheck, ESLint, Vitest, build, and
  bundle check. Mobile gate: Node 22 typecheck, ESLint, and Jest.
- Automated coverage is component/API coverage. No browser, native device,
  simulator, WebKit, or deployed-environment walkthrough was performed here.
  This Mac mini has no supported native simulator or WebKit screen session.
- Test databases are task-owned: `csg_search_263_fix_test` and
  `csg_search_263_migration_test`, both local with `PGGSSENCMODE=disable`.
  Both are dropped after verification. The shared PostgreSQL server remains up.
- No app server or browser tab was started. Lifecycle initialization failed with
  `Invalid machine profile: schema_version must be 1`; exact database ownership
  and cleanup are tracked directly. Shared services are left unchanged.

The PR remains open for independent re-review. No merge or watch is authorized
for this revision. Final counts and check outcomes are recorded in its
“Fix round 1” section.
