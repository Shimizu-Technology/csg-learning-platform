# Scheduled jobs — W9 PR 9.1

## Context and acceptance

Implementation worker; agent-executed affected-flow backend QA. Branch
`feat/scheduled-jobs`, isolated task worktree, base `e0af0801` (current main at
start). CSG Learn is the shared learning hub for students, instructors and
admins: notices must reflect each learner's readable assigned content and staff
follow-up ownership. Sources: `docs/PRODUCT_VISION.md`, the full
`docs/DEPLOYMENT.md`, `LearnerProgress`, `AssignedLearningContent`,
`LessonReadAccess`, all API jobs, and Brain Dump
`code-school/csg-learning-platform-plan.md` (historical purpose, not deployment
proof). Leon's Nov 17 decision in the task is authoritative: request jobs remain
inline, a Singapore Render cron runs every 15 minutes, and the lead owns setup.
No production services or production data were changed.

Required acceptance: a single synchronous entry point; safe overlapping ticks
through a transaction-scoped advisory lock; durable per-task success cursors;
catch-up without duplicate notifications; school-local daily eligibility;
assignment, plan, pause and self-paced rules; receipt recovery without delayed
inline enqueues; independent failure handling and nonzero command exit; flat
recipient query counts; explicit deployment/rollback instructions. Message
recovery and announcement push deferral were assessed and deliberately excluded
for the documented safety reasons. No UI/API response shape changes; browser,
native-device notification transport and production cron acceptance are outside
this worker's local execution scope.

## Scenario ledger

| Case | Fixture/actions and expected saved outcome | Status / evidence |
| --- | --- | --- |
| S01 | Hold the real transaction advisory lock; a tick on another connection skips without blocking; after release one execution succeeds. | Passed: `ScheduledTickOverlapTest`, committed connections, 10-second thread bound. |
| S02 | Daily follow-up task before/at school 08:00, repeat, then two missed days: one run per eligible school date, previous successful date supplied on catch-up. | Passed: scheduler regression. |
| S03 | Winter and summer Guam 23:59:59 → 00:00 while UTC is yesterday; New York DST transition still uses local 08:00. | Passed: scheduler regression and existing boot-zone tests. |
| S04 | Dry-run legacy/new command; no task invocation, delivery or checkpoint writes. Real command failure still executes the independent receipt task and exits 1. | Passed: scheduler/task regressions and smoke command below. |
| S05 | Lesson-only release override, locked lesson, personal-plan optional lesson, paused and expired learners, self-paced cohort, upcoming cohort whose school start date arrived. | Passed: actual persisted fixtures; only readable required releases email. |
| S06 | Initial activation skips old releases; missed days combine releases into one digest. Uncertain provider response and failed checkpoint retain claims across same-day and next-day retry. | Passed: daily delivery regressions. |
| S07 | Follow-up marks/in-app notices commit before provider calls; provider failure attempts the other provider and subsequent runs never repeat either uncertain attempt. Invalid owners are excluded. | Passed: job regressions, after-commit integration and independent-connection smoke assertions. |
| S08 | Increase unlock recipients from 1 to 10 and follow-up owners from 1 to 10: SQL including writes/provider preparation stays flat. | Passed: query-budget regressions; no real HTTP. |
| S09 | Receipt sweep resolves due receipts without scheduling inline delayed work; existing receipt tests retain missing-result backoff, leases and exhausted/expired cleanup. | Passed: scheduler integration, existing receipt suite and smoke fixture. |
| S10 | Additive migration down/up retains unique task names and notification claim keys; clear every connection pool's statement caches in ensure. | Passed: migration regression. |
| S11 | Production contradictory adapter/worker flags still fail boot; tick needs no Solid Queue execution path. | Existing runtime configuration suite plus test-inline smoke; full-gate result below. |
| S12 | Lead provisions the Render cron, verifies real controlled deliveries across midnight/08:00 and consecutive scheduled runs, then deletes the suspended worker. | Not run: intentional lead rollout after merge. |

## Local end-to-end command

Disposable database `csg_scheduled_jobs_20261117`, Rails test environment, inline
adapter, controlled school noon `2030-01-16`, synthetic users/lesson/follow-up and
Expo receipt. `scripts/qa/scheduled-jobs-smoke.rb` invokes the actual
`scheduled:tick` Rake entry point in dry-run, real and repeat modes. Resend, both
push providers and receipt HTTP were simulated; assertions used the independent
lock connection to prove email claims and follow-up marks were committed before
provider calls. This proves runner/database behavior, not live device delivery.

```bash
cd api
RAILS_ENV=test DATABASE_URL=postgresql:///csg_scheduled_jobs_20261117 \
  bin/rails runner ../scripts/qa/scheduled-jobs-smoke.rb
```

Observed summary lines:

```text
[ScheduledTick] {"at":"2030-01-16T02:00:00Z","dry_run":true,"tasks":[{"name":"intervention_follow_ups","status":"would_run","duration_ms":4},{"name":"daily_unlocks","status":"would_run","duration_ms":0},{"name":"expo_push_receipts","status":"would_run","duration_ms":0}],"duration_ms":22}
[ScheduledTick] {"at":"2030-01-16T02:00:00Z","dry_run":false,"tasks":[{"name":"intervention_follow_ups","status":"run","duration_ms":32},{"name":"daily_unlocks","status":"run","duration_ms":65},{"name":"expo_push_receipts","status":"run","duration_ms":8}],"duration_ms":106}
[ScheduledTick] {"at":"2030-01-16T02:00:00Z","dry_run":false,"tasks":[{"name":"intervention_follow_ups","status":"skipped","duration_ms":0},{"name":"daily_unlocks","status":"skipped","duration_ms":0},{"name":"expo_push_receipts","status":"skipped","duration_ms":0}],"duration_ms":1}
SMOKE passed: dry run has no writes/sends; real tick committed claims before simulated providers; repeat skipped; email=1 push_providers=2 receipts=1
```

## Engineering checks

Final-head ASUS results will be recorded here after the complete gate. The
reproducible command is:

```bash
asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/scheduled-jobs-gate.sh
```

The script keeps `OPENAPI_COVERAGE=1`, `PARALLEL_WORKERS=1`, the runner-only
migration-process port adapter on 55432, explicitly asserts prepared statements
are enabled for the first full suite and disabled for the second, then runs
RuboCop and Brakeman. Production's prepared-statement setting is unchanged.
No OpenAPI or generated client update is needed because no API shape changed.

Initial focused checks caught an irreversible migration `execute`, a fixture
connection overlap-test deadlock, and Rails timestamp duplication in a bulk
upsert. The migration now has explicit up/down with local timeouts, overlap uses
committed connections, and the upsert explicitly manages its timestamps. Fixed
cases were rerun; none was worked around by disabling prepared statements.

## Ownership and release boundary

Local shared PostgreSQL/Redis, existing browser tabs and booted simulators were
borrowed and left untouched. No server, browser tab or simulator was started.
The disposable local database and ASUS wrapper/container are task-owned. The
lifecycle helper refused to claim the ASUS wrapper because its command contains
`--postgres`, matching the protected database-process pattern; its exact PID and
completion are verified separately. Final cleanup and PR head are recorded below.
The branch/worktree and unmerged PR remain for the lead; no watch or merge.
