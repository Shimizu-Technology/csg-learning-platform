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

## Initial implementation evidence (06d416a3)

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

The lead verified Render `/health`, one instance, `WEB_CONCURRENCY=1`, and
Cloudflare edge IPs in Rails logs on 2026-11-15. The original private-proxy-only
configuration was insufficient for that chain; Fix round 1 below supersedes it.
The runbook now contains explicit post-deploy IP/HSTS/redirect checks and the
public-bucket kill switch. These production checks remain for the lead/operator.
Switch the centralized rate store before scaling. The isolated read-only Home
Base token digest remains unchanged.

Do not merge or watch this PR: the parent agent owns review and release.
The local lifecycle helper rejected the machine profile with
`Invalid machine profile: schema_version must be 1`. No servers/tabs/containers
were created. The shared PostgreSQL service was already available and is left
running; the task database is dropped after gates. The branch/checkout remains
available for review.

## Fix round 1

Branch `fix/rate-limits` in `/Users/agent/work/csg-learning-platform`.
`git fetch`, checkout, fast-forward pull, and merge of `origin/main` completed;
no incoming changes were needed (base remains `0b117583`). Acceptance is API-only,
agent-executed affected-flow verification against a fresh local PostgreSQL
`csg_rate_limits_round1_test` database loaded from schema without seeds.

- Fetched Cloudflare's published ranges directly from
  `https://api.cloudflare.com/client/v4/ips` on 2026-11-15 UTC, etag
  `38f79d050aa027e3be3865e495dcc9bc`: 15 IPv4 and 7 IPv6 CIDRs.
  `ProductionTransport.trusted_proxies` adds them to Rails defaults and optional
  verified `TRUSTED_PROXY_CIDRS`. Source/freshness guidance lives with the lists.
- Required acceptance passed: real RemoteIp middleware resolves all six supplied
  Cloudflare/forged-header/IPv6/non-Cloudflare chains with private REMOTE_ADDR;
  list validity, family, nonemptiness, optional proxies, and malformed config
  are checked. Host-only HSTS and full-window Retry-After remain unchanged.
- Required acceptance passed: the actual `create_direct` message route consumes
  the last shared messages allowance before resource lookup; starting a DM and
  another direct-message request then both return JSON 429 without writes.
  This is route/limiter proof, not a claim of new end-to-end DM delivery QA.
- Required acceptance passed: every controller including AuthenticatedRateLimits
  has all seven limiter callbacks after its authentication callback, including
  AgentPostingTokensController's `require_admin!` and agent token authentication.
- Required acceptance passed: `RATE_LIMIT_PUBLIC_BUCKETS=off` skips both public
  counters while the authenticated catch-all still rejects exhausted users.
  Default configuration retains public limits.
- Focused suite: 24 tests / 10,331 assertions, no failures/errors/skips.
- Full gate: 1,266 tests / 35,805 assertions, no failures/errors/skips.
- RuboCop: 544 files, no offenses. Brakeman: zero warnings, one existing ignored
  warning. Zeitwerk passed; bundler-audit found no vulnerabilities.
- Production-mode Rails boot with a dummy secret and local DATABASE_URL passed:
  all 22 Cloudflare CIDRs and Rails defaults appear in configured trusted_proxies;
  assume_ssl, force_ssl, and host-only HSTS were asserted.

Deployment checks and real client/header behavior are not run here. The runbook
records the Cloudflare Workers attacker-chosen XFF residual and conditional
CF-Connecting-IP mitigation. No frontend/native changes; device QA is not run.

The lifecycle helper again failed with `Invalid machine profile: schema_version
must be 1`; its local profile file is absent. No app servers, browser tabs,
containers, or simulators were started. PostgreSQL was already running and is
borrowed. The task database was dropped after validation. Preserve this checkout
and branch for the lead; no runtime resources are handed off. No merge or watch.
