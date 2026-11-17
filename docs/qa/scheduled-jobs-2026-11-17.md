# Scheduled jobs — W9 PR 9.1

Current policy is the **Fix round** below: hourly tick, 07:00 digest, three-day cap. Earlier sections retain the original implementation/test history.

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

Observed summary lines (final application source `326f07d2`):

```text
[ScheduledTick] {"at":"2030-01-16T02:00:00Z","dry_run":true,"tasks":[{"name":"intervention_follow_ups","status":"would_run","duration_ms":14},{"name":"daily_unlocks","status":"would_run","duration_ms":0},{"name":"expo_push_receipts","status":"would_run","duration_ms":0}],"duration_ms":59}
[ScheduledTick] {"at":"2030-01-16T02:00:00Z","dry_run":false,"tasks":[{"name":"intervention_follow_ups","status":"run","duration_ms":151},{"name":"daily_unlocks","status":"run","duration_ms":245},{"name":"expo_push_receipts","status":"run","duration_ms":17}],"duration_ms":429}
[ScheduledTick] {"at":"2030-01-16T02:00:00Z","dry_run":false,"tasks":[{"name":"intervention_follow_ups","status":"skipped","duration_ms":1},{"name":"daily_unlocks","status":"skipped","duration_ms":0},{"name":"expo_push_receipts","status":"skipped","duration_ms":0}],"duration_ms":3}
SMOKE passed: dry run has no writes/sends; real tick committed claims before simulated providers; repeat skipped; email=1 push_providers=2 receipts=1
```

## Engineering checks

Final application source is `326f07d2`. Focused local checks passed **59 tests /
336 assertions**, zero failures/errors/skips; the corrected workspace fixture
passed **21 tests / 165 assertions** with the failing full-suite seed 27862.
RuboCop inspected **718 files, no offenses**; Brakeman reported **zero security
warnings** (one existing ignored warning). The final ASUS gate on committed source `ffaa7f96` (application and tests
`326f07d2`, followed only by documentation) exited **0**, with **zero failed
stages**:

| Check | Result |
| --- | --- |
| Full API, prepared statements enabled, seed 5641 | 2,024 tests / 41,881 assertions; 0 failures/errors/skips; 274.129 seconds |
| Full API, prepared statements disabled, seed 24185 | 2,024 tests / 41,881 assertions; 0 failures/errors/skips |
| Live adapter assertions | Enabled first, disabled second; both passed |
| ASUS RuboCop | 718 files inspected, no offenses |
| ASUS Brakeman | 0 security warnings, 1 existing ignored warning |

Both API runs used `OPENAPI_COVERAGE=1` and `PARALLEL_WORKERS=1`; no exclusions
or prepared-statement workarounds were used. These are direct PostgreSQL 16
runs on the ASUS. The GitHub transaction-pooler job remains a separate CI check.
The reproducible command is:

```bash
asus-test --postgres csg_learning_platform_test <repo-root> -- bash scripts/qa/scheduled-jobs-gate.sh
```

The script keeps `OPENAPI_COVERAGE=1`, `PARALLEL_WORKERS=1`, the runner-only
migration-process port adapter on 55432, explicitly asserts prepared statements
are enabled for the first full suite and disabled for the second, then runs
RuboCop and Brakeman. Production's prepared-statement setting is unchanged.
No OpenAPI or generated client update is needed because no API shape changed.

The first ASUS gate used an earlier scheduler snapshot: prepared statements
passed **2,021 tests / 41,882 assertions** (seed 40070). The unprepared run
(seed 27862) found an existing workspace fixture ordering failure: expected
`Most recent 11`, observed `Reply 5:1`. The test assumed successive wall-clock
inserts were chronological. That fixture now assigns explicit ascending
`created_at` values; application message ordering is unchanged. WSL clock
correction is a possible cause, not a proven diagnosis. Both full modes subsequently passed on the final source as recorded above;
the initial run is retained as failure/retest history.

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
completion are verified separately. The final run used task-owned retry wrapper PID 4379, claimed by lifecycle
session `01a1e7d2-a929-7553-816a-d34897d56230`. It retried only helper exit 75
(shared runner busy), then stopped after the successful gate. Other runs were
left untouched. The helper removed its disposable container/database and stopped
its WSL runner on completion; wrapper 4379 exited and was released. The local
database `csg_scheduled_jobs_20261117` was dropped after final smoke. Lifecycle
cleanup/status reports **no active owned resources**. No runtime handoff remains.
The branch/worktree and unmerged PR remain for the lead; no watch or merge.


## Lead handback

All eleven worker-owned backend scenarios are accepted; S12 is the deliberate
post-merge lead rollout. No browser/native transport or production delivery is
claimed. `origin/main` stayed at `e0af0801` through the ASUS run, then the final fetch
found `ca370b52` (#289, staff mobile layout). Merged it without conflicts as
`e971290b` immediately before push. The merge changes only web layout, its QA
scripts and evidence: `git diff ffaa7f96 HEAD -- api fixtures docs/openapi.json
.github/workflows/ci.yml` is empty. Thus the exact API application, tests,
fixtures, schema and API CI inputs tested in both modes are unchanged. No
scheduler/browser integration path was altered, so no further API rerun was
needed. The PR diff against current main contains only this worker's 26 files. The clean task branch/worktree remains available for
review. The PR is intentionally left unmerged and unwatched; GitHub CI and
CodeRabbit review are reported at handback, not treated as already passed.


## Fix round — lead decisions and review 5933816610

Base head `20617d24`. One implementation round; independent Opus review was
reported by the lead as ready with no P1. That review is evidence for the prior
head, not a claim of review coverage for these changes. Agent-executed backend
QA; no Render actions, merge, PR watch or review dismissal is authorized.

Acceptance changes: hourly `0 * * * *`; configurable school digest hour defaults
to 07:00; rolling three-school-day unclaimed-release window, including activation;
optional lessons included when no active enabled personal plan exists. Dry preview
reports follow-up backlog/older-than-seven-days and unlock recipients/lessons
without writes. Real results persist claimed/sent/failed metrics. Definite Resend
4xx rejections (except 408) release only rejected claims for retry; ambiguous
5xx/timeouts retain claims. An atomic per-enrollment/day reservation prevents
a second digest during partial-task retry when late content arrives; its own
regression verifies next-day catch-up for that late content. Supplied time controls cohort start and expiry.

The runbook now plans first real activation at 06:45–06:50 Guam (or an approved
07:45–07:50), requires waiting for prior Render completion, avoids top-of-hour
manual triggers and includes a report/explicit-Leon-approval baseline command for
old follow-ups. This command was tested only on synthetic fixtures, never run
against production. Solid Queue's hourly `ScheduledTickJob` owns the same registry,
including daily unlocks; the legacy separate schedules cannot drop the digest.

| Case | Result before full gate |
| --- | --- |
| Hourly slot exclusion, school 07:00 boundary/configuration, Guam/DST daily rules | Passed |
| Three-day cap and next-day late release, no-plan optional lesson, supplied-time start/expiry | Passed |
| Dry preview counts and zero writes even with no SchoolSetting; invalid flags fail before work | Passed |
| Backlog age counts and approved one-time baseline strict cutoff/no sends | Passed |
| Claimed/sent/failed results survive failed attempts and appear in scheduled:status | Passed |
| Resend 422/429 retry; 500/503/408/timeout remain claimed | Passed |
| Non-empty Expo follow-up skips drain while tracking tickets; shared web opt-out/routing helper | Passed |
| Additive result-column migration round trip and all-pool cache cleanup | Passed |
| Existing after-commit, recipient query budgets, receipt leases/backoff | Passed |

Focused run: **117 tests / 691 assertions**, zero failures/errors/skips.
RuboCop: **730 files, no offenses**. Initial fixture errors (missing trigger type,
unique active-trigger collision, wrong expected descriptor vocabulary) were
corrected and retested; none required a production behavior workaround.

Local disposable DB `csg_scheduled_jobs_fix_20261117`, synthetic users and
simulated providers. The real Rake command was exercised at controlled Guam
06:50/07:00/08:00. Independent lock-pool reads verified claims/marks committed
before the provider stubs. This is runner/persistence evidence, not live email or
physical-device delivery. New observed summaries:

```text
[ScheduledTick] {"at":"2030-01-16T20:50:00Z","dry_run":true,"catch_up_days":3,"tasks":[{"name":"intervention_follow_ups","status":"skipped","claimed":0,"sent":0,"failed":0,"follow_ups_due":1,"older_than_7_days":0,"would_claim":1,"duration_ms":12},{"name":"daily_unlocks","status":"skipped","claimed":0,"sent":0,"failed":0,"recipients":1,"lessons":1,"would_claim":1,"catch_up_days":3,"duration_ms":42},{"name":"expo_push_receipts","status":"would_run","claimed":0,"sent":0,"failed":0,"would_claim":1,"duration_ms":3}],"duration_ms":82}
[ScheduledTick] {"at":"2030-01-16T20:50:00Z","dry_run":false,"catch_up_days":3,"tasks":[{"name":"intervention_follow_ups","status":"skipped","claimed":0,"sent":0,"failed":0,"duration_ms":0},{"name":"daily_unlocks","status":"skipped","claimed":0,"sent":0,"failed":0,"duration_ms":0},{"name":"expo_push_receipts","status":"run","claimed":1,"sent":1,"failed":0,"duration_ms":4}],"duration_ms":9}
[ScheduledTick] {"at":"2030-01-16T21:00:00Z","dry_run":false,"catch_up_days":3,"tasks":[{"name":"intervention_follow_ups","status":"skipped","claimed":0,"sent":0,"failed":0,"duration_ms":0},{"name":"daily_unlocks","status":"run","claimed":1,"sent":1,"failed":0,"catch_up_days":3,"released":0,"duration_ms":20},{"name":"expo_push_receipts","status":"run","claimed":0,"sent":0,"failed":0,"duration_ms":2}],"duration_ms":26}
[ScheduledTick] {"at":"2030-01-16T22:00:00Z","dry_run":false,"catch_up_days":3,"tasks":[{"name":"intervention_follow_ups","status":"run","claimed":1,"sent":1,"failed":0,"duration_ms":26},{"name":"daily_unlocks","status":"skipped","claimed":0,"sent":0,"failed":0,"duration_ms":1},{"name":"expo_push_receipts","status":"run","claimed":0,"sent":0,"failed":0,"duration_ms":2}],"duration_ms":31}
[ScheduledTick] {"at":"2030-01-16T22:00:00Z","dry_run":false,"catch_up_days":3,"tasks":[{"name":"intervention_follow_ups","status":"skipped","claimed":0,"sent":0,"failed":0,"duration_ms":0},{"name":"daily_unlocks","status":"skipped","claimed":0,"sent":0,"failed":0,"duration_ms":0},{"name":"expo_push_receipts","status":"skipped","claimed":0,"sent":0,"failed":0,"duration_ms":0}],"duration_ms":1}
SMOKE passed: dry preview has no writes/sends; 06:50 receipts only; 07:00 digest; 08:00 follow-up; repeat skipped; email=1 push_providers=2 receipts=1
```

Final ASUS gate, source/main integration, review-thread replies and cleanup will
be recorded below before handback. Existing PR remains held, unmerged/unwatched.


Main integration requested during this round: merged `5fa85024` (#293) as
`1466ddd8`. The only conflict was the schema version header; kept
`2026_11_18_020000`, both scheduler tables/result columns and nullable
`feature_switch_changes.actor_id`. Scheduler migrations `20261118000100` and
`20261118000200` remain unique and unchanged. The scheduler does not read that
audit actor; its `Notification.actor_id` is a separate field. A regression with a
system audit row and `student_experience_v2` on/off produces identical digest
recipient, subject and HTML. The imported migration test now clears every
connection pool's statement cache in ensure, matching the pooler test contract.

Regenerated both web/mobile API clients from the merged OpenAPI and ran
`npm run api:check`: generation made no diff beyond main's existing generated
clients, and the transport/generated-file check passed. Reused installed
TypeScript/generator dependencies read-only through a temporary link, then removed
that link; no package installation or borrowed-directory mutation occurred.
The integrated local smoke passed again. Earlier ASUS snapshots were deliberately
stopped by exact validated task-owned PID/worktree after the day-reservation fix
and then this API integration; neither interrupted run is counted as final QA.
