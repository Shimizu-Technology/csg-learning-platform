# Sign-in destinations and No access (B-5, L-0.10)

Source baseline: main `a3f2b52`, including record routes from PR #239 and the
synthetic local harness from PR #227. CSG Learn serves invited students,
instructors and administrators; notification links must retain conversation or
record context without granting additional access. Clerk owns hosted identity;
Rails owns record authorization. Product context: `docs/PRODUCT_VISION.md`,
`web/src/App.tsx`, `web/src/lib/routes.ts` and
`api/app/services/notification_email_service.rb:349`.

Agent-executed affected-flow acceptance on the implementation committed with this
ledger, using Node 20.19.5, Chromium, the real React shell and local Rails API,
synthetic student 3, and owned database `csg_qa_98873_1794709388`.

| Required scenario | Result |
| --- | --- |
| Signed-out email-shaped DM link → synthetic sign-in → exact path/query/hash | Passed at 1280×844 and 390×844 |
| Target DM message visible, highlighted and scrolled into view | Passed at both widths |
| Student opens `/admin/team`: No access, unchanged URL and shared chrome | Passed at both widths |
| No access Back returns to the DM; Go to Today opens `/dashboard` | Passed at both widths |
| No horizontal overflow on No access; no browser page errors | Passed at both widths |
| Relative-only sanitizer, nested encodings, controls, auth loops | Passed in unit matrix |
| Sign-up/invitation widget return configuration and course intent | Passed in unit tests |
| Lesson/submission/student/cohort forbidden and missing record presentation | Passed in regression tests |

The first browser test attempt passed destination/highlight and denial assertions
but its Today action selected both the header logo and content button. Scoping
that action to main fixed the test; the complete rerun passed both viewports.
Browser QA also exposed StrictMode replay dropping the initial message anchor.
The second load now retains route options, with a dedicated replay regression.

Reproduce: start `scripts/qa/run start`, then from `web/` run
`npx playwright test --config ../scripts/qa/playwright.config.ts signin-destinations.spec.ts`.
The local-only Clerk stub supplies a synthetic student sign-in button. Provider
login, actual invitation redemption, email/push delivery, Safari and physical
devices are not certified. Native deep links are out of scope (W3 PR 3.4/W10).
The email fixture matches NotificationEmailService's DM URL; the extra hash tests
retention. Existing service-worker notification anchor checks also pass.

Automated gate passed: both TypeScript projects, ESLint, full Vitest suite
(150 files / 1,485 tests), production
build, bundle budget and Netlify/service-worker checks. API source is unchanged;
no API suite required. Impeccable advisory scan of NoAccess and SignIn returned
no findings. No deployment or production data changes.

Evidence remains locally in ignored `.qa-local/` and `/tmp/signin-*.log`;
screenshots are local QA artifacts. The owned preview tab and Playwright browser
contexts were closed. The harness recorded exact process identities; its clean
command stopped those servers and dropped its synthetic database. Both PIDs
(99001, 99011) are absent and the database catalog confirms removal. Local shared
PostgreSQL remains available. The lifecycle helper is unavailable on this mini.

## Review fix round 1 — 2026-11-15

Baseline: PR head `4089604`, merged with `origin/main` (`46de161`, including
#242 and #243). Both conflicting submission-review regression cases were kept.
Work ran in `/Users/agent/work/csg-wt-245` on `fix/pr245-round1`; the shared
checkout was untouched. Push targets `feat/signin-destinations` explicitly.

The normalized-path check closes an open redirect also present on main in
`return_to` and `source_return_to`. Tests cover all four reported dot-segment
inputs, nested encoded variants, the encoded course-intent reproduction,
same-origin absolute mobile handoffs, auth-screen switches/defaults, and literal
percent queries. Notification and Activity navigation now use the shared
sanitizer. The mobile audit found strict numeric route/context allowlists,
not a generic return-URL normalizer; those allowlists remain in place.
Conversation load options are tied to their originating target and reset on an
empty/different selection, preserving StrictMode replay without stale anchors.
A regression exercises the directory's functional default-selection shape.

Agent-executed Chromium harness rerun passed both 1280×844 and 390×844:
signed-out DM link → synthetic sign-in → exact path/query/hash, visible highlighted
message, wrong-role No access, Back and Today recovery, no overflow/page errors.
Source: review-fix code committed with this entry, after integrating main.
Hosted Clerk, actual mobile handoff authentication, Safari and physical devices
remain untested; absolute handoff configuration is covered by unit tests.

Node 20.19.5: both TypeScript projects, ESLint, 150 Vitest files / 1,518 tests,
production build, bundle budget and Netlify checks passed. Impeccable advisory
scan of SignIn and StaffActivityFeed returned no findings. Final review of these
fixes remains for the lead/independent reviewer; no merge or watch requested.

Lifecycle helper could not begin: `Invalid machine profile: schema_version must
be 1`. The harness recorded exact process/start identities (9899 and 9902),
then its clean command stopped both and dropped `csg_qa_9861_1794710281`.
PID inspection and the database catalog confirmed removal. Existing listeners
and shared PostgreSQL were left running. Playwright contexts closed on exit.
