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

## Original automated evidence (`e71feb14`, superseded where changed below)

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
| N3-D2: real OTA transport | Install D1 for the TestFlight production-channel tester group; confirm production EAS API/Clerk values, reinstall/compare via the guard and publish only the agreed harmless copy change; download without reload during composer/submission/upload, dismiss notice, finish task, cold start into the change with drafts intact | Blocked: requires D1 and an authorized publication |
| N3-D3: recovery/isolation | Matching TestFlight production-channel build and agreed harmless copy group; with Leon's release approval verify republish/embedded rollback, retained drafts, offline/retry and different-runtime rejection | Blocked: no OTA-capable installed binary yet; no preview/ad hoc binary exists. Crash-injection rehearsal is deferred until a separate test binary is provisioned |
| N3-D4: native usability | Actual iPhone, keyboard open, VoiceOver and large text; notice remains readable/dismissible without obscuring task controls or losing focus/context | Not run: release-mode notice cannot be validated in Expo Go |
| W10-D1: #286 production regression | Student/instructor/admin and two-cohort fixtures; execute all 8 original and production-capable portions of the 5 additional iPhone checks | Not run: next signed binary still required |
| W10-D2: dev-client OAuth half of Fix round 1 check 5 | Separately provisioned dev-client binary; verify held lesson across `exp+csg-connect://oauth-callback` | Blocked: no dev-client binary exists; production `csgconnect` alone does not pass this case |

Automated mocks do not prove provider transport, signed entitlements, Apple
association caching, native layout or actual cold-start activation. Per the lead's
independent archive review, builds 41/44/47 have no `expo-updates` and cannot
receive OTA; build 47 was built locally on 2026-11-15 (41 was local too).
The implementation PR is held for the lead, with native
delivery acceptance separate from its automated checks and review status.

Next action: follow [Release and OTA updates](MOBILE_APP.md#release-and-ota-updates)
with Leon: verify existing EAS routing/environment, login, build, submit the exact
build, install and verify #286, then publish/verify the first agreed OTA fix.
That section also contains the rollback commands and combined next-build list.

## Fix round: independent review of `e71feb14`

The lead supplied one P1 and three P2 findings plus notice/runbook corrections.
The P1 was valid: when the updater was inside `AppErrorBoundary`, a caught render
failure prevented its effect from mounting; `ON_ERROR_RECOVERY` did not supply an
ordinary native launch check. Production `RootLayout` now uses `AppRecovery`,
whose updater is a sibling outside the screen boundary, inside the existing
theme/safe-area providers. Native checks are `ON_LOAD` with timeout zero, per
SDK 57 docs, so a broken JS bundle still has a native cold-start download path.
The hook's throttle/guards/no-reload behavior is unchanged.

The notice is an absolute, touch-passthrough overlay positioned from safe-area
insets; it no longer consumes layout height or adds a second top inset. It says
**Update ready** and explains the iOS app-switcher action, with **Later** and no
programmatic reload. Regression scenarios use the real production recovery
composition, a throwing child/visible fallback, rollback fetch, and foreground
recheck; another checks overlay positioning and dismissal beside a live screen.

The runbook now covers the exhausted November cloud quota/Dec 1 reset, local
Ruby 3.3.4 + Homebrew CocoaPods build/IPA submission, reserved build numbers on
failed attempts, pinned `npx eas-cli@16.28.0`, and the actual TestFlight
production-channel test lane. Preview and dev-client prerequisites are explicit
above. All Expo config (including Android/web/version/extra), eas.json, package
scripts, mobile .gitignore and native-module directories are called out as
fingerprint inputs. The publication helper reinstalls dependencies, compares
against the installed build in the production environment, then requires equal
JSON hashes before it can publish; it fails closed because CLI 16.28's mismatch
exit status alone is not a gate. The EAS production API URL and Clerk key must
be verified by the lead before any publication.

Fix-round local verification:

- Full mobile `npm run check`: typecheck and lint pass (74 existing warnings),
  **140 Jest suites / 1,524 tests pass**, including the now **16-test** OTA suite.
- The new default check also includes **9 Node release-guard tests**, using
  injected commands only: exact reinstall/compare/publish ordering, pinned CLI
  and production environment, matching hashes, zero-exit mismatch, missing/empty/
  malformed hashes, invalid JSON, command failures and invalid arguments.
- Public Expo config resolves `ON_LOAD`, timeout zero, the existing URL/project,
  fingerprint policy and Associated Domains. The iOS export passes with two
  Metro workers. The changed-UI advisory scan returns `[]`.
- No API/web implementation, hook logic, channel mapping, update URL, fingerprint
  policy, error-boundary internals, or republish/rollback flags changed. No
  #265/#286 implementation was replayed; only W10's unmet device prerequisite
  was clarified. The package check-script addition itself is a fingerprint input
  and must be present in the first new native build.

Native delivery/device cases above remain pending; no EAS command was run,
including by the helper tests. No review was dismissed. The supplied Opus review
covered `e71feb14`; this fix-round head still needs independent re-review.
