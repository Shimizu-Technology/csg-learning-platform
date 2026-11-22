# CSG Learning Platform — Deployment Guide

**Last updated:** 2026-11-17

## Architecture Overview

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────┐
│  Netlify (SPA)  │────>│  Render (API)    │────>│  Neon (DB)  │
│  Frontend       │     │  Singapore       │     │  PostgreSQL │
│  learn.csg.com  │     │  learn-api.csg.  │     │             │
└─────────────────┘     └──────────────────┘     └─────────────┘
         │                       │
         │                       ├──> Clerk (Auth)
         ├──> Clerk (Auth)       ├──> GitHub API (Grading)
         └──> PostHog            └──> Resend (Email)
```

---

## Backend — Render

### Service Configuration

| Setting | Value |
|---------|-------|
| Service type | Web Service |
| Region | Singapore (closest to Guam) |
| Runtime | Ruby |
| Branch | `main` |
| Root directory | `api` |
| Health check path | `/health` |

Production uses inline job execution by default. This is the preferred mode for
the current low-volume internal deployment because it preserves invite, email,
push, and notification behavior without paying for a worker or keeping Neon
awake through queue polling.

Configure the web service with:

```
ACTIVE_JOB_QUEUE_ADAPTER=inline
SOLID_QUEUE_WORKER_PROVISIONED=false
SOLID_QUEUE_IN_PUMA=false
```

Keep the Render background worker suspended in this mode. `/api/v1/ready`
should return `200` with `queue: not_required`. Inline delivery adds provider
latency to the originating request, so exercise invitations, messages,
submissions, and push delivery after changing modes.

Until the cron rollout below is proven, the suspended worker is a historical
recovery path, not an active execution path. Keep its
automatic deploys disabled and retain `./bin/jobs` as its Docker command so an
accidental resume cannot inherit the Dockerfile's Rails web-server command.

Only create or resume a persistent background worker when production volume
justifies asynchronous request jobs. Before switching to Solid Queue, configure it as:

| Setting | Value |
|---------|-------|
| Service type | Background Worker |
| Region | Singapore |
| Runtime | Docker |
| Root directory | `api` |
| Docker command | `./bin/jobs` |

The Docker command is required. If it is blank, Render inherits the image's
default Rails web-server command and the service will not process background
jobs. Do not use `SOLID_QUEUE_WORKER_PROVISIONED=true` to describe a worker
until its logs show `./bin/jobs` running.

Production defaults to inline jobs so invite emails, push notifications, and
mention emails still deliver if the worker has not been provisioned yet. After
the worker service is created and running, set these variables on the web service
and the worker service:

```
ACTIVE_JOB_QUEUE_ADAPTER=solid_queue
SOLID_QUEUE_WORKER_PROVISIONED=true
SOLID_QUEUE_DISPATCHER_POLLING_INTERVAL_SECONDS=5
SOLID_QUEUE_WORKER_POLLING_INTERVAL_SECONDS=2
```

Solid Queue also activates the one-minute `MessageDeliveryRecoveryJob` schedule.
That sweep recovers up to 100 of the least-recently-attempted abandoned
notification and realtime leases without waiting for the sender to retry. New
API-created messages explicitly opt into recovery; historical messages remain
excluded so enabling the worker cannot replay old notifications or broadcasts.
Incomplete work rotates behind never-attempted work and does not silently
expire; failures remain visible in job logs until an operator-owned dead-letter
workflow exists. Message push jobs may be enqueued again after an interrupted
notification stage; per-provider attempts are checkpointed by notification ID,
so duplicate jobs do not duplicate provider fan-out.
Each sweep logs `backlog_due` and `batch_limit`. Alert when `backlog_due` grows
across consecutive runs or remains above the batch limit; that is the signal to
raise throughput or investigate a persistent delivery failure.
Inline mode keeps message delivery synchronous and supports idempotent request
replay. It does not run `config/recurring.yml`; the Render cron below runs the
safe subset through `scheduled:tick`.

### Message notifications and after-commit jobs

Jobs are enqueued only after the surrounding database transaction commits
(`ApplicationJob.enqueue_after_transaction_commit`). Inline, a push or email
requested inside a row lock therefore runs after the lock is released, and never
runs for a write that rolled back.

Message delivery opts out with `ApplicationJob.enqueue_within_transaction`,
because the caller marks the send as done in the same flow:

- **Message notifications (#216).** Message push, DM email and mention email are
  attempted inside the delivery lock, before `notifications_delivered_at` is
  written. If they were deferred past that mark, a process exit or a replay that
  meets the live lease would leave a saved message marked delivered with no
  push or email attempted. Production has no job runner to recover it.
Intervention follow-ups instead commit their in-app notices and
`follow_up_notified_at` claims before attempting either push provider. A cron
retry cannot repeat those attempts. This deliberately favors no duplicates over
retrying an uncertain send; a crash after the claim can lose a push, while its
in-app notice remains available.

A DM email that fails inline is logged (`[MessageEmailJob] retry_unavailable`)
and reported, and the message still returns success; it is not retried. If a
push provider's deadline stops before some requests have started, those
notifications' provider claims are released and the notification stage stays
open. The sender's replay then sends only those, and nothing that already
started is sent again.

The AS-6 cron does not defer message delivery. Fully deferring it still needs:

1. A persisted pending state for each message's push, DM email and mention
   email, written with the delivery stage instead of a delivered mark.
2. A recovery drain on the runner that sends pending work after commit and
   marks each part delivered only once it has been attempted.
3. Per-recipient email results stored in our database. Resend's idempotency
   key deduplicates for only 24 hours, and a drain can run later than that.

Rails will fail boot if `ACTIVE_JOB_QUEUE_ADAPTER=solid_queue` is enabled
without either `SOLID_QUEUE_WORKER_PROVISIONED=true` or
`SOLID_QUEUE_IN_PUMA=true`, so jobs cannot silently enqueue with no worker.
It also fails boot if both execution paths are enabled, or if inline mode still
declares Solid Queue infrastructure. Each deployment must have exactly one
request-job execution path; the cron runs scheduled tasks synchronously.
The polling defaults above keep normal notification latency while avoiding the
ten database polls per second caused by Solid Queue's upstream worker default.
If either concurrent message index migration times out, rerun the migration.
Each migration checks the exact expected index identity, removes an interrupted
or invalid same-named index with `DROP INDEX CONCURRENTLY`, and rebuilds it.

### Safely activating or recovering the worker

Never start a newly provisioned or repaired worker until the existing queue has
been inspected. An old queue can contain obsolete push notifications, emails,
and read-receipt broadcasts that would all be delivered when the worker starts.

1. Choose an exact cutoff immediately before the repaired deployment.
2. Run the report from a Render shell and save its output:

   ```bash
   STALE_QUEUE_CUTOFF=2026-08-15T08:00:00Z bin/rails operations:stale_queue_report
   ```

3. Confirm the class and state counts. The cleanup intentionally refuses to
   proceed if any matching job is claimed, scheduled, blocked, failed, or in an
   unknown state.
4. After an authorized reviewer approves that exact report and cutoff, discard
   only the stale ready jobs:

   ```bash
   STALE_QUEUE_CUTOFF=2026-08-15T08:00:00Z \
   CONFIRM_STALE_QUEUE_PURGE=delete-ready-jobs-before-cutoff \
   bin/rails operations:purge_stale_queue
   ```

5. Set the worker's Docker command to `./bin/jobs`, deploy it, and confirm its
   logs show a Solid Queue worker process.
6. Request `/api/v1/ready`; it should report both `database` and `queue` as `ok`.
7. Trigger one controlled, current notification and verify it is processed once.

The purge is a rollout operation, not part of an application deploy. Do not run
it against production without explicit approval of the report and cutoff.

### Returning a low-volume deployment to inline jobs

Use this sequence when a paid worker is not actually processing jobs or the
queue is unnecessary for current traffic:

1. Leave the worker stopped so old queued work cannot execute.
2. On the web service, save these three environment changes together:
   `ACTIVE_JOB_QUEUE_ADAPTER=inline`,
   `SOLID_QUEUE_WORKER_PROVISIONED=false`, and
   `SOLID_QUEUE_IN_PUMA=false`.
3. Deploy the web service and confirm its boot log contains
   `[JobRuntime] adapter=inline execution_path=inline`.
4. Confirm `/health` and `/api/v1/ready` both return `200`; readiness should
   report `queue: not_required`.
5. Exercise one current invitation or notification and confirm it completes
   exactly once, then verify the Render worker remains suspended.
6. Preserve the old Solid Queue rows. They are inert in inline mode and must
   still go through the report-and-approval process above before any future
   worker activation.

### Scheduled work — hourly Render cron (AS-6, W9.1)

Request jobs stay inline. Scheduled work has one entry point:
`bundle exec rails scheduled:tick`. It exits after its tasks and never starts
Solid Queue or reads its backlog. The lead provisions this service after merge;
this PR makes no Render changes.

| Setting | Value |
| --- | --- |
| Service type / suggested name | Cron Job / `csg-learning-platform-scheduled-jobs` |
| Repository / branch | This API repository / `main` |
| Region / runtime | Singapore / Ruby |
| Root directory | `api` |
| Build command | `bundle install` |
| Command | `bundle exec rails scheduled:tick` |
| Schedule (UTC) | `0 * * * *` |
| Environment | Same variables/secrets/database and school zone as the web service |
| Job flags | `ACTIVE_JOB_QUEUE_ADAPTER=inline`, `SOLID_QUEUE_WORKER_PROVISIONED=false`, `SOLID_QUEUE_IN_PUMA=false` |
| Digest hour | `SCHEDULED_DAILY_UNLOCK_HOUR=7` (integer 0..23, defaults to 7) |

The web build remains `bundle install && bundle exec rails db:prepare` and owns
migrations, including `20261118000100`, `20261118000200` and `20261118040000` (scheduled updates) and `20261118050000` (announcement push outbox). Do not migrate from
the cron build. Contradictory queue flags still fail production boot. Set the
same `SCHOOL_TIME_ZONE` (default `Pacific/Guam`) and digest hour on every runner.
The hourly schedule gives about 24 wakes/day rather than 96 quarter-hour wakes.
Each invocation opens a transaction and can keep Neon awake for its idle period;
the old cadence could amount to roughly eight awake hours/day and exceed a free
compute allowance. Hourly receipt sweeps remain within their 24-hour window.
Verify actual compute usage during rollout; no persistent polling daemon exists.

| Task | Due rule |
| --- | --- |
| `scheduled_updates` | Once per UTC hour slot. Posts scheduled updates whose time has passed, once each, under the row lock; push runs after the commit. A refused scheduler (no longer able to post there) returns the update to an unscheduled draft (`refused` in the result). A post that raises rolls back, stays scheduled and fails the task, so the next hour retries it. Drains everything due in batches of 100 within a 5-minute budget; running out fails the task without advancing the checkpoint, so the next run continues. Also re-requests pushes for posted updates whose push intent is unsettled 5 minutes on (`push_requeued`; older than 24 hours: `push_expired`, settled unsent). Dry run reports `would_publish` and `would_requeue_push`. |
| `intervention_follow_ups` | Once daily at/after 08:00 school time; processes all currently overdue, unnotified valid-owner follow-ups, including old dates. Inspect and baseline backlog before activation. |
| `daily_unlocks` | Once daily at/after `SCHEDULED_DAILY_UNLOCK_HOUR` (07:00 Guam by default). One coalesced digest per enrollment covering unclaimed releases in **today and the previous two school dates**, including activation. |
| `expo_push_receipts` | Once per UTC hour slot. Drains due receipts directly, without delayed inline enqueues. The existing 15-minute minimum backoff, lookup limit and 24-hour age bound remain; the next cron opportunity is hourly. |
| `learner_nudges` | Once per UTC hour slot (W9.3). New reminders require both the school switch and the cohort opt-in. Sends nothing 21:00–08:00 Guam (`quiet_hours: true`). The next morning tick rechecks pending deliveries against current settings and progress. Records each event under a unique key and enforces a daily cap per learner across enrollments. Processes enrollments in batches of 200 within a 5-minute budget and saves its cursor on `BacklogRemaining`. Optional evaluation failures fail the task while essential access-ending notices continue. Recovery checks deliveries pending for 5 minutes and expires those older than 12 hours (`push_expired`). Dry run reports `would_claim`. Rules and copy are in `api/app/services/learner_nudges.rb`. See `docs/qa/w9-nudges-2026-11-18.md` for QA. |

The digest scans a rolling **three-school-day cap**, even when a successful
checkpoint exists. This includes content released/assigned after yesterday's
digest on the next day's run, provided its release date is still in that window.
Content whose release date has moved outside the window is not emailed. A long
outage never sends an unbounded historical digest. An atomic per-enrollment/school-day reservation also prevents a partial-failure
retry from sending a second digest to a successful recipient when late content
arrives. Definite rejections release that reservation too. Durable per-lesson
claims prevent an already-attempted release from reappearing after catch-up,
checkpoint failure or date edits.

Eligibility uses batch-loaded `LearnerProgress` / `AssignedLearningContent` with
the supplied tick time for cohort starts, enrollment expiry and school dates.
Explicit lesson overrides and locks apply; archived content is excluded. With
**no active personal plan**, optional (`required: false`) lessons remain included,
as in the old rake task. An active enabled personal plan narrows the digest to
its required scope. Paused, completed, dropped, expired, pending-invite and
archived-user recipients are excluded. Self-paced cohorts have no calendar
release digest and are skipped.

The runner holds `pg_try_advisory_xact_lock` through its last task on a separate
connection. The open transaction pins a PgBouncer transaction-mode backend;
there are no session locks. A competing application tick logs `overlap` and
exits successfully. Task writes commit independently. Each successful task
updates `last_succeeded_at` / `last_school_date`. Failures keep those checkpoints,
allow other tasks to finish and exit 1. Hourly gaps coalesce into a current sweep.

Email claims commit before provider calls. Timeouts, HTTP 5xx, HTTP 408, malformed
responses and unknown errors are ambiguous: retain those claims permanently,
including beyond Resend's dedupe window. Definite Resend HTTP 4xx rejections
(excluding 408), including 422/429, release only that invocation's rejected
recipient/lesson claims in one bulk delete. The task fails without advancing its
success checkpoint, so the next hourly tick retries them while they remain in
the three-day window. Fix a persistent 422/configuration error rather than
manually resending. A process crash after claiming may lose a send; uncertain
work is never automatically replayed. In-app follow-up notices and push claims
remain atomic. Keep durable claims as history, not routine cleanup targets.

#### Dry-run preview, counts and status

`SCHEDULED_TICK_DRY_RUN` accepts `1`, `true` or `yes`, case-insensitive, with
surrounding whitespace ignored. **Unset/empty means real execution. Any other
non-empty value (including `0`, `false` or a typo) aborts before work.** Remove the
variable to activate real execution. The legacy `notifications:send_daily_unlocks`
command and the Solid Queue wrapper use the same parser and registry.

Dry run performs no writes, sends or claims. Its summary reports potential
`follow_ups_due`, `older_than_7_days`, unlock `recipients` / `lessons` /
`would_claim`, and receipt `would_claim`, even before a task's daily hour. The
`status` says whether it would run **now**; preview numbers show the current
eligible backlog, not a promise that tomorrow's data will be unchanged.

Every `[ScheduledTick]` JSON summary includes `catch_up_days: 3`, per-task status,
duration, error class and `claimed` / `sent` / `failed` counts. Unlock `claimed`
counts lesson claims; `sent` / `failed` count recipient digests. Follow-up counts
are notices: `sent` means at least one provider routine accepted the handoff,
not confirmed device receipt; a notice can have both a successful provider and a
failed provider. Receipt counts measure claims, successful lookup requests and
failed lookups, not new notifications. Dry/skip/overlap actual counts are zero.
`released` records definitely rejected email lesson claims released for retry.

`bundle exec rails scheduled:status` reports each task's last successful time,
school date, last attempted time and saved `last_result` with those counts,
including failed attempts. Dry runs and skips do not overwrite stored results.
Render history supplies whole-tick attempts. Keep `/health` database-free and
Render's health path unchanged; no API response shape or client types change.

#### Activation pre-check and optional approved follow-up baseline

A first real run can send every overdue unnotified follow-up. Before enabling
real sends, save a dry-run summary and inspect both total due and older-than-seven-
days counts, plus unlock recipient/lesson counts and the three-day cap. The lead
must reconcile an unexpectedly large or stale backlog with Leon before activation.
Do not treat a green dry-run exit as approval to send it.

To report a one-time cutoff, choose an exact activation timestamp and a positive
N approved with Leon (example below uses N=7; replace the timestamp). This report
makes no writes:

```bash
SCHEDULED_ACTIVATION_AT=2026-11-18T20:50:00Z \
SCHEDULED_FOLLOW_UP_MAX_AGE_DAYS=7 \
bundle exec rails scheduled:baseline_follow_ups
```

Only **after Leon approves that exact report, timestamp and N**, rerun it with:

```bash
SCHEDULED_ACTIVATION_AT=2026-11-18T20:50:00Z \
SCHEDULED_FOLLOW_UP_MAX_AGE_DAYS=7 \
CONFIRM_FOLLOW_UP_BASELINE=mark-old-follow-ups-without-sending \
bundle exec rails scheduled:baseline_follow_ups
```

This marks active, unnotified follow-ups due **strictly more than N days before
activation** with `follow_up_notified_at=activation_at`. It creates no notices and
sends nothing; equality at the cutoff, recent/future dates and previously notified
items are untouched. The UPDATE rechecks eligibility after concurrent edits;
repeating the baseline is a no-op. This is an approved rollout operation, never
an automatic migration or routine tick. Run it before real cron activation,
with no tick running, and retain its candidate/marked counts. Do not execute it
against production as part of development QA.

#### Manual triggers, rollout and rollback

**Render manual triggers cancel an active cron run.** The application advisory
lock cannot prevent that platform cancellation. Wait until the previous Render
run has finished before triggering anything; inspect run history first. Avoid
the top of any hour and the scheduled 07:00/08:00 Guam runs. Cancelling a run
after a durable claim can lose an external notification. Do not trigger a second
run to check progress or prove idempotency while one is active.

1. Merge/deploy the API and both migrations; verify the exact source and
   `/api/v1/ready` (`queue: not_required`). Keep the old worker suspended with
   automatic deploys disabled.
2. The lead creates the hourly cron with `SCHEDULED_TICK_DRY_RUN=true`. After
   any prior run has finished, manually preview away from the hour boundary.
   Save and reconcile all backlog counts. If needed, perform the exact approved
   baseline above while real execution is still disabled, then preview again.
3. Plan the **first real trigger at 06:45–06:50 Guam**, just before the 07:00
   digest; never enable it with a casual midday trigger. Remove the dry-run
   variable only when no run is active. That controlled trigger handles due
   receipts while daily tasks wait for 07:00/08:00. If activation is instead
   approved just before 08:00, use 07:45–07:50 and account for a due digest in
   the preview. If a prior run is still active, postpone; do not cancel it.
4. Let the scheduled 07:00 digest and 08:00 follow-ups finish naturally. Inspect
   counts, `scheduled:status` and controlled recipient/receipt outcomes. Any
   manual repeat must wait for completion and be away from the hour boundary.
   Same-day successes skip and claimed/ambiguous work must not repeat. Observe
   consecutive hourly runs, the next day's digest and actual Neon compute use.
5. Once proven, the lead deletes suspended
   `csg-learning-platform-background-worker`. Preserve old Solid Queue rows.
   The historical recovery and inline-return sections remain the runbooks for
   any future topology change.
6. Roll back by suspending the cron. Requests stay inline; retain claims,
   checkpoints and result columns. Fix the runner before resuming; never resume
   an obsolete worker as a shortcut.

#### Deliberately excluded work and restoring Solid Queue

`MessageDeliveryRecoveryJob` remains outside the cron registry. Email lacks our
own per-recipient durable results beyond Resend's 24-hour dedupe window, and its
broadcasts cannot reach web sockets through process-local Action Cable. Hourly
cadence changes latency, not those safety limits. Pending-state message delivery
and shared broadcast transport remain separate work.

Announcement delivery uses the fan-out and push outboxes described below.
The tick only recovers explicit pending intents; it never scans/replays old
announcement notifications.

If Solid Queue is intentionally restored, first follow the queue inspection,
source/environment and broadcast-transport recovery requirements above. Deploy
this version of `config/recurring.yml`: its hourly **`ScheduledTickJob` calls the
same registry**, including daily unlocks at the configured school hour,
follow-ups and receipts. Wait for any active Render cron run to finish, then suspend its future schedule
before activating the worker's recurring scheduler; confirm that scheduler
registers `scheduled_tick` and verify `scheduled:status` across 07:00/08:00.
There is no gap in daily-unlock ownership: the worker takes over the same saved
checkpoints at its next hourly run. Never enable both schedulers. Historical
message recovery remains a separate worker-only schedule and requires its own
transport/delivery readiness review before activation.

#### Future task interface (U-3.6 / AS-1 / AS-4)

Add a stable `ScheduledTick::Task(name:, daily_hour:, call:)`; hour is local
0..23, or nil for hourly. The synchronous callable receives
`(now, last_school_date, metrics)`; existing two-argument callables are supported.
Update the mutable metrics hash (`claimed`, `sent`, `failed`) and raise on failure.
Use supplied time, batch queries and committed event/recipient claims before
external effects. Add a read-only preview and overlap/retry/catch-up/query/time-
zone tests. Renaming a task resets its checkpoint and needs an explicit catch-up
decision. Scheduled Updates and drip/nudge product behavior are not built here.

### Environment Variables (Render Dashboard)

```
RAILS_ENV=production
RAILS_MASTER_KEY=<production Rails master key from your password manager>
DATABASE_URL=<Neon connection string>
FRONTEND_URL=https://learn.codeschoolofguam.com
# Local/single-instance compatibility variables. During the production
# transition use the explicit development and production variables below.
CLERK_ISSUER=https://<your-development-instance>.clerk.accounts.dev
CLERK_SECRET_KEY=sk_test_...
CLERK_DEVELOPMENT_ISSUER=https://<your-development-instance>.clerk.accounts.dev
CLERK_DEVELOPMENT_SECRET_KEY=sk_test_...
CLERK_DEVELOPMENT_AUTHORIZED_PARTIES=https://learn.codeschoolofguam.com
CLERK_PRODUCTION_ISSUER=https://<production-frontend-api-domain>
CLERK_PRODUCTION_SECRET_KEY=sk_live_...
CLERK_PRODUCTION_AUTHORIZED_PARTIES=https://learn.codeschoolofguam.com
# Keep development primary until the Netlify publishable-key cutover.
CLERK_PRIMARY_ENVIRONMENT=development
MAILER_FROM_EMAIL=noreply@codeschoolofguam.com
RESEND_API_KEY=re_...
# Token owner must actively belong to each configured GitHub organization and be able to read its full member list.
GITHUB_ORGANIZATION_ADMIN_TOKEN=ghp_...
AWS_ACCESS_KEY_ID=<iam access key for S3 uploads>
AWS_SECRET_ACCESS_KEY=<iam secret for S3 uploads>
AWS_REGION=ap-southeast-2
AWS_S3_BUCKET=csg-learning-platform
VOICE_TRANSCRIPTION_ENABLED=true
OPENAI_API_KEY=<server-only OpenAI project key>
OPENAI_PROJECT_ID=<optional dedicated OpenAI project ID>
OPENAI_TRANSCRIPTION_MODEL=gpt-transcribe
OPENAI_CLEANUP_MODEL=gpt-5.6-luna
```

Set `VOICE_TRANSCRIPTION_ENABLED=true` only for an approved environment after the applicable privacy disclosure and production OpenAI data-control review are complete; the endpoint fails closed otherwise. A limited internal TestFlight acceptance run may be activated separately to collect physical-device evidence, but it is not approval for public App Review. Never expose `OPENAI_API_KEY` through a `VITE_` or `EXPO_PUBLIC_` variable. `OPENAI_API_BASE_URL` is an optional server-side override and defaults to `https://api.openai.com`.

### Real-time messaging (Action Cable)

Production uses Action Cable's in-memory `async` adapter (`api/config/cable.yml`).
This is correct only because production runs a single Puma worker
(`WEB_CONCURRENCY=1`) and executes jobs inline, so every broadcast starts in the
process that holds the WebSocket connections.

- Do not use the `postgresql` cable adapter with the Neon `-pooler` URL. LISTEN/NOTIFY
  does not work through a transaction-mode pooler: a production probe on 2026-11-15
  subscribed successfully but received 0 of 3 broadcasts, so clients silently fell
  back to 30-second polling.
- Do not point the cable adapter at a direct Neon connection either. A permanently
  open LISTEN connection keeps the Neon compute awake.
- If production ever runs more than one process that broadcasts (more Puma workers,
  or the background worker with a queue adapter other than `inline`), add the
  `redis` gem to `api/Gemfile` first, then set `CABLE_ADAPTER=redis` and `CABLE_URL` (for example a Render Key Value instance in
  the same region). The API logs an `[ActionCable] async adapter` warning at boot if
  it detects that configuration while still on `async`, and refuses to boot if
  `CABLE_ADAPTER=redis` is set without the gem. `WEB_CONCURRENCY=auto` counts as
  more than one process.
- During a zero-downtime deploy, clients connected to the old instance reconnect
  to the new one and refetch, so a message sent mid-deploy may appear after the
  reconnect rather than instantly.

### Message email delivery diagnostics

Direct-message email jobs are idempotent per notification and retry provider
failures. In Render logs, filter for:

- `[MessageEmailJob] started` to confirm the job found its notification rows;
- `[MessageEmailJob] skipped` to see a safe reason such as
  `preference_disabled`, `archived`, or `email_unavailable`;
- `[MessageEmail] delivered` for the Resend provider message ID; and
- `[MessageEmail] delivery_failed` for the retryable provider/configuration
  error.

These entries intentionally identify the recipient by internal user ID and do
not include email addresses or message contents. If a job starts but never
reaches a delivered or failed entry, confirm the web service and worker use the
same `RESEND_API_KEY`, sender variable, database, and queue adapter.

### S3 Direct Upload Requirements

Recording uploads do **not** stream through Render or Netlify. The API generates presigned S3 requests, and the browser then uploads the file directly to S3. Large videos use S3 multipart upload so failed chunks can retry without restarting the whole recording.

That means production uploads can fail even when:
- `POST /api/v1/cohorts/:id/recordings_presign` returns `200 OK`
- Render logs look healthy
- local uploads still work

The two production-critical checks are:

1. `AWS_REGION` on Render must exactly match the actual bucket region.
This app’s production bucket intentionally lives in `ap-southeast-2`, even though the Render service runs in Singapore. `AWS_REGION` here refers to the S3 bucket region, not the Render app region. If Render signs uploads for the wrong bucket region, S3 can respond with a redirect/error that the browser surfaces as a generic upload failure.

2. The S3 bucket CORS rules must allow the production frontend origin, `PUT`, and exposed `ETag` headers.
If the bucket allows `http://localhost:5173` but not `https://learn.codeschoolofguam.com`, local uploads can succeed while production uploads fail during the browser → S3 step.

Recommended bucket CORS:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:5173",
      "https://learn.codeschoolofguam.com"
    ],
    "AllowedMethods": ["GET", "HEAD", "POST", "PUT"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag", "Location", "x-amz-request-id", "x-amz-id-2"],
    "MaxAgeSeconds": 3000
  }
]
```

Recommended bucket lifecycle rule:

- Rule status: enabled
- Scope: all objects in the upload bucket
- Action: abort incomplete multipart uploads after 1 day

This is a production backstop for interrupted browser uploads. The app already
aborts multipart uploads when it can, but a tab close, laptop sleep, dead
battery, or network drop can still leave an incomplete upload in S3. The
lifecycle rule lets S3 clean those parts automatically instead of keeping
orphaned storage indefinitely.

### Deploy Process

1. Push to `main` triggers auto-deploy on Render
2. Render uses the native Ruby runtime with root directory `api` (not Docker)
3. The build command is `bundle install && bundle exec rails db:prepare`
4. Render starts Puma with `bundle exec puma -C config/puma.rb`
5. There is no pre-deploy command or disk. Render checks `/health` to confirm the Rails process is serving requests

`/health` is intentionally database-free because Render requests it every few
seconds; it must not keep Neon awake. It is also silenced from production request
logs. `/api/v1/ready` is the manual dependency diagnostic: it checks PostgreSQL and,
when Solid Queue is enabled, requires a current worker heartbeat and a ready
queue no older than `QUEUE_READINESS_MAX_READY_AGE_SECONDS` (default: 300).

Render must use `/health`, never `/api/v1/ready`, for its automatic health
check. Use `/api/v1/ready` only during deployment verification and incident
diagnosis.

The `Production Health` GitHub Actions workflow also checks both endpoints every
hour. It requires `status: ok`, `database: ok`, and `queue: not_required`.
That exact queue assertion detects an accidental return to Solid Queue before a
worker has been intentionally activated. The workflow can also be run manually:

```bash
gh workflow run production-health.yml
```

Run the same monitor locally with:

```bash
node --test scripts/production-health-check.test.mjs
node scripts/production-health-check.mjs
```

### Manual Deploy

```bash
# From the Render dashboard:
# Settings > Manual Deploy > Deploy latest commit
```

### Database Migrations

Production uses the native Ruby build command
`bundle install && bundle exec rails db:prepare`. Web-service migration settings
are unchanged; cron setup is separate. The migration Rake prerequisite runs before Rails loads
its database configuration, including for manual commands. `bin/migrate` and the
future Docker entrypoint call the same guarded `db:prepare` path.

- With a valid `MIGRATION_DATABASE_URL`, migrations use that direct connection
  with advisory locks enabled. Before any schema work, the guard requires the
  same database, user and endpoint as `DATABASE_URL`, stripping the Neon host's
  `-pooler` suffix. Wrong endpoints/databases/users, malformed URLs, pooled
  overrides and direct secrets explicitly disabling locks fail with redacted
  errors. Connection identity query overrides are rejected too.
- Without the secret, a recognized pooled `DATABASE_URL` runs migrations
  with advisory locks disabled **only in that migration process**, with a loud
  warning on stderr. This fallback assumes exactly one migration instance:
  never overlap deploys or manual schema commands. It does not serialize them.
- A direct runtime URL keeps migration advisory locks enabled. Puma keeps the
  original runtime URL and lock configuration; production prepared statements
  remain disabled. No migration opt-out variable exists.

Pooler detection uses `-pooler`/`pgbouncer` hosts or the case-insensitive
`pgbouncer=true` URL marker. It cannot identify a proxy behind a custom alias.
Use Neon's actual connection URLs. The guard covers prepare, migrate (including
status/up/down/redo/reset), rollback, forward, schema load, setup and reset,
including generated per-database tasks. Destructive parent tasks are guarded
before their drop prerequisites.

**Optional upgrade to serialized migrations:**

1. Neon → production project → Connect: select the API's existing branch,
   compute, database and role. Turn **Connection pooling off** and copy the
   direct URL, retaining SSL parameters. Its host must have no `-pooler`.
2. Render → API web service → Environment: add the URL as secret
   `MIGRATION_DATABASE_URL`. Keep `DATABASE_URL` pooled. Remove identity query
   overrides or `advisory_locks=false` from the direct URL. Never paste either
   URL into logs, PRs, screenshots or shell history.
3. Save/deploy. Keep the existing build and start commands, no pre-deploy
   command, and region Singapore. The existing build command automatically
   selects the direct secret; no other setting change is needed. Verify
   `/health` and `/api/v1/ready` after deployment.

**Emergency commands from Render Shell** (working directory `api`):

```bash
# With the configured, matching MIGRATION_DATABASE_URL: locks stay enabled.
RAILS_ENV=production bundle exec rails db:migrate:status
RAILS_ENV=production bundle exec rails db:rollback STEP=1
RAILS_ENV=production bundle exec rails db:migrate

# Without the secret: pooled fallback, with the stderr warning.
# First ensure no deploy or other migration command is running.
env -u MIGRATION_DATABASE_URL RAILS_ENV=production bundle exec rails db:migrate:status
env -u MIGRATION_DATABASE_URL RAILS_ENV=production bundle exec rails db:rollback STEP=1
env -u MIGRATION_DATABASE_URL RAILS_ENV=production bundle exec rails db:migrate
```

An invalid configured secret deliberately blocks commands; correct it rather
than ignoring an endpoint mismatch. Commands never need URL values in history.
On an existing initialized production database, Rails 8.1 `db:prepare` only
applies pending migrations; it does **not** run seeds. A new/uninitialized DB
can load the schema and seed, which is why identity validation precedes it.

Rules for future migration PRs:

- Prefer the matching direct migration secret. Until it is configured, enforce
  the single-migration-instance assumption operationally.
- Keep `SET LOCAL lock_timeout` inside transactional migrations. A timeout is a
  retryable deployment failure; do not remove the lock timeout to force DDL.
- Use `disable_ddl_transaction!` for concurrent indexes; clean up an interrupted
  invalid index by exact identity before retrying. Session-level settings needed
  outside a transaction must be restored in `ensure` on the direct connection.
- Keep migrations compatible with the previous live release during rollout.
  Do not run seeds, customer-data repairs or destructive backfills automatically.


### Rails Console (Production)

Access via Render Shell:
```bash
cd /rails
bin/rails console
```

---

## Frontend — Netlify

### Site Configuration

| Setting | Value |
|---------|-------|
| Configuration file | `/netlify.toml` (repository root) |
| Build command | `npm run build` |
| Publish directory | `dist` (relative to the `web` base) |
| Base directory | `web` |
| Node version | `20.19.5` (pinned in `netlify.toml`) |
| npm version | `11.6.2` (pinned in `netlify.toml`) |

The checked-in configuration is authoritative. Keep the Netlify dashboard build
settings aligned as an emergency reference, but make build, publish, runtime,
header, and caching changes in the root `netlify.toml` so deploy behavior is
reviewed and reproducible.

The ignore command runs `web/scripts/netlify-ignore-build.sh`. Git deploys run
when the frontend, root Netlify configuration, or root Node version pins change;
API-, mobile-, and documentation-only commits skip the frontend build. Missing
or invalid Netlify commit metadata fails open and runs the build.

### Environment Variables (Netlify Dashboard)

```
VITE_API_URL=https://learn-api.codeschoolofguam.com
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_PUBLIC_POSTHOG_KEY=phc_...
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Production EAS builds should set the matching `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` values for the `csg-learning-platform` project. Native development and demo builds intentionally remain analytics-free.

### Clerk production cutover

Do not replace the development Clerk keys atomically. Existing mobile builds
continue minting development-instance tokens until students install the new
build, while the production website mints production-instance tokens.

1. Deploy the additive `clerk_identities` migration and dual-issuer backend.
2. Run `bin/rails clerk:backfill_identities` and inspect the dry-run. Apply only
   after the counts match the established Clerk roster:
   `APPLY=1 bin/rails clerk:backfill_identities`.
3. Create the Clerk production instance by cloning development settings. Before
   exposing it, set access mode to Restricted, configure the production domain,
   add custom Google OAuth credentials, and register native applications.
4. Configure both explicit issuer/secret pairs on Render, with
   `CLERK_PRIMARY_ENVIRONMENT=development`. Keep the current single-instance
   variables during the rollback window.
5. Run `bin/rails clerk:provision_production_users` and verify that only active,
   non-pending, non-archived Rails users are listed. Apply with
   `APPLY=1 bin/rails clerk:provision_production_users`. This creates verified
   email-only production user shells and identity aliases; it never deletes a
   Clerk or Rails user.
6. Test a Netlify deploy preview and an internal physical-device build using
   the production publishable key. Confirm admin, instructor, student, archived,
   unauthorized, push, and mobile-to-web handoff behavior.
7. Release the production-key mobile build before changing Netlify production.
   Keep both issuers accepted until legacy mobile traffic reaches zero. Before
   the web cutover, rerun the production provisioner in dry-run and apply mode
   so users invited during the rollout window are included; stop if any result
   is `conflict` or `failed`.
8. In the same controlled cutover window, switch Render's
   `CLERK_PRIMARY_ENVIRONMENT` to `production`, switch Netlify production to
   `pk_live_...`, redeploy both, and verify handoffs before announcing success.
   Monitor API 401/403 rates and `[ClerkAuth] legacy_development_session` log
   entries.
9. Retire the development issuer only after an announced mobile upgrade cutoff.
   Keep identity rows through the rollback and audit window.

Rollback is additive: restore Netlify's development publishable key and set
`CLERK_PRIMARY_ENVIRONMENT=development` while the backend continues accepting
both issuers. Do not delete production users, development users, or identity
aliases during rollback.

### SPA Routing

`web/public/_redirects` is the single source of truth for routing. It redirects
the exact production Netlify hostname to the custom domain, serves SEO and PWA
files directly, and then applies the SPA fallback:

```text
https://csg-learn.netlify.app/* https://learn.codeschoolofguam.com/:splat 301!
/robots.txt    /robots.txt    200
/sitemap.xml   /sitemap.xml   200
/manifest.json /manifest.json 200
/sw.js         /sw.js         200
/*             /index.html    200
```

The exact-host canonical redirect does not match deploy-preview or branch
subdomains. Keep specific file rules above the catch-all.

The root `netlify.toml` also applies conservative browser security headers and
one-year immutable browser caching to fingerprinted `/assets/*` files. HTML and
`sw.js` retain Netlify's revalidation behavior so releases and service-worker
updates are not pinned in browsers.

### Custom Domain

DNS for `learn.codeschoolofguam.com` should point to Netlify (CNAME or Netlify DNS).

### Deploy Process

1. Push to `main` triggers auto-deploy
2. Netlify loads `/netlify.toml` and evaluates the ignore command
3. Relevant changes run `npm run build` from the `web/` directory
4. TypeScript project compilation (`tsc -b`) runs before the Vite build
5. Static files from `web/dist/` are deployed to the CDN

Validate a configuration change before merging:

```bash
cd web
npm run check
npm run test:e2e
cd ..
netlify build --dry --offline --context deploy-preview
netlify build --offline --context deploy-preview
```

In the deploy log, confirm the config path is `/opt/build/repo/netlify.toml`,
the current directory is `/opt/build/repo/web`, and the build uses Node
`20.19.5` with npm `11.6.2`.

---

## Database — Neon

### Connection

The `DATABASE_URL` follows this format:
```
postgresql://user:password@ep-xxx-yyy.us-east-2.aws.neon.tech/dbname?sslmode=require
```

### Branching

Neon supports database branching for testing migrations before production:
1. Create a branch in Neon dashboard
2. Use the branch connection string locally
3. Test migrations
4. Merge to main branch

### Backups

Neon provides point-in-time recovery. Check the Neon dashboard for backup settings.

---

## DNS Configuration

| Domain | Points to | Type |
|--------|-----------|------|
| `learn.codeschoolofguam.com` | Netlify | CNAME |
| `learn-api.codeschoolofguam.com` | Render | CNAME |

---

## Post-Deploy Checklist

After first deployment or major changes:

- [ ] Verify health check: `curl https://learn-api.codeschoolofguam.com/health`
- [ ] Verify dependencies once: `curl https://learn-api.codeschoolofguam.com/api/v1/ready`
- [ ] Verify the scheduled cron summary and `bin/rails scheduled:status`; keep the worker suspended until the cron is proven and the lead deletes it
- [ ] If Solid Queue is intentionally restored, deploy the hourly `ScheduledTickJob` recurring registry (including daily unlocks), suspend/wait for the cron, then confirm `./bin/jobs`, scheduler registration and `/api/v1/ready` (`queue: ok`)
- [ ] Verify frontend loads: `https://learn.codeschoolofguam.com`
- [ ] Verify Clerk auth works (sign in with test account)
- [ ] Run seed data if needed: `bin/rails db:seed` via Render Shell
- [ ] Check PostHog is receiving events
- [ ] Confirm custom events match `docs/ANALYTICS_EVENT_CONTRACT.md`, contain no authored content, and report under the `csg-learning-platform` project
- [ ] Verify CORS is working (frontend can call API)
- [ ] Test student and admin flows end-to-end

---

## Troubleshooting

### API returns 500

1. Check Render logs for stack trace
2. Verify `DATABASE_URL` is correct and Neon is accessible
3. Verify `RAILS_MASTER_KEY` matches the production value in your password manager
4. Check if migrations need to run

### Frontend shows blank page

1. Check browser console for errors
2. Verify `VITE_API_URL` points to correct API
3. Verify `VITE_CLERK_PUBLISHABLE_KEY` is set
4. Check Netlify deploy logs for build errors

### CORS errors

1. Verify `FRONTEND_URL` on Render matches the actual frontend URL exactly
2. Check for trailing slashes (should not have one)
3. Verify the API's `rack-cors` configuration

### S3 upload fails after presign succeeds

Symptom pattern:
- Render logs show `POST /api/v1/cohorts/:id/recordings_presign` returning `200 OK`
- the browser upload then fails with a generic network / upload error
- no follow-up `POST /api/v1/cohorts/:id/recordings` appears in Render logs

That points to the browser → S3 hop, not Rails.

Check these in order:
1. `AWS_REGION` on Render exactly matches the bucket’s actual AWS region.
2. `AWS_S3_BUCKET` is the expected bucket.
3. The bucket CORS config includes `https://learn.codeschoolofguam.com`.
4. The bucket CORS config still includes `http://localhost:5173` for local testing.
5. The bucket CORS config allows `PUT` and exposes `ETag`; multipart uploads need both.
6. Browser devtools for the failed S3 request: if the request never gets an HTTP status and fails as a network error, that usually means CORS or region mismatch rather than an API bug.

### Clerk auth not working

1. Verify the token `iss` exactly matches either `CLERK_DEVELOPMENT_ISSUER` or
   `CLERK_PRODUCTION_ISSUER` during the transition.
2. Verify the corresponding secret and JWKS/domain configuration belong to the
   same Clerk instance.
3. Verify the token `azp` is present in that environment's authorized-party
   allowlist.
4. Check for an `identity_conflict` response before changing any user record.
5. Verify Google OAuth, native redirect allowlists, and session settings have
   not changed.

### Database connection issues

1. Check Neon dashboard for service status
2. Verify `DATABASE_URL` SSL settings (`sslmode=require`)
3. Check if Neon compute has auto-suspended (free tier) — first request may be slow


### Self-paced checkout cutover (PR #200)

Keep the existing sales controls off during this deploy. Apply migrations
`20261022030000` and `20261022040000` before serving the updated API. They add
nullable purchase/enrollment snapshots and a nullable JSON checkout-attempt
record. Snapshot constraints use `NOT VALID`, avoiding a scan of existing rows;
there is no purchase or enrollment bulk UPDATE. DDL still needs short table
locks, so use the usual migration lock timeout/retry policy.

Old processes may insert rows with null snapshots after migration. Updated code
fills missing purchase terms from the cohort's current defaults at fulfillment
or first write and saves them; enrollment support catches up on first touch.
Existing access, first-open, and support dates stay unchanged. Historical terms
that were never recorded cannot be reconstructed. Do not add NOT NULL constraints
or remove compatibility handling while old writers or legacy rows may remain.
If an earlier revision of the snapshot migration already ran, do not rerun it:
the compatibility code handles any later null rows.

Finish draining all old API processes before enabling checkout or resuming new
attempts. Old checkout code does not understand the durable attempt record.
Enabling sales is a separate operator decision; this PR changes no sales flags.

A new attempt commits its exact session request and idempotency key before the
Stripe call. Definitive pre-request setup failures are retryable. Lost responses
remain uncertain and can replay only the same stored request/key for 23 hours.
Older uncertain attempts, including legacy pending rows with no session or saved
request, need staff reconciliation in Stripe before any replacement attempt.
Never clear them based only on elapsed time or a network error. This deployment
does not perform reconciliation or call Stripe.

### Shared Resend webhook provenance

Invitations, lesson unlocks and redo notifications include the fixed, non-personal
`application=csg_learn` tag. Message emails use their persisted send identity as
described below. Resend includes tags in signed webhook callbacks, allowing sibling
apps on the shared account to distinguish CSG Learn notifications. Consumers must
still verify signatures and prefer a genuine exact delivery-ID match. Untagged
historical callbacks require evidence-based review. This does not isolate account
access or replace provider permissions.

Provider contract: [Resend email tags](https://resend.com/changelog/tags-for-batch-and-scheduled-emails).

Message and notification rows persist an immutable `email_application` marker.
The additive migration has no default or backfill. Marker creation is disabled
unless `EMAIL_APPLICATION_PROVENANCE_ENABLED=true` exactly; omitted, false or
other values create nil markers. Readers **always** honor a saved marker,
regardless of the creation flag. Nil rows retain their original omitted tags and
provider keys forever. Do not rotate keys, backfill markers or blindly resend to
work around provider conflicts.

Perform the first rollout in two stages. The release owner records source,
deployment and runtime evidence for each stage:

1. Deploy the HafaPass signed-provenance consumer before activating CSG tags.
   Apply the additive migration before starting the new CSG binary. Keep
   `EMAIL_APPLICATION_PROVENANCE_ENABLED` absent or false on every producer.
   Deploy this marker-aware compatibility release to **all** web instances and
   any worker, recovery, task or other email execution path. During this stage,
   old and new execution create untagged message identities, preserving the
   request body under their existing provider keys.
2. Confirm the compatibility deployment is live, old web requests/processes have
   drained, and no old worker or one-off email execution remains. Record active
   instance source and job topology; a green build alone is insufficient. A
   suspended worker must stay suspended or be upgraded before it can run.
   Only then set `EMAIL_APPLICATION_PROVENANCE_ENABLED=true` and deploy the
   **same marker-aware source**. During this second rollout both disabled and
   enabled instances honor saved markers, so they can safely read each other's
   new and legacy rows. Verify the flag and current source on the running
   execution paths without sending a customer email for a deployment check.

Once any marked identity exists, rollback/roll-forward builds must retain these
columns and marker-aware reads. Disabling the creation flag safely stops new
markers; it does not remove tags from existing identities. Reverting to a binary
that ignores saved markers can change a retry payload and cause a provider
idempotency conflict. Do not activate the flag in the initial compatibility
rollout or resume a suspended old worker after activation.

## CI: transaction-pooler compatibility

CI runs the full API suite twice: the existing direct PostgreSQL 16 job and
`API / transaction pooler`. The latter installs Ubuntu's PgBouncer and uses the
checked-in `.github/pgbouncer/pgbouncer.ini`: transaction mode, round-robin
backend selection, and a six-connection server pool (two warm backends). Database creation and schema
load use port 5432 directly; only tests use port 16432. This keeps CI fixture preparation away from the transaction pooler. The production-task subprocess tests use their own disposable local databases. Production prefers the optional matching direct migration secret; without it, the guarded build command uses the warned single-instance fallback described above.

The pooled job uses `PARALLEL_WORKERS=1` to prevent Rails from creating/loading
parallel test databases through PgBouncer. It runs every API test, including the
message-delivery locking tests, without excluding pooler failures. Six slots accommodate two concurrent deliveries with separate work and lock
connections plus test observers; two slots starve those tests. The direct
job retains its existing parallel execution. Each job's Actions duration and
the pooled test command's `time` output provide timing evidence.

Production explicitly sets `prepared_statements: false` (R-7). Neon documents
protocol-level support since PgBouncer 1.22 and a non-configurable tracking limit
of 1000 in its [connection pooling docs](https://neon.com/docs/connect/connection-pooling#neon-pgbouncer-configuration)
and [1.22 announcement](https://neon.com/blog/pgbouncer-the-one-with-prepared-statements).
These sources establish support, not the exact binary currently serving our
endpoint. SQL-level `PREPARE` remains unsupported. We choose the conservative
disablement despite protocol support: enabling it against local PgBouncer 1.24.1
with tracking at 1000 exposed aborted transactions in migration round-trip tests
that drop/recreate columns, even with client cache resets. Keeping statements
off avoids that plan-cache hazard during schema evolution and also works with
older transaction poolers. Rails safely interpolates quoted literals when prepared statements are disabled; PostgreSQL logs can therefore contain literal values.

The CI pooler URL explicitly disables prepared statements; a runtime assertion
checks the live adapter, and production config tests check the resolved production
policy with the migration secret present and absent. Thus changing only the
production YAML or only the pooled test URL fails CI. The full pooled suite
runs without exclusions. Rails' per-process pool remains `RAILS_MAX_THREADS`
or 5, covering Puma's default three request threads; inline jobs execute on
those threads. Reassess capacity before changing job topology. See the PR's
local read-query benchmark and its limits; no production benchmark or endpoint
inspection is performed by this change.

To reproduce on a machine with PostgreSQL, PgBouncer, and the API gems installed
(no production credentials or databases):

1. Create a disposable local test database using the direct URL:
   ```bash
   cd api
   RAILS_ENV=test DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/csg_learning_platform_test bin/rails db:create db:schema:load
   ```
2. From `api/`, start `pgbouncer ../.github/pgbouncer/pgbouncer.ini` in another
   terminal. Adjust the config's database name, backend credentials, and log/PID
   paths for your disposable database. The trust authentication and loopback
   listener are for local/CI use only.
3. Run the suite:
   ```bash
   RAILS_ENV=test PARALLEL_WORKERS=1 DATABASE_URL='postgres://postgres:postgres@127.0.0.1:16432/csg_learning_platform_test?prepared_statements=false' bin/rails test
   ```
4. Stop the exact PgBouncer process you started and drop the disposable database.

All workflows default to `contents: read`; unspecified token permissions are
disabled. Action references are pinned to full commit SHAs with tag comments.
Playwright remains gated on the `VITE_CLERK_PUBLISHABLE_KEY` repository variable:
the repository currently has no such variable, and the public accessibility
suite renders Clerk-backed sign-in/invitation routes. Enabling it without a
usable Clerk test instance would not establish reliable browser acceptance.
The later QA harness work should supply deterministic auth fixtures before
making these checks unconditional. Coverage artifacts are deferred.

Concurrency-test observers must identify a backend inside an open transaction.
A PID read before starting a request can belong to a different backend by the
time the request waits on a lock. Cohort and enrollment-restart tests follow
the live `pg_locks` blocking graph from their pinned holder transaction instead,
including requests queued behind another waiter. Do not enumerate waiters from
`pg_stat_activity` inside that transaction: PostgreSQL caches its activity
snapshot, which can omit worker backends connected after the first poll. Rails
`uncached` only bypasses the Rails query cache, not this server-side snapshot.
The tests deliberately prime the activity snapshot before starting workers and
retain the lock-order and saved-outcome assertions. Polling uses a monotonic
60-second deadline with lock diagnostics rather than interrupting SQL with
`Timeout.timeout`.

## API rate limiting and HTTPS (R-4)

Rails 8.1 built-in `rate_limit` uses atomic cache increments without extra
middleware or dependencies. Limits share buckets across controllers and use
local user IDs after authentication. They never trust unverified JWT claims.
Unauthenticated catalog requests and session bootstrap use `request.remote_ip`.
There is no IP catch-all on authenticated traffic: learners on campus share NAT.

| Requests | Key | Allowance | Window |
| --- | --- | ---: | --- |
| All authenticated application requests | User ID | 1,200 | 1 minute |
| Session bootstrap (`POST /api/v1/sessions`, before JWT verification) | Client IP | 600 | 1 minute |
| Public course offerings | Client IP | 300 | 1 minute |
| Channel/DM message creation and starting a DM | User ID, shared across these actions | 120 | 1 minute |
| Help request creation | User ID | 30 | 10 minutes |
| File/video/recording presign and multipart initiation | User ID, shared uploads bucket | 180 | 1 minute |
| Curriculum ZIP upload creation (`POST /api/v1/curricula/:curriculum_id/resources`) | User ID, same shared uploads bucket | 180 | 1 minute |
| User invitation, resend invite, enrollment creation | User ID, shared across these actions | 180 | 10 minutes |
| Checkout creation (already authenticated in this API) | User ID | 30 | 10 minutes |
| Message search (also used by command palette) | User ID | 900 | 1 minute |
| Existing assistant posting token limit (in addition to user limits) | Token ID | 30 | 1 minute |
| Stripe checkout webhook | Signature verification only | No general limiter | — |

Multipart part URL signing uses only the general 1,200/min user limit: web and installed mobile clients sign each 16 MiB part with concurrency three plus retries, so a shared 180/min cap can interrupt fast multi-GB uploads.

A limit permits N requests and rejects N+1 with HTTP 429,
`{ "error": "Too many requests", "retry_after": N }`, `Retry-After: N`, and
`Cache-Control: no-store`. Here N in the response is seconds, conservatively the
full window (60 or 600), not the request allowance. A blocked request does not
extend the counter's expiry. Other buckets can still have remaining allowance.

The separate 16 MiB `ApiRateLimits::STORE` is a process-local memory store, like
production's current application cache. This is acceptable for the current one
Puma process. Counters reset on restart/deploy and may be evicted under memory
pressure; this is application abuse protection, not an edge DDoS defense. Before
adding workers/instances, replace that one store definition with a shared atomic
increment-capable store and its connection configuration. Do not use the
transaction-pooled Neon database for request counters. No Redis/env change is
needed for this release.

Client sizing was checked against web video saves every 10 seconds
(`VideoPlayer.tsx`), web fallback message refresh every 30 seconds
(`useMessagesRealtime.ts`), native inbox polling every 60 seconds (`_layout.tsx`),
and event-driven unread refresh with a 300 ms debounce (`unread.ts`). The palette
uses a 220 ms search debounce and message search 250 ms. Even continuously
changing searches in three tabs fit the shared 900/min search allowance. The
lesson editor saves explicitly; composer draft autosaves are local storage, not
API calls. No tight limit is applied to progress, lesson edits, grading, polling,
or ActionCable frames. A synthetic replay adds three video saves every 10s,
three sets of notification/message/presence refreshes every 30s, six navigation
reads every 10s, and 60 grades plus detail/list refreshes in the first ten minutes.
It stays below every bucket over thirty minutes.

Web's API client retries transient GET failures with bounded delay and returns
structured errors; native's client retries a GET once then raises `ApiError`,
which existing query/error surfaces handle. A write receives the API's friendly
error without an automatic duplicate write. Neither client crashes on a 429.
They do not yet honor the server's full `Retry-After` duration; generous limits
protect installed TestFlight builds from normal-use throttling. No client code
changed. Device UI behavior was inspected in source, not executed on TestFlight.
The interest form is an external school form, not a route in this API. There is
no GitHub webhook route here; outbound GitHub checks are ordinary authenticated
requests. The separate read-only Home Base token digest is outside these
application controllers and remains unchanged.

### Transport and Render rollout

Render [terminates TLS at its edge](https://render.com/docs/tls); Rails receives
the proxy hop and uses `assume_ssl = true` with `force_ssl = true`. HSTS is one
year, with neither `includeSubDomains` nor preload (this API must not impose
policy on unrelated domains). `ProductionTransport::SSL_OPTIONS` excludes both
`/health` and `/up` from redirects. Render's configured path is **`/health`** per
this runbook, not the database-aware readiness endpoint. Tests exercise the
actual AssumeSSL + SSL middleware stack, forwarded HTTPS/HSTS, secure cookies,
internal HTTP hops, and health exemptions with SSL alone as well.

Production traffic follows client → Cloudflare → Render → Rails. The lead
verified `/health`, one Render instance, `WEB_CONCURRENCY=1`, and Cloudflare
edge addresses in Rails logs on 2026-11-15. `ProductionTransport.trusted_proxies`
retains Rails' loopback/private defaults for the Render hop and adds the published
Cloudflare IPv4/IPv6 ranges from `api/lib/cloudflare_ip_ranges.rb`. That file
records the source, fetch date, etag, and refresh policy. Missing new ranges fall
back to shared edge keying; remove retired ranges promptly to avoid trusting
former proxies. `TRUSTED_PROXY_CIDRS` appends comma-separated **verified proxy**
CIDRs; malformed entries fail boot. Never trust `0.0.0.0/0`, `::/0`, or public
outbound service ranges.

RemoteIp strips trusted hops from the right of X-Forwarded-For, choosing the
nearest remaining client address. Tests cover Cloudflare IPv4/IPv6, multiple
Cloudflare hops, forged leftmost entries (including a forged Cloudflare IP), and
non-Cloudflare peers. Residual: traffic from Cloudflare Workers may carry
attacker-chosen X-Forwarded-For. If that becomes relevant, key the limiter on
`CF-Connecting-IP` when the peer is in a Cloudflare range, after verifying the
actual Render/Cloudflare header and peer behavior.

After deployment:

- Run `curl -i https://learn-api.codeschoolofguam.com/health -H 'X-Forwarded-For: 203.0.113.77'`.
  Render's request log must show the caller's real public IP, neither the forged
  address nor a Cloudflare range. `/health` is silenced in Rails application logs;
  use Render request logs or a temporarily enabled controlled request log.
- Verify HTTPS `/health` and `/api/v1/ready` return 200 and HTTPS API responses
  include HSTS `max-age=31556952` without `includeSubDomains` or preload.
- Verify `http://learn-api.codeschoolofguam.com/health` redirects at the edge;
  the internal Rails health endpoint remains exempt from SSL redirects.
- If logs still show Cloudflare IPs, set `RATE_LIMIT_PUBLIC_BUCKETS=off` and
  redeploy while investigating the chain. This disables only the session
  bootstrap and catalog IP buckets; authenticated user limits stay active.
  The switch defaults to `on`; restore it after verifying real client IPs.

No production dashboard/env change is performed by this PR. Replace the
process-local limiter store before increasing Puma processes or instances.

### Announcement fan-out outbox (R-2)

Migration `20261118150000` adds a nullable fan-out intent, completion time,
recipient snapshot and cursor. Existing publications have no intent and are
never fanned out by the new recovery path. Its DDL uses explicit transactions
with `SET LOCAL lock_timeout`, including through the transaction pooler.

Posting records the active recipient IDs and intent in the publication
transaction. Up to 50 recipients retain the atomic inline path. Larger audiences
use `AnnouncementFanoutJob` with its own in-process async adapter, even when the
ordinary adapter is inline. The request creates no Notification rows for those
audiences. No worker service or queue database is needed. The async enqueue is
only an optimization: after five minutes, the hourly tick recovers unfinished
intents on its own process after releasing its transaction locks. A lost web
process can therefore delay notifications until the next eligible tick.

Fan-out inserts at most 100 recipients per transaction under the announcement
row lock, advancing the cursor in the same commit. The unique source/user index
preserves existing notifications and read state on retries. The stored audience
is fixed at publication; deleted or archived accounts are skipped during delivery.
Edits serialize with inserts and update existing notification copy. Archive stops
remaining batches and push; deletion removes notification rows. Push cannot send
or settle before fan-out finishes, and retains the existing per-provider claims.
The existing 24-hour push expiry still applies after fan-out is complete.

Message delivery deliberately retains its in-lock timing and checkpoints.
Deferring it needs separate durable recovery semantics; R-2 does not change it.

Fan-out recovery failures are logged per callback and back off for one hour;
they do not cancel other callbacks in the same tick. The existing intent timestamp
also records that retry timing. Push expiry after 24 hours is independent of
fan-out completion, so a poisoned fan-out cannot retain an alert indefinitely.
Settled fan-outs clear their stored recipient IDs. Archived updates stay archived;
post a new update rather than restoring an interrupted archived publication.

### GitHub App connections (X-6 slice 2)

Leave `github_app` Off until the App and a disposable repository have been
verified. App access requires **both** School Features → GitHub App access On
and the cohort's feature override explicitly On. Inherit leaves the cohort Off.
Existing cohorts continue using `GITHUB_ORGANIZATION_ADMIN_TOKEN`.

Configure these API environment variables, or the equivalent Rails credentials:

| ENV name | Rails credentials key |
| --- | --- |
| `GITHUB_APP_ID` | `github_app.id` |
| `GITHUB_APP_SLUG` | `github_app.slug` |
| `GITHUB_APP_PRIVATE_KEY` | `github_app.private_key` |
| `GITHUB_APP_CLIENT_ID` | `github_app.client_id` |
| `GITHUB_APP_CLIENT_SECRET` | `github_app.client_secret` |
| `GITHUB_APP_USER_CALLBACK_URL` (optional override) | `github_app.user_callback_url` |

The private key may contain literal newlines or escaped `\n`. Keep it in the
secret store. Installation tokens are minted with RS256 JWTs and cached in
process memory for at most five minutes, with a one-minute expiry margin. A 401
invalidates the cached token and retries once. No key or token is stored in a row
or sent to the browser. Rails `SECRET_KEY_BASE` must be stable for the signed
15-minute setup state to survive API requests.

Register the App for installation on **any account**, including learners'
personal GitHub accounts. Request repository **Contents: read**, **Checks: read**,
and **Metadata: read** (automatic). Prefer selected repositories. Set the App's
Setup URL to `https://learn.codeschoolofguam.com/github-app/setup` (replace the
origin for a separate pilot). This is an authenticated web callback, not a
webhook. Register **User authorization callback URL** separately as
`https://learn.codeschoolofguam.com/github-app/authorize`. The default callback
uses `FRONTEND_URL` plus `/github-app/authorize`; the optional override must use
HTTPS (HTTP loopback is allowed outside production). Keep automatic user
authorization during installation disabled: installation setup and user
identity authorization use separate state purposes. Clerk remains Learn login;
GitHub authorization proves repository ownership. No additional user or
organization-membership permission is required.

In cohort Settings, prepare the installation, open GitHub,
and confirm the callback. Connection generations prevent late failures from
undoing a newer reconnect or successful repository verification. An admin can also confirm an installation ID manually
using that same prepared state. Reconnect through the same flow after revoked
access. A learner's personal installation may require the learner to grant
access on GitHub and share the installation ID with the admin.

The learner first selects **Connect GitHub** in Profile, authorizes their own
account on GitHub, and confirms the returned identity. The server uses a
10-minute authenticated encrypted state bound to the Learn user, enrollment,
client and callback, a one-use nonce, and S256 PKCE. Each preparation also
records a new authorization generation; an in-flight completion cannot replace
a later preparation or completed connection. Preparations from before the
generation migration must be started again. OAuth access/refresh tokens
are used only in memory to read `/user`. Learn then attempts to revoke that user
token with `DELETE /applications/{client_id}/token`, using the existing client
credentials. Revocation is best-effort: a provider failure does not fail identity
connection, and tokens/errors are never logged. A rejected or expired code asks
the learner to Connect again because the one-use state has been consumed. Only
the verified numeric user ID,
login and timestamp are saved; no token or OAuth secret is stored or returned.
Verified IDs are unique across Learn users; duplicate legacy usernames are
untouched. Verified usernames require Reconnect GitHub to change, which resets
binding verification. Case-only username differences are no-ops. Learner
self-edits to a different verified username return 422. Admin edits/re-adds and
archive imports preserve the proven username, identity and bindings, skip a
conflicting username, and warn while applying other valid fields. This avoids
letting stale or manually entered metadata silently unlink a proven identity.
Admin API responses include optional `warnings`, displayed in the staff UI;
archive reports include `students.warnings`, including in dry runs. An OAuth
reconnect remains the only way to change a proven identity. App-enabled users
without proof cannot verify or sync.
Unverified Off cohorts still trust the self-entered username, as before.

In student Access (admin), or Profile (learner), save `owner/repository` as an
enrollment default or a module override, then Verify. Binding saves serialize with cohort copies and return `content_moved` if the
copy moved the enrollment while the request was in flight. Reload, choose the
current module and retry. A module binding takes
precedence even while pending/failed; it never silently falls back to a different
repository. Verification checks installation access, the numeric repository ID,
and ownership by the OAuth-proven GitHub user ID. The personal installation's
account ID and repository owner's ID must both equal that ID. Learners see only
their own personal installations. **Forks and organization-owned repositories
are refused**; this slice has no staff approval override. Changed identity,
renames/transfers and removed access require explicit re-verification/rebinding.
Old submission URLs are not backfilled. Source reads compare GraphQL `fullDatabaseId`
with the numeric binding and do not follow renames. Manual source sync and check refresh use
the App only for these opted-in cohorts; issue delivery and organization
invitations retain their existing paths in this slice.

### Signed GitHub webhooks (X-6 slice 5)

Leave `github_webhooks` Off until the App webhook secret and a disposable
repository have been verified. Webhook processing requires **both** `github_app`
and `github_webhooks` On at the school level AND explicitly On for the cohort.
Inherit leaves the cohort Off; signed deliveries for Off cohorts (including
Cohort 3) still record a bounded `github_webhook_deliveries` receipt marked
`ignored` (pruned by retention), while the cohort's check runs, installations,
and repository bindings remain untouched.

Configure the webhook signing secret in the API secret store (never enter it
into Learn):

| ENV name | Fallback / Rails credentials key |
| --- | --- |
| `GITHUB_WEBHOOK_SECRET` | `GITHUB_APP_WEBHOOK_SECRET` or `github_app.webhook_secret` |

Point the GitHub App webhook URL to `https://<api-host>/api/v1/webhooks/github`
with content type `application/json`. Subscribe manually to the `check_run` and
`push` events in the GitHub App settings; `installation` and
`installation_repositories` events are delivered automatically by GitHub Apps.
The endpoint is mounted
as a pre-controller Rack boundary that enforces the public rate limit, caps raw
reads at 1 MiB (`413`), and authenticates strictly via raw-body HMAC-SHA256
(`X-Hub-Signature-256`) with no Clerk JWT before any JSON parsing or Rails
parameter logging occurs. Unsigned requests return `401` (or `503` if the secret
is unconfigured), and receipt performs zero external GitHub HTTP calls.
Supported events (`check_run`, `push`, `installation`, and
`installation_repositories`) are persisted in `github_webhook_deliveries` by
unique `X-GitHub-Delivery` before returning `200`; unmatched or
provenance-ambiguous events are stored as `staged` for reconciliation. Valid
signed `ping` (and other unsupported) events return `200` with
`status: "ignored"` without inserting a `github_webhook_deliveries` row.

**Redelivery and failed-delivery recovery:** GitHub does **not** automatically
retry `503`/5xx webhook deliveries, and GitHub only supports manual webhook
redelivery for **3 days** (local 14-day retention of `failed` receipts does not
extend GitHub's 3-day redelivery window; no GitHub event replay exists past 3
days).
- **Failures before durable persistence** (for example, a database outage or an
  unconfigured secret returning `503`): within GitHub's 3-day window, redeliver
  the failed event manually from the GitHub App settings (**Advanced → Recent
  Deliveries**) or via GitHub's `POST /app/hook/deliveries/{delivery_id}/attempts`
  REST API once the issue is resolved.
- **Persisted `pending` or `failed` receipts** (written to
  `github_webhook_deliveries` before a local processing error): within GitHub's
  3-day window, redelivering the same `X-GitHub-Delivery` via GitHub manual
  redelivery resumes local processing idempotently.
- **Persisted `staged` receipts (and recovery past GitHub's 3-day window)**:
  redelivering an already `staged` delivery returns its stored `"staged"` status
  without re-running local attachment. Automatic `staged` replay and hourly
  GitHub reconciliation arrive in the follow-up reconciliation slice (X-6.6);
  until then (and for any check data missed past GitHub's 3-day redelivery
  window), operators can use manual **Refresh checks** in the grading workbench
  to fetch current check runs directly from GitHub (separate from webhook event
  replay).

**Bounded retention:** `ScheduledTick`'s `github_webhook_retention` task
performs bounded pruning only (up to 1,000 rows per tick), removing settled
`processed` and `ignored` receipts after 30 days and unconsumed `staged`,
`failed`, or abandoned `pending` receipts after 14 days (also callable manually
via `GithubWebhookDelivery.prune_expired!`).

**Remaining deferred permissions:** add **Issues: write** for the feedback
slice. **Actions: read** is deferred until workflow-run provenance requires it;
repository contents write and organization-membership administration are
unnecessary.

Provider contract references: [user token revocation](https://docs.github.com/en/rest/apps/oauth-applications#delete-an-app-token),
[GitHub user authorization and PKCE](https://docs.github.com/en/enterprise-cloud@latest/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app),
[GitHub App JWTs](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-json-web-token-jwt-for-a-github-app),
[installation tokens and repository restrictions](https://docs.github.com/en/rest/apps/apps#create-an-installation-access-token-for-an-app),
[check-run reads](https://docs.github.com/en/rest/checks/runs#list-check-runs-for-a-git-reference),
and [GraphQL repository identity](https://docs.github.com/en/graphql/reference/repos#repository).
Real App installation, personal/private-repository access and token revocation
still require a disposable staging integration pass before rollout. The local
QA harness simulates the client boundary and blocks external HTTP.

GitHub connection and binding status bypass the offline response cache. A failed
refresh shows an error and preserves the last confirmed state; a saved pending
binding remains visible even if its follow-up refresh fails. Reconnect guidance
appears only when an active enrollment actually offers that control.
