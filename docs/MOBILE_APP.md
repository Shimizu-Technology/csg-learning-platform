# CSG Learn Mobile Architecture

## Product boundary

CSG Learn is the native companion to the learning platform. It handles the common student and staff work that benefits from a phone, against the exact same Rails records and authorization rules as the web app. The parity program and its deliberate web boundaries are defined in [MOBILE_PARITY_IMPLEMENTATION_PLAN.md](MOBILE_PARITY_IMPLEMENTATION_PLAN.md).

Included now:

- Cohort and community channels
- Direct and small-group conversations
- Real-time incoming message updates
- Optimistic message sending with failure recovery
- Unread cursors and mute controls
- Cross-conversation message search
- Anchored search results and paged message history
- Attachments, mentions, reactions, edits, deletion, pins, and threads
- A safe-area-aware image gallery with pinch/double-tap zoom, bounded panning, swipe navigation and dismissal, rotation, loading recovery, and accessible controls
- Draft persistence and durable failed-message retry
- Thread-reply and text-submission draft persistence with explicit unsent/not-submitted states
- Announcements, staff publishing controls, and the complete notification inbox
- Staff workspace, membership, and channel controls
- Global and per-conversation notification preferences
- Native notification registration and deep links
- Encrypted Clerk session persistence
- A cached inbox fallback through local persisted state
- Staff curriculum search and exact read-only student preview
- Native module and lesson management with guarded device drafts
- Lesson details, rich instructions, objectives, rubrics, retrieval checks, hosted video, and browser-runner authoring

Curriculum, routine authoring, lesson progress, resources, submissions, office hours, class recordings, staff attention triage, student health, and quick grading are now native. Large-scale restructuring, bulk operations, repository inspection, and comparison matrices remain deliberate authenticated handoffs to the responsive web app.

## Runtime flow

1. Clerk authenticates the user and stores the session token in SecureStore.
2. `POST /api/v1/sessions` synchronizes the Clerk identity with the Rails user.
3. The app loads the server-authorized workspace list, channels, direct conversations, and announcements from the existing `/api/v1` REST API.
4. The selected workspace is remembered per user. Staff receive all active workspaces; students receive only active cohort enrollments and explicit community memberships. The inbox and DM member picker filter the same server data to that selection.
5. A short-lived, single-use cable token opens the authorized Action Cable stream for the active conversation.
6. Message mutations go through REST; cable events reconcile changes from every participant.
7. The native client registers an Expo device token with Rails. Existing notification jobs fan out independently to both Web Push and Expo Push while respecting the user's global notification preference.
8. Notification taps route directly to the matching channel, DM, announcement, lesson, or staff submission-review surface through a strict native-route allowlist.

## Security and reliability

- Rails remains the only authorization boundary; native route guards are convenience, not security.
- Clerk tokens use encrypted platform storage and are refreshed after unauthorized GET responses.
- Device tokens are unique, user-owned, removable at sign-out, and invalidated after Expo reports `DeviceNotRegistered`.
- API requests have timeouts, a single safe retry for GETs, and user-readable errors.
- The inbox and workspace list cache only the signed-in user's scoped summaries. Signing out clears cached session, workspace selection, inbox, and device-token state.
- Demo content is restricted to `__DEV__` builds and never substitutes for API authorization tests.

## Parity status

- Curriculum, lesson delivery, progress, resources, and submissions are native as of Phase 2.
- The Phase 3 recording library and lesson-video player provide native resume and progress sync for uploaded and direct media, plus in-app YouTube, Vimeo, and Loom playback with a clearly labeled original-link fallback. Uploaded media retains signed-URL renewal, speed control, fullscreen rotation, interruption handling, and PiP.
- Managed offline recording downloads remain deferred until retention, device-storage, privacy, and logout-deletion policy is approved. The player does not cache signed media URLs.
- Today includes the shared **This Week** plan: required and optional lessons, carried-forward work, close times, redos, live classes/office hours, upcoming unlocks, and recording catch-up. Its query is retained by the existing seven-day user-scoped SQLite cache alongside the separately encrypted session and is removed at sign-out.
- Text submissions autosave a version-aware device draft, older drafts require intentional restore after a server-side change, and only server acknowledgment produces success. Channel, DM, and thread drafts restore during network failures; sign-out removes authored drafts and failed-message retry copies. The detailed contract is in `OFFLINE_CONTINUITY.md`.
- Students can ask for contextual help from a lesson, individual exercise, or recording and see open, acknowledged, resolved, and canceled state plus the instructor response. Staff have a native urgent-action support queue with direct requests, explainable learning signals, intervention context, and recovery plans; dense longitudinal comparison remains web-first.
- Phase 4 gives staff a ranked cross-cohort attention queue, student health and progress drill-downs, a focused grading queue, native A/B/C/Redo reviews, concise feedback, and direct submission push routes.
- Staff can browse active and upcoming cohort recordings and resources without pretending to be enrolled in those cohorts.
- Staff curriculum search, preview, module/lesson management, and routine lesson authoring are native. Large-scale curriculum restructuring, bulk enrollment/team operations, dense grading/watch-progress matrices, and repository inspection retain labeled one-time authenticated web handoffs because they are desktop-shaped workflows.
- App Store Connect product copy and the complete 6.9-inch iPhone / 13-inch iPad screenshot sets describe the parity release. Recording-library build `1.0.0 (22)` is available to internal TestFlight testers. Public review waits for physical-device acceptance.

The Rails API remains the single product backend, so every native phase is additive rather than a fork of web behavior.

## Phase 0 readability gate

The native interaction and readability work is implemented:

- long fenced-code lines create a real horizontal scroll range and provide exact Copy plus overflow-only page controls;
- semantic `display`, `title`, `section`, `body`, `support`, `label`, `meta`, and `code` roles define the native type ramp;
- meaningful text starts at 11 pt or larger and continues to use React Native's Dynamic Type scaling;
- primary display text is capped conservatively while content and utility text can reach at least 200%, keeping common navigation and actions usable at accessibility sizes;
- readable low-emphasis copy uses `subtle` (`#858EA2`), which stays above 4.5:1 on `ink`, `panel`, and `panelRaised`; `quiet` remains available only for decorative icons and placeholders;
- Today changes multi-column metrics and quick actions to a single column at large text, while message headers, workspace controls, search, badges, rows, and decorative initials avoid clipping.

Automated tests guard the type floor and contrast ratios. Local iOS acceptance covers the largest accessibility text category with Increase Contrast enabled, plus code-block navigation and independently reachable nested actions. A physical-device VoiceOver smoke test remains part of the final TestFlight release checklist.

The original diagnosis and acceptance criteria remain in `PRODUCT_STRATEGY_AND_LEARNING_EXPERIENCE_PLAN.md`.

## Reviewed voice-to-text composer

The native channel and direct-message composers now support reviewed voice-to-text drafts:

- tap a microphone, speak naturally for up to five minutes, stop, and transcribe;
- apply only meaning-preserving punctuation, paragraphs, and clearly spoken lists;
- insert the result into the editable composer and require an explicit **Send**;
- keep typed text safe through cancellation, permission denial, interruptions, and errors;
- retain no raw audio after processing and capture no transcript/message content in analytics;
- ship direct messages and channels first, then reuse the shared flow in threads, contextual help, and concise grading feedback.

The implementation uses one app-lifetime `expo-audio` recorder for foreground-only, cache-backed M4A recording and an authenticated Rails endpoint for server-side transcription and conservative cleanup. Recorder shutdown is serialized across navigation/background/cancel paths, failed audio is retained only for an explicit in-session retry, and native crash capture records content-free diagnostic state. It requires a new native binary. Internal TestFlight activation and public release gates are tracked separately in `VOICE_TO_TEXT_PLAN.md`.

## Release and OTA updates

N-3 prepares EAS Update for Expo SDK **57** (`expo ~57.0.33`, SDK-matched
`expo-updates ~57.0.28`). The existing project is
`c6326478-e200-4aba-8614-806ca5f8e03a`, owned by `shimizutechnology`.
`updates.url` points to that project's `https://u.expo.dev/` endpoint.
Production binaries use channel `production`; internal preview binaries use
`preview`. The corresponding EAS environments are explicit in `eas.json`.
This PR does not create projects/channels, publish an update, or ship a binary.

### Compatibility and safe activation

SDK 57 supports `runtimeVersion: { policy: "fingerprint" }`. Expo derives a hash
from native dependencies/configuration for both builds and updates. EAS only
serves an update to the same platform and runtime on the binary's channel. This
is safer than `appVersion` here: the app is still `1.0.0` across multiple native
builds, and relying on a manual version bump could send incompatible JavaScript.
Never override the hash or remove native inputs to make an update match. Compare
the update runtime with the intended installed build before releasing it.

| Change | Delivery |
| --- | --- |
| JavaScript/TypeScript fixes, copy, layout, ordinary bundled content/assets using existing native capabilities | OTA, after verifying the same fingerprint runtime |
| Native module/dependency or Expo SDK changes; native code; config plugins or their options | New native build |
| Entitlements/capabilities, including #286's Associated Domains; URL schemes; permissions; app icon or splash configuration | New native build |
| Update URL/channel embedded in a binary, runtime policy, bundle identity, signing/provisioning | New native build |

The first OTA-capable binary **must be a new native build** containing both
`expo-updates` and #286's Associated Domains. Builds **41 and 44** cannot acquire
native modules or entitlements via OTA. Their actual archived update settings
and runtime versions have not been inspected. A binary without EAS Update is
unaffected; one with a different runtime cannot receive this runtime's updates,
even on the same channel. Verify their archive metadata instead of assuming
that the marketing version `1.0.0` proves compatibility.

The app checks after launch and when returning to the foreground, at most once
per **30 minutes per app process**, including failed attempts. Concurrent checks
are suppressed. Checks/downloads do not block startup; failures only log
`[OTA] Update check/download failed`. Development, Expo Go, disabled updates, and
web skip the flow. Native automatic checking is `ON_ERROR_RECOVERY`, preserving
Expo's fatal-error recovery path while ordinary checks use the JS throttle;
`fallbackToCacheTimeout: 0` avoids waiting for a network update at startup.

Downloads, including rollback-to-embedded directives, are staged for the next
**cold start**. A nonmodal **Update ready — restart** notice offers **Later** and
asks the learner to finish their message/submission before closing and reopening
the app. Backgrounding alone is not a cold start. There is deliberately no
programmatic reload or restart button: drafts, voice recording, uploads, and
pending submissions stay mounted. Existing user-scoped composer/submission
draft persistence remains in place; an in-flight request must finish or visibly
fail before the operator closes the app. OTA fixes must retain draft/cache
format compatibility with the embedded bundle so rollback remains safe.

### Pre-flight checklist

- [ ] Start from the reviewed release commit in `mobile/`, with a clean tree and
  Node `22.22.3` (`mobile/.nvmrc`). Record source SHA and intended channel.
- [ ] Run `npm ci`, `npm run check`, `npm run audit:dependencies`,
  `npx expo install --check`, `npx expo config --type public`, and
  `npx expo export --platform ios`. Confirm `extra.eas.projectId` is the existing
  UUID and `updates.url` ends in that exact UUID. Stop if either is unset or differs.
- [ ] Confirm fingerprint policy, `production`/`preview` profile channel mapping,
  and the native-build-versus-OTA decision above. Never publish a native change
  as a fix to an older binary.
- [ ] Lead and Leon verify the EAS project owner, existing channel/branch routing,
  available EAS Update service, and matching production environment values
  (`EXPO_PUBLIC_API_URL`, Clerk publishable key, and other public build inputs).
  Build and update must use the same environment. Do not put secrets in public
  environment variables. Resolve missing server-side setup before release.
- [ ] For OTA, record the installed build's platform/runtime/channel and the
  known-good update group (or embedded bundle). Test the change on a compatible
  preview binary first; preview uses `--environment preview --channel preview`.
- [ ] Complete the combined next-build/device checklist below before declaring
  native delivery, universal links, or OTA transport accepted.

### Lead and Leon: first build, then OTA

Leon signs in on the MacBook when the native build is ready. These are operator
commands, **not commands run by the implementation worker**. Use EAS CLI with
SDK 57 support (`npx eas-cli@latest` can replace `eas` if it is not installed).
From the reviewed checkout:

```sh
cd mobile
eas login
eas whoami
# Verify the existing project and production channel/branch in EAS first.
eas build --profile production --platform ios
# After success, use the exact build ID from the preceding command:
eas submit --profile production --platform ios --id <NEW_BUILD_ID>
```

Record build ID, source SHA, incremented build number, fingerprint runtime and
channel from EAS/the archive. Wait for Apple processing and confirm the exact
build is available to the intended TestFlight testers. Existing submission config
targets App Store Connect app `6792992154`, bundle
`com.codeschoolofguam.connect`, Apple team `4T358A5S74`. No store/TestFlight
setting changes are included in N-3.

After installing and accepting that build, prepare a reviewed **JS-only** fix
with an observable result and a matching runtime. Run pre-flight again, then:

```sh
eas update --channel production --environment production --platform ios --message "<fix description and source SHA>"
```

Keep the update group ID/runtime and verify delivery on that installed build.
Do not publish only to prove the command works. This command targets production
users with the matching runtime; agree on the first test fix with Leon.

### Rollback safety

Use the existing project's update history to identify the affected **iOS runtime**,
production channel's branch, bad group, and last known-good group. To restore an
existing compatible update without rebuilding/re-exporting old source:

```sh
eas update:republish --group <KNOWN_GOOD_GROUP_ID> --destination-channel production --platform ios --message "Rollback <BAD_GROUP_ID>"
# Alternatively, use the interactive guide for a previous or embedded update:
eas update:rollback
```

In the guide, select this project, the production branch, iOS, and the affected
runtime; choose its known-good update or its **embedded** update. If there is no
previous OTA group (the first update is bad), choose embedded. Review the target
before confirming. Rollback is scoped to runtime: repeat for any other affected
runtime, and never republish an older binary's incompatible group as a substitute.
Clients must reach EAS to fetch the rollback; a healthy running app stages it for
the next cold start. Offline clients keep their installed/cached code. Expo's
native error recovery is a fallback, not proof that every crash can recover.
Confirm the rolled-back result and retained drafts on device before publishing
again. A native defect or broken embedded bundle needs a corrected native build.

### Combined next-build checklist: #286 + N-3

Owner: lead + Leon on an iPhone, using student, instructor and admin fixtures,
two enrolled cohorts, a lesson/block, submission, recording and booking. These
checks are **pending** until a signed release build and EAS access are available.
Keep build/source/runtime/channel/update IDs and results with the release record.

- [ ] Confirm the signed archive entitlements contain
  `com.apple.developer.associated-domains = ["applinks:learn.codeschoolofguam.com"]`.
  Inspect with `codesign -d --entitlements :- <APP_PATH>`; decode the embedded
  profile with `security cms -D -i <APP_PATH>/embedded.mobileprovision`. Confirm
  its Associated Domains allowance, application identifier
  `4T358A5S74.com.codeschoolofguam.connect`, team and validity. A stale profile
  must be refreshed by the lead/Leon before building/signing again.
- [ ] Inspect the archive's Expo updates configuration: project URL, fingerprint
  runtime, `production` channel request header and embedded bundle are present.
- [ ] Verify the production HTTPS AASA response before device testing, including
  JSON Content-Type, no redirect, and the correct Apple app identifier. Check
  Apple's association/cache behavior on device; source config alone is insufficient.
- [ ] Execute **all eight** checks under [Leon's iPhone check after the next native
  build](W10_MOBILE_DEEP_LINKS_QA.md#leons-iphone-check-after-the-next-native-build)
  and **all five additional required iPhone checks** under its Fix round 1.
  This includes cold/warm HTTPS and both URL schemes; signed-out and policy gates;
  cross-account clearing; role-safe fallbacks and staff/admin boundaries;
  meeting/enrollment pushes and preferences; authenticated web return/refetch and
  poor-network recovery; VoiceOver/large text/safe areas; public URLs staying in
  Safari; actor-excluded meeting notices; and production/dev-client OAuth callbacks.
- [ ] Install the exact new TestFlight build. Confirm normal launch/sign-in,
  persisted composer and text-submission drafts, and successful submission receipt.
- [ ] Publish the agreed first JS-only production update with the matching runtime.
  Launch online and return from background: observe one download/ready notice,
  no forced reload, no repeated checks within 30 minutes, and **Later** dismissal.
  Repeat while typing a composer draft and during a slow submission/upload;
  finish or recover the operation and verify saved server/device outcomes.
- [ ] Close and reopen only after work settles. Confirm the observable OTA fix
  runs without another TestFlight install, with matching runtime/channel/update ID;
  composer and submission drafts restore. Repeat offline launch, failed check,
  and foreground recovery after the throttle; no error alert should appear.
- [ ] In preview, rehearse known-good republish and embedded rollback on compatible
  builds, including retained drafts. Verify a different runtime receives no update.
  Inspect builds 41/44 before making any claim about their native/update behavior.

References checked for this implementation:
[SDK 57 expo-updates](https://docs.expo.dev/versions/v57.0.0/sdk/updates/),
[runtime versions](https://docs.expo.dev/eas-update/runtime-versions/),
[EAS Update setup](https://docs.expo.dev/eas-update/getting-started/),
[rollbacks](https://docs.expo.dev/eas-update/rollbacks/) and
[EAS CLI](https://docs.expo.dev/eas/cli/).
