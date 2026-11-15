# W11 PR 11.4: pooler safety

## Round 1 context and acceptance

Branch `fix/pooler-safety`, updated from `origin/main` at `ba529b85` before
round 1. CSG Learn serves students, instructors and admins with learning content,
grading and communication (`docs/PRODUCT_VISION.md`, `AGENTS.md`). This change
protects the deployment/schema-maintenance journey; it changes no UI or schema.

The lead verified Render's native Ruby runtime, root `api`, build
`bundle install && bundle exec rails db:prepare`, start
`bundle exec puma -C config/puma.rb`, no pre-deploy command or disk. The runtime
URL is pooled, and the optional migration secret is currently absent. These are
lead-supplied production facts; this implementation agent did not access Render
or production data. No dashboard change is required.

Required agent-executed acceptance (local PostgreSQL 16 / PgBouncer 1.24.1):

- Matching direct secret selects the direct connection with locks on; wrong
  database/user/endpoint, pooled or malformed secrets fail with redacted errors.
- Missing secret plus pooled runtime URL warns on stderr and disables locks only
  for the migration process. This explicitly assumes a single migration instance.
- Direct runtime URL keeps migration locks on. Fresh runtime processes keep their
  original URL, lock setting and pool size, with prepared statements disabled.
- Real production-mode `bin/rails db:prepare` and the exact native migration
  command `bundle exec rails db:prepare` work. An initialized DB receives no
  seeds. Manual status, rollback and migrate work with and without the secret.
- Schema load, reset and generated migration tasks have the guard first, before
  environment/DDL/drop prerequisites. `bin/migrate` delegates to the same path.
- Full direct and transaction-pooler API suites and the requested static gates
  pass. The standalone CI config-test invocation is removed because the full
  suite already includes it; the live pooler adapter assertion stays.

Production-path tests use `pgbouncer=TRUE` on a local URL; Rails strips that
non-libpq option. Each test creates and drops its own database and uses no real
credentials. Unit cases cover Rails boolean strings `false`, `FALSE`, `TRUE`.
UI/mobile/browser and real deployment verification are not run: no UI changes
and no production access is needed for this handback.

## Round 1 results (2026-11-16)

Tested source: round 1 changes on merged base `8c203e94`, committed immediately
after these gates; only documentation changed after execution.

- Direct full API suite: **1328 tests, 36584 assertions**, no failures, errors
  or skips (97.92s).
- Transaction-mode PgBouncer full suite: **1328 tests, 36585 assertions**, no
  failures, errors or skips (81.95s). Live adapter verified port 16432 and
  prepared statements disabled before the suite.
- RuboCop: **555 files**, no offenses. Brakeman: **zero warnings**, one existing
  ignored warning. `zeitwerk:check` and `git diff --check`: passed.
- Required production subprocess acceptance: passed for valid secret, mismatched
  secret (before schema load), absent secret, initialized DB without seeds,
  exact native migration command, manual status/rollback/migrate and fresh
  runtime adapter with locks on. `bin/migrate` also passed direct-secret and
  pooled-fallback smoke checks. No schema migrations or UI files changed.
- The first focused runs found test harness issues (Ruby keyword-hash syntax,
  combining Rails runner with Rake commands, and ActiveModel require ordering);
  these were corrected before the passing full suites. No tests were excluded.

Resource cleanup: owned PgBouncer PID **62591**, command
`/tmp/pgbouncer-1.24.1/pgbouncer -d /tmp/csg-pooler-round1.ini`, was identity-checked
and stopped. No listener remains on its port 16432. Owned
`csg_pooler_safety_test` and all subprocess DBs were dropped; a local database
catalog query found none remaining under that prefix. Borrowed PostgreSQL PID
97858 was left running. No browser, simulator, server or container was started.
The lifecycle helper failed with `schema_version must be 1`; no profile exists
at its configured location. The shared-context read-only check also failed
because `~/.config/shimizu-technology/agent-context.json` is absent. Applicable
synced skill files were read directly; no shared setup was changed. Exact
resource ownership was tracked manually in `/tmp/csg-round1-resources.txt`.

This is implementation handback for the lead. PR #255 remains open; no merge,
watch, dashboard changes or deployment was performed. The earlier CodeRabbit
changes-requested review covered `a9e004d`, so final-head review is still pending.

## Prepared-statement decision

[Neon's current documentation](https://neon.com/docs/connect/connection-pooling#neon-pgbouncer-configuration)
provides `max_prepared_statements=1000`; its
[PgBouncer 1.22 announcement](https://neon.com/blog/pgbouncer-the-one-with-prepared-statements)
establishes protocol support. Neither is a measurement of our endpoint's exact
binary. Disabling is conservative despite that support, rather than a claim that
Neon lacks the feature.

An initial local full-suite experiment enabled protocol statements against
PgBouncer 1.24.1, transaction mode, round robin, six backends, tracking=1000.
A protocol probe passed reuse across backends and colliding client names. The
full suite then returned 1326 tests, zero failures and four errors (97.46s):
`BackfillInstructorCommunityMembershipsTest`, `RecordContentAvailabilityTest`,
`AddPausedAtToEnrollmentsTest` and `AddSourceToMessagesTest` reported aborted
transactions after schema round trips. Client cache resets did not prevent them.
We do not exclude those tests or change old migrations. Production explicitly
disables prepared statements. Rails safely interpolates quoted literals; PostgreSQL logs can contain those literal values.

## Original implementation measurements (before round 1)

A bound ActiveRecord lookup (`User.where(id: id).pick(:email)`) was measured
through the same local transaction pooler, query cache disabled, one synthetic
user, 100 warmups then 2000 timed queries per sample. Five samples per mode
alternated order. A stabilized repeat gave on: 0.1786/0.1300/0.1333/0.1338/0.1362
ms/query (median 0.1338), off: 0.1395/0.1370/0.1403/0.1387/0.1431 (median 0.1395).
Off added 0.0057 ms/query, or about 0.057 ms for ten such queries: negligible for
this low-volume app. An earlier run was noisy (on median 0.7904, off 0.4950),
so these are local warm-query observations, not a production SLA or a guarantee
for complex queries. No benchmark dependency or production query was added.
The synthetic row was deleted.

Original head `a9e004d` passed these gates; they do not establish review or test coverage of round 1:

- Full direct PostgreSQL suite: 1328 tests, 36564 assertions, zero failures,
  errors or skips (77.50s).
- Full transaction-pooler suite, prepared statements disabled: 1328 tests,
  36565 assertions, zero failures, errors or skips (93.28s).
- RuboCop: 554 files, no offenses. Brakeman: zero warnings (one existing ignored
  warning). Zeitwerk eager-load check and `git diff --check`: passed.
- Real `bin/migrate` smoke checks passed with a direct fallback and with an
  explicit direct override while the parent runtime URL was a synthetic pooler.
- The first disabled-mode suite had one assertion failure: Rails preserves URL
  boolean options as strings before adapter casting. The config policy test was
  corrected to use a synthetic URL without that override, then the whole suite
  was rerun successfully. No application tests were excluded.

The pooler was started as exact PID 43316 and its identity was checked before
SIGTERM cleanup; it no longer exists. The disposable test DB was dropped.
Existing PostgreSQL stayed running. The lifecycle helper could not start because
the installed machine profile failed with `schema_version must be 1`; ownership
and cleanup were recorded manually. No new servers, tabs or containers remain.
The branch is retained for the lead; no merge or deployment was performed. No production traffic, provider sends,
UI browser, simulator or Docker resources are required.
