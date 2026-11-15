# W11 PR 11.4: pooler safety

Base: `aa93de76` (main, PR #252 merged). API/config-only change; no UI behavior
or schema changes. Agent-executed acceptance on the Mac mini, local PostgreSQL
16 and PgBouncer 1.24.1; production and Render settings were not accessed.

CSG Learn serves students, instructors and admins with learning content,
grading and communication (`docs/PRODUCT_VISION.md`, `AGENTS.md`). The relevant
journey is deploying an API update without losing migration serialization or
routing runtime queries around the transaction pooler. Current code has one
primary database, inline jobs, a pool of `RAILS_MAX_THREADS` or five and a Docker
entrypoint calling `db:prepare` (`database.yml`, `puma.rb`, Dockerfile). The
runbook describes native Ruby as well; no render.yaml is checked in, so the lead
must verify the live command. Current ActionCable is async, not a second database
connection (`config/cable.yml`); no cable settings change here.

## Required acceptance

- Production keeps its pooled runtime URL, explicit prepared-statement policy,
  advisory locks and thread-based pool whether the migration secret exists or not.
- The migration subprocess uses the direct secret when present; absent/blank
  falls back to the existing URL. Recognized pooled fallback is rejected before
  schema work. Invalid overrides fail with redacted output before Rails boots.
- Direct migration configuration passes the guard; pooler host and query markers
  fail when session advisory locks are enabled. Manual migration tasks are guarded.
- The full API suite works through a transaction pooler with the selected policy.
  CI verifies both production config and the live pooled adapter's decision.

Config/guard tests cover these cases without network or customer data. Full API
suites use only `csg_pooler_safety_test`, a task-owned local database. UI and real
production deploy acceptance are not run: this change has no UI, and dashboard
secret setup/deploy belongs to the lead.

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
disables prepared statements; SQL parameter binding is retained.

## Local results and limits

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

Final source on `fix/pooler-safety`, committed after these gates without code
changes:

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
