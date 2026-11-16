# Setup wizard CI adapter regression — 2026-11-16

Scope: PR #275, `feat/setup-wizard`, based on `8a165d2d`. Agent-executed backend affected-flow checks; synthetic users, cohorts, and stubbed Clerk/email providers only. No UI changes or real email delivery.

CSG staff enroll learners and send invitations from the cohort roster. The dispatch service must preserve enrollment when a provider fails, report inline delivery results, and retain retries on a queued backend. Sources: `docs/PRODUCT_VISION.md`, `UserInvitationDispatchService`, `SendUserInviteEmailJob`, and the enrollment integration tests.

## Diagnosis and changes

- CI direct-Postgres job 133132430989 used seed **37107**; transaction-pooler job 133132430807 used seed **8466**.
- Before the fix, the full direct-Postgres run with seed 37107 reproduced the setup-wizard failure (1,729 tests, one failure). A focused run with workers unset reproduced both reported failures (44 tests, two failures).
- `ActiveJob::TestHelper` overrides the effective adapter independently of `queue_adapter=`. The setup test changed configuration without replacing that override; the after-commit test changed the base adapter while a job-level override could remain in effect. The job retry test restored the effective adapter instead of the raw test override, potentially retaining a stale test adapter.
- Tests now scope explicit per-job adapters and restore the previous raw override, including nil. Production failure isolation reads the instance's effective `queue_adapter` (which delegates to its job class), rather than a configured adapter name.
- New dispatch regressions deliberately disagree with the configured adapter: effective inline sends immediately and isolates provider exceptions; effective test queues first and retains a retry when its provider fails.

## Acceptance and evidence

| Case | Result | Evidence |
| --- | --- | --- |
| Bulk and single enrollment isolate inline provider failures, preserve later rows, and deduplicate sends | Passed | `SetupWizardTest`, focused run seed 8466 |
| Enrollment invitation sends after commit and does not send on rollback | Passed | `SendsAfterCommitTest`, explicit job adapter |
| Effective inline and test adapters control dispatch and failure/retry behavior | Passed | Two new service tests; configured adapter deliberately differs |
| Runtime-configured inline without TestHelper isolates provider failure | Passed | Standalone Rails runner with `ACTIVE_JOB_QUEUE_ADAPTER=inline`; synthetic user rolled back |

Focused run: **51 tests, 311 assertions, zero failures/errors**. Full API RuboCop: **657 files, no offenses**. Brakeman: **no warnings**. Bundler audit: **no vulnerabilities**.

All three final full API runs passed: **1,731 tests, 39,406 assertions, zero failures/errors/skips each**.

| Seed | Workers | Additional environment |
| --- | --- | --- |
| 37107 (direct CI) | `PARALLEL_WORKERS=1` | `CI=true`, `OPENAPI_COVERAGE=1` |
| 8466 (pooler CI) | `PARALLEL_WORKERS` unset (10 processes) | `CI=true`, `PGGSSENCMODE=disable` |
| 19371 | `PARALLEL_WORKERS=1` | `CI=true`, `OPENAPI_COVERAGE=1` |

These runs tested the final source changes on top of `8a165d2d`; only this QA record was completed afterward. Final diff review found no material issue. Remote checks and review of the new head remain CI/reviewer work; no merge or watch was requested.

Local environment: Mac mini, Ruby 3.3.7, Rails 8.1.4.1, PostgreSQL 16, CI eager loading enabled. All databases are branch-specific local test databases. The default ten-process run initially crashed in the native pg extension during post-fork connection setup, before executing tests; `PGGSSENCMODE=disable` allowed the run to complete. An extra overlapping local attempt was discarded; final full runs are serialized. PgBouncer is unavailable locally, so transaction-pooler transport is left to CI. Browser/device journeys were not run for this backend test-isolation change.
