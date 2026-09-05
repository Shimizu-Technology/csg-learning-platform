# CSG Learning Platform — Deployment Guide

**Last updated:** 2026-09-05

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

The suspended worker is a recovery path, not an active execution path. Keep its
automatic deploys disabled and retain `./bin/jobs` as its Docker command so an
accidental resume cannot inherit the Dockerfile's Rails web-server command.

Only create or resume a second Render service when production volume justifies
persistent asynchronous jobs. Before switching to Solid Queue, configure it as:

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
replay, but it does not run recurring schedules.

Rails will fail boot if `ACTIVE_JOB_QUEUE_ADAPTER=solid_queue` is enabled
without either `SOLID_QUEUE_WORKER_PROVISIONED=true` or
`SOLID_QUEUE_IN_PUMA=true`, so jobs cannot silently enqueue with no worker.
It also fails boot if both execution paths are enabled, or if inline mode still
declares Solid Queue infrastructure. Each deployment must have exactly one
job-execution path.
The polling defaults above keep normal notification latency while avoiding the
ten database polls per second caused by Solid Queue's upstream worker default.

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
2. Render's Ruby runtime installs the bundle from `api`
3. The build command runs `bundle exec rails db:prepare`
4. Render starts Puma with `bundle exec puma -C config/puma.rb`
5. Render checks `/health` to confirm the Rails process is serving requests

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

Migrations run automatically via the Docker entrypoint. For manual runs:

```bash
# Via Render Shell:
cd /rails
bin/rails db:migrate
```

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
- [ ] If Solid Queue is enabled, confirm the worker command is `./bin/jobs` and `/api/v1/ready` reports `queue: ok`
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
