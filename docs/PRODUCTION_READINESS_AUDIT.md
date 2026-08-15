# Production Readiness Audit

**Audit date:** 2026-07-26
**Scope:** Rails API, React web app, Expo/React Native app, CI, and deployment runbooks
**Tracks:** observability, end-to-end testing, accessibility, and operational resilience

## Executive summary

The application has a strong security and unit/integration-test foundation, but
it did not yet have a real readiness probe, browser-level accessibility gates,
or a checked-in native E2E flow. It also logged recipient email addresses and
complete email-provider responses in several delivery paths.

This pass adds the highest-confidence protections that can be verified locally:

- `/health` is a database-free process check so frequent platform probes do not
  wake Neon; `/ready` checks PostgreSQL and background-worker readiness without
  exposing connection details.
- legacy invite and notification logs now use internal IDs and delivery IDs
  rather than email addresses, content titles, or full provider responses.
- the web app has a top-level error boundary that reports render failures to
  PostHog when PostHog is configured and gives the user a usable recovery path.
- Playwright and axe now exercise the public web experience in desktop and
  mobile browser profiles.
- a Maestro iOS flow now exercises native navigation, a conversation, the
  keyboard/composer, and the profile screen using the real accessibility tree.
- a second Maestro route audit exercises every shipped mobile screen, including
  staff student health, grading, recording upload, learning, messaging, and
  communication administration.
- accessibility fixes cover twelve serious web contrast failures, duplicate
  composer announcements, unlabeled modal dismiss surfaces, and password-reset
  semantics.

The system is in good shape for its current scale, but production incident
detection is not complete until the external monitoring, alerting, backup
restore, and authenticated E2E items below are configured and rehearsed.

## Verified baseline

| Surface | Verification | Result |
| --- | --- | --- |
| Rails | Minitest | 308 tests / 945 assertions passed |
| Rails | RuboCop | 222 files, no offenses |
| Rails | Brakeman | no warnings (one documented ignored warning) |
| Rails | bundler-audit | no vulnerable gems |
| Web | Vitest | 5 suites / 21 tests passed |
| Web | ESLint, TypeScript, production build | passed |
| Web | dependency policy | no unacknowledged high/critical advisories |
| Web | Playwright + axe | 6/6 desktop/mobile checks passed |
| Mobile | Jest | 19 suites / 63 tests passed |
| Mobile | ESLint and TypeScript | passed |
| Mobile | Expo Doctor | 20/20 checks passed |
| Mobile | Expo dependency validation | passed |
| Mobile | Maestro iOS smoke and route flows | composer/keyboard flow plus every shipped route passed |

Run the complete local gates with:

```bash
cd api && bundle exec rails test && bundle exec rubocop && bundle exec brakeman --no-pager && bundle exec bundler-audit check --update
cd ../web && npm run check && npm run audit:dependencies && npm run test:e2e
cd ../mobile && npm run check && npm run audit:dependencies && npx expo-doctor
```

The native flow additionally requires a booted iOS simulator, a development
build, Maestro, and demo-mode Metro as documented in `mobile/README.md`.

## Mobile reliability findings

### Student health 500

The failure was server-side, not a native rendering issue. Both staff
lesson-video progress queries joined Rails' `CurriculumModule` model but
referenced `curriculum_modules` in SQL. The model's physical table is `modules`,
so PostgreSQL raised `PG::UndefinedTable`. Both the individual-student and
cohort-matrix queries now use the real table alias, with integration coverage
for each endpoint. The native student page also isolates optional submissions
and video panels so a secondary endpoint failure no longer replaces the entire
student profile with a fatal error.

### Instructor recording paths

The audit found three distinct media paths:

1. uploaded class recordings use staff-authorized presigned S3 POST below
   100 MB and multipart upload through 5 GB;
2. YouTube/Vimeo/external recording links remain a supported cohort fallback;
3. curriculum lesson-video authoring remains an admin-only web workflow.

The production bucket accepts the web origin for POST and PUT and exposes ETag,
so CORS and instructor API authorization were not the reported blocker. The
actual product gap was that the native app offered playback but no publishing
screen. Staff can now select an active cohort and publish a device video
directly from mobile using the same Rails/S3 contracts, with retry, abort, and
orphan cleanup behavior covered by tests. Bucket lifecycle configuration could
not be inspected with the locally available least-privileged AWS identity;
the one-day incomplete-multipart cleanup rule still requires console
verification.

### Restarting a live-class enrollment

Restart is intentionally scoped to one enrollment and its curriculum instead
of deleting or recreating the user. It preserves Clerk identity, account
access, messages, workspace memberships, other curricula, and module
assignments. It clears that curriculum's progress and submissions, the
cohort's recording progress, lesson-level overrides, submission notifications,
and module unlock-date overrides. The API writes a complete audit/recovery
snapshot in the same transaction before removal. Only admins can run it, the
student's exact email must be typed, and any second enrollment using the same
curriculum blocks the operation because progress records are currently
user-and-content scoped rather than enrollment scoped. A reset-generation
timestamp and enrollment row lock reject learning writes that began before the
reset committed, preventing an in-flight player or submission request from
recreating cleared state.

## Findings by track

### Observability

#### Implemented

- Readiness now checks the database and has deterministic `200`/`503` JSON.
- Readiness failure logs include the failed dependency and exception class, but
  never return internal exception text to clients.
- web and native render failures recover through branded error boundaries;
  production native builds also capture uncaught JavaScript failures,
  unhandled rejections, native crashes, and content-free voice-state breadcrumbs
  through the existing PostHog project.
- delivery logs retain useful correlation fields (`user_id`, `message_id`,
  `notification_id`, provider delivery ID) without direct recipient PII.
- Rails request IDs are already included in production log tags.

#### Remaining external work

1. Monitor `GET /health` continuously for process health. Request `/ready`
   manually during deploys and incidents for application/database/queue
   readiness; do not poll it continuously because it intentionally checks Neon.
2. Alert only after two or three consecutive failures to avoid Guam-to-Singapore
   network blips creating false incidents.
3. Add centralized exception monitoring for Rails. PostHog now covers web and
   native render exceptions plus native crashes, but Rails still has no
   centralized exception tracker or error-reporting subscriber.
4. Define alert ownership and a notification path. A useful initial policy:
   - readiness failure for 2 minutes: urgent;
   - API 5xx rate above 2% for 5 minutes: urgent;
   - p95 API latency above 1.5 seconds for 10 minutes: investigate;
   - background delivery failures above 5 in 10 minutes: investigate.
5. Create a privacy-safe logging rule: never record access tokens, email
   addresses, message bodies, submission text, signed S3 URLs, or full provider
   response objects.

### End-to-end testing

#### Implemented

- Playwright launches the production Vite preview and runs public journeys in
  desktop Chromium and a mobile Chromium profile.
- axe checks WCAG 2 A/AA and 2.1 A/AA rules, failing on serious or critical
  violations.
- keyboard navigation is tested from the home page into sign-in.
- Maestro runs against an iOS development build and confirms the real native
  view/accessibility tree, message composer focus and typing, and tab navigation.
- the full native route audit opens staff/student health, grading, submission,
  recordings, recording upload, resources, modules, lessons, playback,
  channels, threads, compose, search, updates, profile, and communications
  management.
- screenshots, traces, video, and native debug artifacts are retained on
  failures and ignored by Git.

#### Remaining work

1. Configure a Clerk test instance and dedicated fixture accounts so CI can
   cover authenticated student, instructor, and admin journeys without using
   production identities.
2. Seed an isolated E2E database with deterministic cohorts, lessons,
   submissions, messages, and role assignments.
3. Add the critical authenticated web journeys:
   - student sign-in, open lesson, submit work, resume video;
   - instructor open grading queue, grade, request redo;
   - admin switch cohort/workspace and manage access;
   - messaging send, edit, react, thread, attach, search, and unread behavior.
4. Add mobile release-build flows for Google sign-in handoff, offline cache,
   reconnect, push deep links, attachment/image preview, learning, and grading.
5. Run the fast public web suite on every pull request. Run authenticated web
   and native suites on merge/nightly once test credentials and a device runner
   are available.

### Accessibility

#### Implemented

- corrected twelve serious WCAG contrast failures on the public web home page;
- added desktop and mobile automated axe coverage;
- verified keyboard navigation through primary public controls;
- corrected the native composer announcement and added a contextual hint;
- labeled the password-reset control and modal dismissal surfaces;
- verified native controls through the iOS accessibility hierarchy.

#### Remaining work

1. Extend axe coverage to every authenticated route using the test accounts and
   fixtures described above.
2. Complete manual VoiceOver and TalkBack passes. Automated trees cannot verify
   announcement order, rotor usability, focus restoration, or gesture comfort.
3. Test iOS and Android at the largest system text size and with button shapes,
   bold text, increased contrast, reduce motion, and reduce transparency.
4. Test web at 200% and 400% zoom, Windows High Contrast Mode, and keyboard-only
   use in curriculum authoring, grading, data tables, dialogs, and rich editors.
5. Add focus restoration tests for dialogs, message actions, pinned messages,
   image preview, and route transitions.

### Operational resilience

#### Implemented or already present

- database-free process health plus manual database/queue readiness;
- production boot guard prevents Solid Queue from being enabled without an
  acknowledged worker path;
- notification fan-out isolates web and Expo delivery failures;
- push registration, deep-link allowlisting, upload cleanup, and message
  idempotency have dedicated tests;
- dependency, static security, lint, type, unit, and bundle checks run in CI;
- S3 multipart uploads can be aborted by the client/API.
- native recording upload uses retryable 16 MB multipart parts above 100 MB,
  aborts failed multipart sessions, and abandons objects if database publishing
  fails.
- enrollment restart is admin-only, requires exact-email confirmation, blocks
  ambiguous shared-curriculum enrollments, and records a recovery snapshot
  before deleting enrollment-scoped learning data.

#### Remaining work

1. Keep Render's automatic health-check path on the database-free `/health`.
2. Verify Neon's point-in-time recovery settings and perform a quarterly restore
   into a non-production project. Record recovery time and the latest restorable
   timestamp; a backup is not proven until a restore succeeds.
3. Enable the documented S3 rule that aborts incomplete multipart uploads after
   one day, then verify it in the AWS console.
4. Keep the dedicated Singapore worker's Docker command set to `./bin/jobs` and
   alert on `/ready` failures, which cover worker heartbeat and oldest ready-job
   age when Solid Queue is enabled.
5. Add rate limits to authentication/session exchange, presigning, uploads,
   message sending, search, invitations, and push-token registration. Prefer
   per-account limits with a generous IP fallback so shared classroom/NAT
   networks are not punished.
6. Verify proxy-aware HTTPS enforcement and an explicit production host
   allowlist in a staging deploy before enabling them in Rails.
7. Rehearse rollback for API migrations, Netlify deploys, and TestFlight builds.
   Database changes should remain backward-compatible for at least one deploy.
8. Create an incident runbook containing owners, dashboards, provider status
   links, rollback steps, and student communication templates.

## Recommended order

1. Deploy this code and keep Render's automatic probe on `/health`; use `/ready`
   manually during verification.
2. Configure uptime monitoring and remote Rails/mobile exception reporting.
3. Create the isolated Clerk/E2E environment and make the public Playwright
   suite a required PR check.
4. Run and document the first database restore and S3 lifecycle verification.
5. Add authenticated role journeys, then expand manual assistive-technology
   coverage.
6. Introduce measured rate limits and queue monitoring using production traffic
   data rather than guessed thresholds.

## Release gate

Before a production or TestFlight release:

- all existing Rails, web, and mobile checks pass;
- Playwright public accessibility checks pass;
- the Maestro native smoke flow passes on the target iOS runtime;
- the Maestro native route audit passes every shipped mobile route;
- `/health` returns `200` without touching the database and `/ready` returns
  `200` against deployment dependencies;
- no migration is destructive to the previous deployed application version;
- provider configuration is present for Clerk, Resend, S3, push, and analytics;
- rollback owner and previous known-good release are identified.
