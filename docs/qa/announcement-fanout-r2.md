# R-2 announcement fan-out

Orientation, 2026-11-18, base `3a8b3ebf`: CSG Learn serves students,
instructors and admins. Staff publish cohort, staff or global updates; students
must not see draft content. Rails runs on Render with transaction-mode PgBouncer
and ordinary inline jobs; the hourly scheduled tick provides durable recovery.
Sources: `AGENTS.md`, `docs/DEPLOYMENT.md`, announcement controller/model,
NotificationDeliveryService, PushNotificationJob and ScheduledAnnouncementPublisher.
No production deployment or data was accessed. Brain Dump is unavailable on this
host; supplied task context and current repository sources establish this scope.

Agent-executed affected-flow acceptance:

- Publishing commits a durable intent; rollback exposes neither rows nor sends.
- Large audiences create no notification rows in the request.
- Fixed publication recipients get at most one in-app row; retries preserve reads.
- A lost enqueue, overlapping recovery ticks, and a crash after batch inserts
  recover without skipping or duplicating recipients.
- Archive or deletion interrupts further fan-out safely.
- Push waits for fan-out, keeps provider claims, and runs outside publication locks.
- Submission create/grade provider calls run after their locks commit with inline
  jobs; message notifications keep their existing in-lock timing.
- Additive migration round-trips clear pooled caches and leave historical
  publications without intents.

API tests cover the changed backend journey with synthetic fixtures and mocked
providers. No wire types or UI changed; web/mobile gates and device delivery are
outside this PR's affected surface. Real provider delivery and deployment are not
claimed by these tests.

The first full direct run omitted the migration subprocess port override and
therefore hit authentication failures on the borrowed port 5432. Final pooled
gates set `MIGRATION_PROCESS_TEST_DATABASE_URL` to the disposable port 55432;
no prepared-statement mode is disabled to mask test failures.

Implementation: 50-recipient inline limit, 100-recipient background batches.
The publication snapshot costs one recipient-ID query plus a durable row update;
request work still includes reading/storing IDs and is not O(1) in bytes. Large
requests perform no recipient Notification inserts or provider HTTP calls.
In-app rows become available incrementally after publication, and push waits for
the final batch. A lost async execution is recovered after the five-minute grace
at an hourly tick; this can add approximately an hour of notification latency.

## Measurements

Same synthetic cohort publication request, push disabled, cold query cache,
pre-authenticated author. Fixtures assert the exact audience count and grow from
1 to 50 to 500. QueryCounter counts logical SQL including cache hits, excluding
schema and transaction-control statements. These are single ASUS direct-Postgres
samples, not production latency estimates or statistical speedup claims.

| Recipients | Before queries | Before ms | After queries | After ms | Request notification INSERTs before / after |
| --- | ---: | ---: | ---: | ---: | ---: |
| 1 | 10 | 28.0 | 12 | 18.5 | 1 / 1 |
| 50 | 10 | 23.5 | 12 | 25.8 | 1 / 1 |
| 500 | 10 | 126.5 | 10 | 16.5 | 1 / 0 |

Before: the original NotificationDeliveryService from base `3a8b3ebf`, loaded
only for a disposable copy of the same benchmark test (1 test, 17 assertions,
passed). After: the durable snapshot implementation during the diagnostic direct
full run. Temporary baseline files were removed locally and on ASUS before final
gates. For 500 recipients the background worker writes five bounded batches;
query count alone hid the cost of the old single 500-row INSERT.

Shared-guidance freshness automation could not be verified: the read-only helper
failed because `~/.config/shimizu-technology/agent-context.json` is absent. The
applicable synced guidance was read directly. Lifecycle session:
`manual-20261118-070232-5895-37be`; the baseline contains only borrowed T3 and
Postgres listeners. No local app server or browser was started.

Self-review found a parent-deletion race: cohort deletion can call `destroy!`
without the controller's row lock. A prepended before-destroy callback now locks
before dependent notification cleanup, so it cannot miss an uncommitted batch.
A two-connection test blocks deletion behind that batch and verifies no orphan
notification survives. The previous full pooled run was superseded by this fix
and a corrected test-adapter binding for the dedicated async job. The focused
local suite passed 14 tests / 56 assertions before final pooled reruns.

The owned local database `csg_announcement_fanout_test` was dropped after the
focused deletion/adapter checks. Borrowed PostgreSQL was left running. ASUS
resources are owned by the serial `asus-test` wrapper and the gate's exact-PID
PgBouncer trap; source-build scratch directories are removed on exit.

The final ASUS rerun initially returned exit 75 because another builder held the
runner lock. It did not start a competing suite or alter the other builder's
resources; final gates wait for the shared slot.

Reproduce the final gate with:

```sh
asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/announcement-fanout-gate.sh
```

The script preserves port 55432 for both the direct migration subprocesses and
PgBouncer's backend. After repeated exit-75 contention, a task-local copy of the
wrapper changed only `flock -n` to repeated 50-second lock waits, so the actual
job queues for the slot. The shared installed helper was not modified.

A final off-mode run (seed 5041) reported 2265 tests / 43523 assertions with one
failure. A focused local reproduction identified the test's incorrect fixture
transaction expectation: Rails ignores the outer fixture transaction and queues
when the inner application transaction commits. The assertion now verifies no
enqueue inside that transaction and one enqueue after commit. The focused suite
then passed 14 tests / 57 assertions; the local DB was dropped again. A diagnostic
same-seed run was stopped by its validated task-owned Rails PID after reproducing
the test expectation locally. Final runs capture output and repeat failures at
the end, with a sed fallback because ASUS has no rg.

## Accepted final gates

ASUS, PgBouncer 1.24.1 transaction mode, round-robin six-backend pool, seed 5041:

- Prepared statements off: **2265 tests, 43525 assertions**, zero failures,
  errors or skips (336.304 seconds).
- RuboCop: **783 files**, no offenses. Brakeman: **zero active warnings**,
  one pre-existing ignored warning. Bundler-audit: no vulnerabilities.
- Prepared statements on: running; not yet accepted.

Final off-mode after-only request samples for 1 / 50 / 500 recipients were
17.4 / 34.7 / 36.3 ms and 12 / 12 / 10 queries. These are pooler samples, separate
from the paired direct-Postgres before/after measurements above.
