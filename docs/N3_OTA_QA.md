# N-3 OTA preparation: evidence and release handoff

## Scope and acceptance

2026-11-17; branch `feat/ota-updates`, based on main `ca370b52` (#289).
Sources: `MOBILE_APP.md`, `W10_MOBILE_DEEP_LINKS_QA.md` (#286), the Expo app/EAS
config and SDK 57 package manifest, and the Brain Dump's
`code-school/csg-learning-platform-plan.md` for product purpose (historical).
Current behavior was verified in this checkout rather than inferred from that
older plan. CSG Learn serves students and staff against the shared Rails records;
message composition and coursework/submissions must survive update availability.
The native companion uses Clerk, Expo Router, user-scoped persisted drafts and
the same API authorization boundary as web.

Implementation acceptance: existing EAS project, fingerprint runtime isolation,
production/preview channel mapping, throttled launch/foreground checks, staged
downloads with no programmatic reload, a dismissible restart notice, silent
failure, SDK-matched installation, passing mobile checks and iOS export. Scope is
code/config/docs only; API/web and EAS/store settings are unchanged. No EAS
login, project/channel creation, build, submission or update was performed.

## Agent-executed automated evidence

Environment: shared MacBook, native arm64 Node 22.22.3, Expo SDK 57. No new
server, simulator, browser tab, container or real account fixture was started.
These results cover this branch's implementation; the PR head identifies the
tested source. Existing borrowed services/simulator were left unchanged.

- `npx expo install expo-updates`: installed `~57.0.28` using SDK resolution.
- `npm run check`: generated brand assets, URI-decoder regression checks,
  typecheck, lint, and **140 Jest suites / 1,522 tests pass**. Lint has existing
  warnings; the added files have no lint findings after the focused recheck.
- The new 14-test suite covers launch/foreground throttle, overlapping requests,
  development/Expo Go/disabled/web guards, background download completion,
  rollback-to-embedded, failed checks/downloads, absent updates and unmount cleanup.
  Its interaction fixture mounts the real hook and notice alongside an editable
  persisted submission draft and pending submission. Dismissing **Later** keeps
  the draft/input, lets the submission complete, and never calls `reloadAsync`.
  Initial fixture failures (Jest's mocked AppState property and the safe-area
  mock's default export) were corrected; the complete suite then passed.
- `npx expo config --type public --json`: resolves SDK 57, the existing project
  ID/updates URL, fingerprint policy, `ON_ERROR_RECOVERY`, zero startup wait and
  `applinks:learn.codeschoolofguam.com`.
- `npx expo install --check`: passes. `npm run audit:dependencies`: passes the
  repository's existing explicit advisory policy; no new high/critical exception.
- `npx expo export --platform ios --max-workers 2`: passes (4,771 modules).
- Advisory Impeccable scan of the notice and root layout: `[]`. This static scan
  does not establish native visual/usability acceptance.

## Device and delivery acceptance: pending operator execution

| Case | Required starting fixture and expected outcome | Status |
| --- | --- | --- |
| N3-D1: signed next binary | EAS access + signed production archive; verify source/build/runtime/channel, Associated Domains and profile, exact TestFlight tester availability | Blocked: no credentials/build in implementation scope |
| N3-D2: real OTA transport | Install D1, publish an agreed matching-runtime JS fix; launch/foreground download once, no reload during composer/submission/upload, dismiss notice, finish task, cold start into the fix with drafts intact | Blocked: requires D1 and an authorized publication |
| N3-D3: recovery/isolation | Compatible preview builds, known-good and bad test groups; verify republish/embedded rollback, retained drafts, offline/retry and different-runtime rejection | Blocked: requires preview delivery fixtures |
| N3-D4: native usability | Actual iPhone, keyboard open, VoiceOver and large text; notice remains readable/dismissible without obscuring task controls or losing focus/context | Not run: release-mode notice cannot be validated in Expo Go |
| W10-D1: #286 combined regression | Student/instructor/admin and two-cohort fixtures; execute all 8 original and 5 additional iPhone checks from W10 | Not run: next signed binary still required |

Automated mocks do not prove provider transport, signed entitlements, Apple
association caching, native layout or actual cold-start activation. Builds 41/44
have not been inspected. The implementation PR is held for the lead, with native
delivery acceptance separate from its automated checks and review status.

Next action: follow [Release and OTA updates](MOBILE_APP.md#release-and-ota-updates)
with Leon: verify existing EAS routing/environment, login, build, submit the exact
build, install and verify #286, then publish/verify the first agreed OTA fix.
That section also contains the rollback commands and combined next-build list.
