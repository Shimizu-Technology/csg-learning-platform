# W10 PR 10.3: mobile entry and web return

Orientation: 2026-11-17, based on main `3ec803d7` (#285), with #265, #270,
#279 and #282 already present. Sources: MOBILE_APP.md, CONNECTED_EXPERIENCE_PLAN.md,
DEPLOYMENT.md, BRANDING.md, RecordDestination, RecordRelated, and the shared
record-destination and notification-wire fixtures. Students use their own learning
records; staff use authorized learner/cohort context. Rails remains the access
boundary. The public web origin is https://learn.codeschoolofguam.com.

Acceptance: incoming URLs and notification taps retain record context, wait for
sign-in/session/policy readiness, and never mount staff screens for students.
Supported records open natively. Other valid paths offer an authenticated web
handoff instead of silently opening Updates. Returning from that sheet invalidates
the account's queries and refetches active queries. Staff meeting taps open the
exact web booking automatically, with a retry action after failure.

## Automated evidence

- Mobile: typecheck; lint (existing warnings); public Expo config resolution;
  137 Jest suites / 1,466 tests. Used `--forceExit` after completed suites left
  timers open; earlier test processes were stopped by exact PID.
- Web: lint, typecheck, 207 Vitest suites / 2,415 tests, Netlify routing,
  production build and bundle gate. The bundle gate reads
  `dist/.well-known/apple-app-site-association`; routing tests verify its explicit
  rule before the SPA fallback and its JSON Content-Type rule in netlify.toml.
- API: results recorded in the PR after the full prepared/unprepared runs,
  RuboCop and Brakeman. No migration or API response shape changed.
- Shared fixtures exercise both client adapters and Rails; the alias table is
  `api/config/record_destination_aliases.json`. Existing invalid-recording-id
  behavior is covered: `/recordings?cohort_id=2` cannot become `/recording/`.
- Automated interaction coverage includes policy/sign-in remounts, notification
  stack/back behavior, learner rejection of staff destinations, one-tap meeting
  handoff, invalid meeting context and sheet-close refresh events.

These are automated checks, not physical-device acceptance. No simulator,
physical device, live push delivery, deployed Netlify response or Apple domain
association was exercised on this host. No EAS build or store setting changed.

## Leon's iPhone check after the next native build

Use a student and an instructor account with a real cohort, lesson, booking and
submission. Use a second enrolled cohort to check that context does not switch.
Run these on both a terminated app and a running/backgrounded app where applicable.

1. From Mail or Notes, tap production HTTPS links to a lesson/block, submission,
   student workspace, recording and meeting. Confirm the correct record/cohort,
   and Back returns to a usable tab. Confirm Messages and Learn do not stack tabs.
2. Repeat lesson entry while signed out; complete sign-in and, with a fixture
   requiring it, policy acceptance. Confirm the link opens once after the gates.
   Sign out again and confirm an earlier link does not reopen for another account.
3. Tap `csglearn://lessons/<id>` and `csgconnect://lessons/<id>`. Both must open
   the new build. Test unknown and unsupported paths: a clear fallback appears;
   Open on the web uses the authenticated sheet and has recovery after failure.
4. As a student, tap staff student/submission/curriculum and unsupported admin
   links, including a notification fixture. No staff screen or staff handoff
   action may appear. Verify ordinary student lesson/cohort links still work.
5. Create, move and cancel a meeting. Tap its actual push as student and staff.
   Staff must reach the exact web booking after one tap; visible labels must use
   human text rather than booking IDs. Dismiss and retry after a handoff failure.
6. Enroll an existing signed-in user and check the existing enrollment notice
   produces a push opening that cohort. Pending invitations retain their current
   invitation flow. Check disabled mobile/web push preferences suppress delivery.
7. Open a web handoff from a native screen, change a relevant record, dismiss the
   sheet and confirm native data refreshes without pull-to-refresh. Repeat with
   poor connectivity; cached data and retry should remain usable.
8. Verify VoiceOver, large text, safe areas and sheet dismissal on the fallback
   and meeting screens. Confirm the signed-in web sheet does not bounce back
   into the app during its authentication redirect.

## Build identity and follow-ups

Expo source already registered both csgconnect and csglearn before this change.
The Apple team is `4T358A5S74` (existing eas.json submission config), bundle ID
`com.codeschoolofguam.connect`. Associated domains and URL scheme registration
are compiled native capabilities: this work needs a new native build plus the
above iPhone check. The checkout contains no generated ios project or build 41/44
artifacts. Read-only EAS build:list was attempted but this host has no Expo login; their actual Info.plist scheme registration is unverified. Inspect the
installed/archive artifacts for those builds rather than assuming Expo source
proves what they contain. Older binaries cannot gain universal links via JS.

Deploy the web association file and inspect the production HTTPS response before
new-build device acceptance. Apple caching and entitlement provisioning also need
device verification. OTA updates (N-3) remain out of scope.
