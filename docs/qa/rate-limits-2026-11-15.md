# R-4 implementation and affected-flow verification

API-only work on `fix/rate-limits`, based on `origin/main` at `0b117583`.
Executor: implementation agent, Mac mini, local PostgreSQL test database
`csg_rate_limits_test`. No production data, provider calls, UI changes, or
production configuration mutations were used.

## Context and acceptance

`PRODUCT_VISION.md` describes the student/instructor/admin learning hub;
`DEPLOYMENT.md` specifies Render Singapore, `/health`, Netlify, and Neon.
`production.rb` currently uses memory caching and inline jobs. Clerk handles
identity. This change must protect abuse-prone API operations while preserving
multi-tab progress/polling, staff grading, signed webhook retries, and Render
health checks. It must avoid the parallel W11 query/pagination work.

## Evidence

- Each new rate policy: synthetic controller requests exercise the actual Rails
  limiter callback, allow N, reject N+1, reset after expiry, and isolate users or
  forwarded IPs. API 429 JSON and `Retry-After` are asserted.
- Real catalog route through integration middleware: exhausted forwarded-client
  bucket returns 429; another forwarded client returns 200.
- Shared catch-all: exhausted user bucket rejects requests in different
  controllers. Every Clerk controller is checked for limiter installation;
  includes occur after authentication and before resource queries.
- Webhooks: 3,001 callback requests remain unthrottled; actual signed synthetic
  no-op events and repeated deliveries return 200. Missing signature returns
  400. Existing fulfillment tests remain part of the full gate.
- Heavy-use replay: thirty minutes of three-tab progress, message/notification
  polling, presence and navigation, plus sixty grades/detail/list refreshes in
  ten minutes. All requests succeed at the limiter boundary. These use synthetic
  users/actions, not expensive application writes or real notifications.
- Production transport: actual ActionDispatch AssumeSSL + SSL stack accepts
  forwarded HTTPS and internal HTTP without a redirect loop, sets HSTS and secure
  cookies, and excludes `/health` and `/up` from SSL-only HTTP redirects.
  RemoteIp middleware strips private hops and ignores a forged leftmost IP.
- Production-mode Rails boot with a synthetic secret and local database URL
  confirmed both SSL flags and the AssumeSSL/SSL/RemoteIp middleware stack.
- Client source inspection: bounded web GET retries, native ApiError/query
  handling, and preserved failed-send UI. Existing installed builds do not honor
  the full Retry-After interval; normal-use limits accommodate them. No clients
  changed, so web/mobile build gates and physical-device QA were not run.

Commands use `DATABASE_URL=postgresql://localhost/csg_rate_limits_test` and
`PARALLEL_WORKERS=1` for API tests. Full tests, RuboCop, Brakeman,
`RAILS_ENV=test rails zeitwerk:check`, and bundler-audit are the local gates.
An initial `db:prepare` seeded application records and contaminated baseline
expectations. The database was recreated with `db:schema:load` without seeds;
the final full-suite run passed: **1,261 tests, 34,558 assertions, zero failures,
errors, or skips**. RuboCop inspected 543 files without offenses; Brakeman
reported zero warnings (one pre-existing ignored warning), Zeitwerk passed,
and bundler-audit reported no vulnerabilities.

## Handoff and release limits

The deployment runbook contains the limits table and rollout checks. Before
merge, the parent agent must confirm Render `/health`, single Puma process,
edge-only TLS ingress, and the real forwarded-IP chain. No required env change
or new service is introduced. Only append verified proxy CIDRs if actual
proxy topology needs them. Switch the centralized rate store before scaling.
The isolated read-only Home Base token digest remains unchanged.

Do not merge or watch this PR: the parent agent owns review and release.
The local lifecycle helper rejected the machine profile with
`Invalid machine profile: schema_version must be 1`. No servers/tabs/containers
were created. The shared PostgreSQL service was already available and is left
running; the task database is dropped after gates. The branch/checkout remains
available for review.
