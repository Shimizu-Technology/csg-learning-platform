# CSG Learning Platform — Deployment Guide

**Last updated:** 2026-08-15

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
| Runtime | Docker |
| Branch | `main` |
| Root directory | `api` |
| Health check path | `/health` |

Create a second Render service for background jobs before switching production
job delivery to Solid Queue:

| Setting | Value |
|---------|-------|
| Service type | Background Worker |
| Region | Singapore |
| Runtime | Docker |
| Root directory | `api` |
| Docker command | `./bin/jobs` |

The Docker command is required. If it is blank, Render inherits the image's
default Rails web-server command and the service will not process background
jobs.

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

Rails will fail boot if `ACTIVE_JOB_QUEUE_ADAPTER=solid_queue` is enabled
without either `SOLID_QUEUE_WORKER_PROVISIONED=true` or
`SOLID_QUEUE_IN_PUMA=true`, so jobs cannot silently enqueue with no worker.
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
6. Request `/ready`; it should report both `database` and `queue` as `ok`.
7. Trigger one controlled, current notification and verify it is processed once.

The purge is a rollout operation, not part of an application deploy. Do not run
it against production without explicit approval of the report and cutoff.

### Environment Variables (Render Dashboard)

```
RAILS_ENV=production
RAILS_MASTER_KEY=<production Rails master key from your password manager>
DATABASE_URL=<Neon connection string>
FRONTEND_URL=https://learn.codeschoolofguam.com
CLERK_ISSUER=https://<your-clerk-app>.clerk.accounts.dev
CLERK_SECRET_KEY=sk_live_...
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
2. Docker build runs from `api/Dockerfile`
3. `bin/docker-entrypoint` runs migrations automatically on startup
4. Render checks `/health` to confirm the Rails process is serving requests

`/health` is intentionally database-free because Render requests it every few
seconds; it must not keep Neon awake. It is also silenced from production request
logs. `/ready` is the manual dependency diagnostic: it checks PostgreSQL and,
when Solid Queue is enabled, requires a current worker heartbeat and a ready
queue no older than `QUEUE_READINESS_MAX_READY_AGE_SECONDS` (default: 300).

Render must use `/health`, never `/ready`, for its automatic health check. Use
`/ready` only during deployment verification and incident diagnosis.

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
| Build command | `npm run build` |
| Publish directory | `web/dist` |
| Base directory | `web` |
| Node version | 20.19+ or 22.12+ (set in Netlify environment) |

### Environment Variables (Netlify Dashboard)

```
VITE_API_URL=https://learn-api.codeschoolofguam.com
VITE_CLERK_PUBLISHABLE_KEY=pk_live_...
VITE_PUBLIC_POSTHOG_KEY=phc_...
VITE_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

Production EAS builds should set the matching `EXPO_PUBLIC_POSTHOG_KEY` and `EXPO_PUBLIC_POSTHOG_HOST` values for the `csg-learning-platform` project. Native development and demo builds intentionally remain analytics-free.

### SPA Routing

The `netlify.toml` includes a catch-all redirect for SPA routing:

```toml
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
```

### Custom Domain

DNS for `learn.codeschoolofguam.com` should point to Netlify (CNAME or Netlify DNS).

### Deploy Process

1. Push to `main` triggers auto-deploy
2. Netlify runs `npm run build` from the `web/` directory
3. TypeScript compilation (`tsc --noEmit`) runs as part of the build
4. Static files from `dist/` are deployed to CDN

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
- [ ] Verify dependencies once: `curl https://learn-api.codeschoolofguam.com/ready`
- [ ] If Solid Queue is enabled, confirm the worker command is `./bin/jobs` and `/ready` reports `queue: ok`
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

1. Verify `CLERK_ISSUER` matches your Clerk app
2. Check that the JWT contains the expected claims
3. Verify Clerk webhook or session settings haven't changed

### Database connection issues

1. Check Neon dashboard for service status
2. Verify `DATABASE_URL` SSL settings (`sslmode=require`)
3. Check if Neon compute has auto-suspended (free tier) — first request may be slow
