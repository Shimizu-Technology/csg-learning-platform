# CSG Connect App Store Release Record

Last updated: 2026-10-03 (Pacific/Guam)

This directory is the durable source record for the App Store presentation of the completed mobile-parity program. It records what was uploaded, how the images were produced, and what remains before public App Review.

## Current iOS release state

| Item | State |
| --- | --- |
| Marketing version | `1.0.0` |
| Latest uploaded iOS build | `1.0.0 (32)`; Apple processing and tester availability are not yet verified |
| Latest verified EAS build ID | `114406be-ce54-48f3-984f-f17e08ab0e64` |
| Latest uploaded source commit | `6860be47b5d4d4416551205464440b866020aa57` (`main`, merged PRs #164–#165) |
| Latest release delivery | EAS submission `b952fa6e-6dc7-4c4f-b9ca-74bcdb211d58` finished successfully and uploaded build 32 to App Store Connect |
| Latest verified App Store Connect state | Leon separately confirmed build 29 in TestFlight; build 32 is processing after a successful upload |
| Next release candidate | Build 32, pending Apple processing and physical-device acceptance |
| Release artifact fingerprint | Build 32 IPA SHA-256 `a0c559e4654b6d694d1b492462ed353abbd33124ac473bd5e982bf8eece465d4` |
| Phase 0–1 release candidate | `1.0.0 (9)` |
| App Store version | `1.0`, Prepare for Submission |
| Internal group | `CSG Internal` |
| Tester access | Active invited internal tester; identity retained in App Store Connect only |
| Public App Review | Intentionally not submitted pending physical TestFlight acceptance |

Build 4 finished successfully, was processed by App Store Connect, is attached to the 1.0 App Store draft, and is available to the internal group. EAS production archives 5–8 and their submissions also finished successfully. Build 9 was generated from merged `main` on 2026-08-02 and submitted without an EAS error with `CSG Internal` requested as its internal group. At 11:59 AM Pacific/Guam, Apple sent the invited tester the TestFlight availability notice for `CSG Connect 1.0.0 (9)`, confirming processing and tester availability.

Build 10 was archived from merged `main` at source commit `690a84d`. EAS uploaded the binary and Fastlane reported that Apple finished processing `1.0.0 (10)`. Fastlane then attempted to add `CSG Internal` manually and Apple rejected that operation because the build could not be added to that internal group, causing EAS to label the overall submission `ERRORED`. This did not invalidate the uploaded build or tester distribution: at 3:52 PM Pacific/Guam on 2026-08-02, Apple emailed the invited tester that `CSG Connect 1.0.0 (10)` was available to test. Treat that Apple notice as the authoritative release outcome and the EAS error as a post-upload group-assignment automation quirk.

Build 11 is the post-TestFlight stabilization candidate from merged PR #91. It serializes native recorder shutdown across navigation/background/cancel paths, shares one app-lifetime recorder, preserves failed audio for an explicit retry, extends reviewed drafts to a five-minute safety limit, improves the recording/transcription UI, and adds privacy-safe JavaScript/native crash reporting. The production API now uses a dedicated CSG provider project and server-only service-account key for the internal acceptance run. The EAS submit profile no longer requests a manual TestFlight group assignment; submission `25e0ae4d-028f-4965-9b80-a075fb9e9739` uploaded build 11 successfully without build 10's post-upload automation error.

Build 12 is the corrective candidate from merged PR #93 after build 11 physical testing exposed two independent failures. The production request reached Rails but the provider rejected a revoked credential; Render now uses a verified dedicated service-account key, and production model, multipart transcription, and structured-cleanup checks all pass. The mobile recovery panel now keeps error copy separate from actions, places retry on its own full-width row, and gives record-again/dismiss controls a separate flexible row. Provider failures emit only sanitized status/type/code diagnostics. Submission `e49f93e6-08c1-4aa5-a8d6-eb13d3f487cd` uploaded build 12 successfully, and Apple processing is pending.

Build 13 is the connected-experience candidate from merged PRs #97–#101. It adds cohort-scoped student workspaces, reciprocal submission/help/message navigation, cohort workspaces and discovery, durable interventions and recovery plans, and focused native GitHub-check evidence. EAS archived the exact merged `main` commit `388ef91` with production demo mode disabled. The first signing preflight stopped before upload because the prior distribution certificate and provisioning profile had expired; both were replaced through the existing Apple account, with the new certificate/profile expiring on 2027-08-16. Remote versioning was restored to 12 after that no-build attempt so the successful archive retained the intended build number 13. Submission `dd49f5ae-1851-4ed2-ac27-7933e1dfff82` uploaded the binary successfully; App Store Connect reports it `VALID` and `IN_BETA_TESTING`.

Build 20 is the latest verified internal candidate before the curriculum-authoring release. EAS submission status confirms that build `09092544-ff98-4b03-92c5-5e389bfca7c6`, sourced from merged-main commit `c7f4d425991bad180fc753d1db4cebfbabee7fa7`, was uploaded through submission `933037b9-7432-4aba-9d16-aad2d1b4fc06` and is `IN_BETA_TESTING` for internal testers.

Build 21 is the curriculum-authoring candidate from merged PRs #124–#131 and release-preflight PR #132. It adds fail-closed preview protection, the native staff curriculum library, guarded lesson drafts and exact student preview, module and lesson structure management, objectives/rubrics/retrieval checks, hosted lesson-video replacement, browser-runner configuration, and rich lesson-instruction authoring. The archive was built and signed locally from exact merged-main commit `f5f28d94a81b549c7c4c3facc3766afabfcd4c27` because the monthly EAS cloud-build allowance was exhausted; no cloud EAS build ID exists. The package identifies itself as `com.codeschoolofguam.connect` version `1.0.0 (21)`, uses a production App Store profile valid through 2027-08-15, and passed code-signature verification. EAS submission `4289d148-914b-4f5c-b587-779f72266422` finished successfully, and App Store Connect reports internal `IN_BETA_TESTING` with external beta ready for submission. Focused tester instructions are in [`WHAT_TO_TEST_1.0.0_21.md`](WHAT_TO_TEST_1.0.0_21.md); EAS's automated changelog field was unavailable on the current plan, but that did not affect the binary upload or internal TestFlight availability.

Build 22 is the recording-library candidate from merged PRs #134–#135 and release-preflight PR #136. It adds secure in-app playback for supported YouTube, Vimeo, Loom, and direct-video links; promotes existing hosted links into the same first-class library as uploaded recordings; and gives staff native add, draft, publish, edit, delete, help-context, and cross-platform progress workflows. The archive was built and signed locally from exact merged-main commit `11b825c8b50b4a3b56f70a43c8ffebaef0e29911` because the monthly EAS cloud-build allowance was exhausted; no cloud EAS build ID exists. The package identifies itself as `com.codeschoolofguam.connect` version `1.0.0 (22)`, uses App Store provisioning profile `c8de0f63-fa95-410b-8f3e-cfa655ae605f` for team `4T358A5S74` through 2027-08-16, and passed code-signature verification. EAS submission `ab62f5fc-5a90-44b8-884a-7d3d9e6425fe` finished successfully, and App Store Connect reports internal `IN_BETA_TESTING` with external beta ready for submission. Focused tester instructions are in [`WHAT_TO_TEST_1.0.0_22.md`](WHAT_TO_TEST_1.0.0_22.md).

Build 23 is the messaging-smoothness candidate from merged PR #141. It reduces waits when opening and switching web conversations, adds older-message pagination across Rails, web, and iOS, shows native messages before attachment upload completes, and supports independent consecutive sends with progress and retry. The app source is merged-main commit `942a1286f694e4b2ff7a13471640c4004605fc50`. EAS remote versioning was already at 23 after the cloud-build allowance rejected an earlier attempt, so the local archive used a temporary `autoIncrement: false` build-profile override; the repository profile was restored immediately afterward. The signed IPA identifies itself as `com.codeschoolofguam.connect` version `1.0.0 (23)`, uses App Store provisioning profile `c8de0f63-fa95-410b-8f3e-cfa655ae605f` for team `4T358A5S74` through 2027-08-15 UTC, and passed code-signature verification. Its SHA-256 is `9aabf9378e73c207cf6ea2f2ca00cecb5102ad216382d2be3d3e4951679eaf05`. The EAS submission remained queued and was canceled before upload; Apple's direct validator and transporter accepted the same IPA as delivery `a5e16a46-2b3c-4c41-972d-73aae8b08b82`. App Store Connect now reports `VALID` and internal `IN_BETA_TESTING`. Its English “What to Test” note is saved in App Store Connect, and the full tester script is in [`WHAT_TO_TEST_1.0.0_23.md`](WHAT_TO_TEST_1.0.0_23.md).

Build 25 is the premium-messaging candidate from merged PR #149. It adds recent-activity inbox ordering, native message actions and reactions, consolidated read receipts, an unread divider, bounded read positions, and notification navigation across mobile and web. The locally signed production IPA was built from exact merged-main commit `749f056809fc5423448dfffeb6abc32c80bb970c`, identifies itself as `com.codeschoolofguam.connect` version `1.0.0 (25)`, and passed package, App Store profile, team, production push-entitlement, and code-signature inspection. Its SHA-256 is `d04c9b9378499c09194e0e83d0e98d4e551d797ed3583de7efd20046dbce344e`. EAS submission `a6e5fbc5-be31-4bca-930c-05232c37f12a` reported a successful upload. Apple processing, internal group distribution, and physical iPhone acceptance still need confirmation. Build 24 was consumed by a failed local preflight before an IPA was produced. The focused tester script is in [`WHAT_TO_TEST_1.0.0_25.md`](WHAT_TO_TEST_1.0.0_25.md).

Build 26 is the alumni-access and messaging-layout candidate from merged PR #151 at exact source commit `440e93fcae3674afbb8fa73af962c014fd7cf769`. It separates app sign-in from GitHub organization membership and pending invitations on staff web and native rosters, fixes the native message-recipient picker and keyboard behavior, and moves the desktop home progress badge clear of the illustration. The first local signing preflight advanced EAS remote versioning from 25 to 26, then stopped before compilation because Fastlane was missing from that process's PATH. The successful local archive used a temporary `autoIncrement: false` profile override; the repository profile was restored. The IPA identifies itself as `com.codeschoolofguam.connect` version `1.0.0 (26)`, uses App Store profile `c8de0f63-fa95-410b-8f3e-cfa655ae605f` for team `4T358A5S74` through 2027-08-15 UTC, has the production push entitlement, and passed code-signature verification. Its SHA-256 is `6c33c8a6c9d428085aea62fadde08b00e14b8c9de450bc75d178225d5c8ac6ff`. EAS submission `e2c2eadb-9abf-46b3-be1c-ff2837e28498` reported a successful Apple upload; Apple processing and internal tester availability still need confirmation. Focused tester steps are in [`WHAT_TO_TEST_1.0.0_26.md`](WHAT_TO_TEST_1.0.0_26.md).

Build 27 is the activity-history candidate from merged PR #154 at exact source commit `80ae782238ffc770d7153111341082145ad30387`. It adds account sign-in and learning-work history for students, instructors, and administrators on web and native, with player-reported video events labeled as such. EAS locally archived the unchanged merged source, incremented the remote iOS build number from 26 to 27, and signed `com.codeschoolofguam.connect` version `1.0.0 (27)` with App Store profile `c8de0f63-fa95-410b-8f3e-cfa655ae605f` for team `4T358A5S74` through 2027-08-16 Guam time. The production push entitlement and code signature passed inspection. IPA SHA-256 is `9441bbf204a82a7f7dc8eae00a378d93d4321e160482de66af26055f6a52a1d9`. Expo Doctor reported 20/21 checks due to existing package metadata warnings for `react-native-render-html` and `@solana-mobile/mobile-wallet-adapter-protocol`; the signed build succeeded. An initial EAS submit scheduling attempt rejected the optional `what-to-test` parameter because this plan does not include changelog submission. Retrying the same IPA without that parameter succeeded: submission `fa5fe41e-79b1-4b84-8bba-1226835845df` uploaded to App Store Connect. Apple processing and internal tester availability are unverified because the available App Store Connect browser session requires a fresh Apple sign-in. Focused tester steps are in [`WHAT_TO_TEST_1.0.0_27.md`](WHAT_TO_TEST_1.0.0_27.md).

Build 29 is the cohort-workspace candidate from merged PR #156 at exact source commit `87cc7f536ccec0f631b49fcdc9645e079e779680`. It adds a native cohort switcher and student/staff cohort home, cohort-scoped grading, support, messages, and learning, plus native class-session scheduling. The first local preflight reserved build 28 but stopped before compilation because Fastlane was unavailable in that shell's Ruby version. The retry used the installed Fastlane and archived the unchanged merged source as `com.codeschoolofguam.connect` version `1.0.0 (29)`. The App Store signature and production push entitlement passed inspection. IPA SHA-256 is `804725d31449267f16fb3d0bb4a9057432b3b0dcf25e2306aa7000993c3ba513`. EAS submission `4c1817bc-9348-4a40-918c-e7bab513b18c` uploaded successfully to App Store Connect. Leon confirmed build 29 is available in TestFlight; App Store Connect's processing state has not been independently checked in this session. Focused tester steps are in [`WHAT_TO_TEST_1.0.0_29.md`](WHAT_TO_TEST_1.0.0_29.md).

Build 30 follows Leon's confirmation that build 29 is available in TestFlight. Merged PR #158 sets the CSG Alumni cohort's GitHub organization to `Code-School-of-Guam-Alumni` and removes the literal “(tabs)” label from native stack back buttons. The production Render deployment is live at source commit `6048693658c29092a7ecdabab21dc90cc628e9a4`; a production read verified cohort 4's organization value and a successful GitHub access-service check. The locally signed IPA was archived from that exact commit as `com.codeschoolofguam.connect` version `1.0.0 (30)`. App Store signing, team `4T358A5S74`, production push entitlement, and code signature passed inspection. The IPA is 31,991,734 bytes with SHA-256 `9ad40f270ed6c6e38b6c6b16123778beb9436a21cd861dfd8d3bd5c6ce1eab39`. EAS submission `d6781187-7333-4fcf-9cfb-9319b19c9166` finished without error. Apple processing and internal TestFlight availability are not yet confirmed. Focused tester steps are in [`WHAT_TO_TEST_1.0.0_30.md`](WHAT_TO_TEST_1.0.0_30.md).

Build 31 is the post-course-readiness dependency candidate from exact merged-main commit `236f0d22e8e695fd0fc7c50063d5a0fca70f1804`. PR #161 aligns Expo packages with the installed SDK 57 baseline, PR #162 resolves the applicable `brace-expansion` lockfile advisories, and PR #160 adds guided-course access and support dates to the Rails and web experience. PR #160 does not add a new native administration screen, so its access-date controls must be accepted on the web app. The mobile gate passed 71 suites / 402 tests, strict TypeScript, Expo lint, dependency policy, and Expo dependency compatibility. Expo Doctor passed 20 of 21 checks with the already documented React Native Directory metadata warning for `react-native-render-html` and the Solana mobile wallet adapter. The locally signed IPA identifies itself as `com.codeschoolofguam.connect` version `1.0.0 (31)`, uses team `4T358A5S74`, has the production push entitlement with `get-task-allow=false`, and passed strict deep code-signature verification. The IPA is 31,994,918 bytes with SHA-256 `3b1507e71b41513b0050b1b2a95885eb2f63d6f89008b7f147aa2b8d29d69989`. EAS submission `5151cded-c8e0-4f8c-8772-f00266caa5aa` uploaded the binary successfully to App Store Connect. Apple processing and internal tester availability are not yet confirmed. Focused tester steps are in [`WHAT_TO_TEST_1.0.0_31.md`](WHAT_TO_TEST_1.0.0_31.md).

Build 32 is the global-cohort-scope candidate from exact merged-main commit `6860be47b5d4d4416551205464440b866020aa57`. PR #164 makes the selected cohort the shared scope across native navigation and messaging, keeps community message workspaces as explicit temporary overrides, and applies the same global model on the web. PR #165 fixes the collapsed desktop web switcher and does not add native code. The mobile gate passed strict TypeScript, Expo lint, 72 suites / 411 tests, dependency policy, and Expo dependency compatibility. Expo Doctor passed 20 of 21 checks with the existing React Native Directory metadata warnings for `react-native-render-html` and `@solana-mobile/mobile-wallet-adapter-protocol`. EAS production environment verification confirmed the live API URL and `EXPO_PUBLIC_DEMO_MODE=false`. EAS cloud build `114406be-ce54-48f3-984f-f17e08ab0e64` produced `com.codeschoolofguam.connect` version `1.0.0 (32)` with production signing. The 31,992,617-byte IPA passed strict deep code-signature verification, carries the production push entitlement, and has SHA-256 `a0c559e4654b6d694d1b492462ed353abbd33124ac473bd5e982bf8eece465d4`. EAS submission `b952fa6e-6dc7-4c4f-b9ca-74bcdb211d58` finished successfully and uploaded the binary to App Store Connect. Apple processing and internal tester availability are not yet confirmed because the App Store Connect session requires a fresh sign-in and no Apple processing notice has arrived in the checked Code School or Shimizu Technology mailbox. Focused tester steps are in [`WHAT_TO_TEST_1.0.0_32.md`](WHAT_TO_TEST_1.0.0_32.md).

Verified iOS production history:

| Build | EAS build ID | Submission or delivery ID | Submission and Apple state |
| --- | --- | --- | --- |
| `5` | `9424b028-d108-43b4-a3e1-4f683819cac5` | `1b501c6e-7ad2-42c3-853e-1cbb7f377f94` | Finished |
| `6` | `db32728f-d7b0-4a0d-ae6f-4083f5f96d62` | `b57fad17-4ea8-4305-9097-aca29f32636c` | Finished |
| `7` | `9f4c2108-f9b9-47ac-8b11-5999aa786245` | `890d5a09-a462-4d5a-9759-2dae22c92454` | Finished |
| `8` | `deb0452d-949a-46b2-bc4e-fccd7cc6924b` | `4cf6cbe7-74c5-437b-b01e-7d137d5dfa1f` | Finished |
| `9` | `098bdef7-9320-41ef-92b7-255cd6f61912` | `2aaf6efa-1b6d-4c74-8b48-da29401f8d58` | Finished |
| `10` | `2f310674-05f7-4eca-b97d-ff7590e58eeb` | `69a8a286-8c5a-4ba1-9f0a-45fcc30788e1` | Errored after successful upload and processing while assigning the internal group; Apple confirmed tester availability |
| `11` | `b4365b22-a4b9-4dbf-a74e-c16ded4f0f7e` | `25e0ae4d-028f-4965-9b80-a075fb9e9739` | Finished; uploaded successfully and awaiting Apple processing confirmation |
| `12` | `ab7ff733-b074-48dd-a6bc-af1df24d2565` | `e49f93e6-08c1-4aa5-a8d6-eb13d3f487cd` | Finished; uploaded successfully and awaiting Apple processing confirmation |
| `13` | `03fd9ec4-22a6-4933-80e8-ed0e440d8f2a` | `dd49f5ae-1851-4ed2-ac27-7933e1dfff82` | Finished; `VALID` and `IN_BETA_TESTING` in App Store Connect |
| `20` | `09092544-ff98-4b03-92c5-5e389bfca7c6` | `933037b9-7432-4aba-9d16-aad2d1b4fc06` | Finished; internal `IN_BETA_TESTING`, external beta ready for submission |
| `21` | Local signed archive; no cloud EAS build ID | `4289d148-914b-4f5c-b587-779f72266422` | Finished; internal `IN_BETA_TESTING`, external beta ready for submission |
| `22` | Local signed archive; no cloud EAS build ID | `ab62f5fc-5a90-44b8-884a-7d3d9e6425fe` | Finished; internal `IN_BETA_TESTING`, external beta ready for submission |
| `23` | Local signed archive; no cloud EAS build ID | Apple delivery `a5e16a46-2b3c-4c41-972d-73aae8b08b82` | Direct upload succeeded; `VALID` and internal `IN_BETA_TESTING`. EAS job `8cd1a88c-7598-4377-920d-588215d77fc9` was canceled while queued. |
| `25` | Local signed archive; no cloud EAS build ID | `a6e5fbc5-be31-4bca-930c-05232c37f12a` | EAS reported successful upload; Apple processing and internal availability unverified. |
| `26` | Local signed archive; no cloud EAS build ID | `e2c2eadb-9abf-46b3-be1c-ff2837e28498` | EAS reported successful upload; Apple processing and internal availability unverified. |
| `27` | Local signed archive; no cloud EAS build ID | `fa5fe41e-79b1-4b84-8bba-1226835845df` | EAS reported successful upload; Apple processing and internal availability unverified. |
| `29` | Local signed archive; no cloud EAS build ID | `4c1817bc-9348-4a40-918c-e7bab513b18c` | EAS reported successful upload; Leon confirmed TestFlight availability. |
| `30` | Local signed archive; no cloud EAS build ID | `d6781187-7333-4fcf-9cfb-9319b19c9166` | EAS finished without error; Apple processing and internal availability unverified. |
| `31` | Local signed archive; no cloud EAS build ID | `5151cded-c8e0-4f8c-8772-f00266caa5aa` | EAS reported a successful App Store Connect upload; Apple processing and internal availability are pending. |
| `32` | `114406be-ce54-48f3-984f-f17e08ab0e64` | `b952fa6e-6dc7-4c4f-b9ca-74bcdb211d58` | EAS build and submission finished successfully; Apple processing and internal availability are pending. |

These are EAS or Apple delivery states plus App Store Connect status checks. Leon confirmed build 29 is available in TestFlight. Public App Review remains separate.

Build 9 is the Phase 0–1 TestFlight candidate. It includes the reviewed voice-draft client, Phase 0 readability work, weekly plan, contextual help, privacy-safe analytics, and offline continuity. Its production EAS environment points to the CSG API with demo mode disabled and includes the `csg-learning-platform` PostHog project configuration. Do not enable the voice production endpoint or submit this binary for public App Review until the temporary transcription-provider processing is accurately disclosed, the production OpenAI data controls are approved, and the voice-specific physical-device checks below pass.

Build 10 is the delivered Phase 2 internal candidate. Production auto-increment uses EAS remote versioning; the source `app.json` build number is therefore not the release authority. Build 10 adds direct touch-drag navigation for long code, student-facing objectives/success criteria, reusable rubrics and criterion feedback, editable shared feedback snippets, objective-linked retrieval checks, and reviewed voice-draft reuse in threads/help/grading.

The requested release action is upload to App Store Connect for internal TestFlight testing only. Public App Review remains a separate, intentionally deferred action.

## Store presentation

The App Store draft contains refreshed copy covering the complete native product rather than the original messaging-only scope:

- role-aware Today and staff attention queues;
- channels, direct messages, announcements, notifications, and rich conversation actions;
- native curriculum, lessons, resources, submissions, feedback, and progress;
- secure class-recording playback and resume state;
- staff student-health, grading, and quick-intervention workflows;
- explicit authenticated web handoffs for desktop-shaped administration.

The draft has six screenshots in each required Apple family:

| Position | Story | iPhone 6.9-inch | iPad 13-inch |
| --- | --- | --- | --- |
| 1 | Staff Today / attention queue | `screenshots/iphone-6.9/01-staff-today.png` | `screenshots/ipad-13/01-staff-today.png` |
| 2 | Messaging inbox | `screenshots/iphone-6.9/02-messages.png` | `screenshots/ipad-13/02-messages.png` |
| 3 | Native conversation | `screenshots/iphone-6.9/03-conversation.png` | `screenshots/ipad-13/03-conversation.png` |
| 4 | Learning operations | `screenshots/iphone-6.9/04-learning-operations.png` | `screenshots/ipad-13/04-learning-operations.png` |
| 5 | Class recordings | `screenshots/iphone-6.9/05-recordings.png` | `screenshots/ipad-13/05-recordings.png` |
| 6 | Student support | `screenshots/iphone-6.9/06-student-support.png` | `screenshots/ipad-13/06-student-support.png` |

The exact raster sizes are 1320×2868 for iPhone and 2064×2752 for iPad. Images were captured from clean iOS 18.5 simulators using deterministic development-only sample data. No production account, token, message, submission, recording URL, or private student information appears in the assets. Demo data remains guarded by `__DEV__` and cannot replace Rails authorization in a release build.

## Reproduction and validation

Use the Expo development client with the simulator-safe demo flag only while producing store presentation images:

```sh
cd mobile
EXPO_PUBLIC_DEMO_MODE=true npx expo start --dev-client --clear
```

Capture screenshots from clean 6.9-inch iPhone and 13-inch iPad simulators, then verify every file before upload:

```sh
find docs/app-store/screenshots -name '*.png' -print0 | xargs -0 sips -g pixelWidth -g pixelHeight
```

The release build itself must use `EXPO_PUBLIC_DEMO_MODE=false` and the production API URL. A local production-backend check on 2026-07-22 confirmed that a signed-out installation presents the restricted-access sign-in surface and does not expose demo or cached account data.

Baseline regression evidence recorded on 2026-07-22 remains below:

- Rails: 291 tests / 877 assertions; RuboCop 212 files; Brakeman zero warnings; bundler-audit clean.
- Web: 5 suites / 21 tests, ESLint clean, production build successful, and no high-severity npm audit finding.
- Mobile: strict TypeScript and Expo lint clean; 16 suites / 52 tests; Expo dependency check clean; Expo Doctor 20/20; iOS and Android Hermes exports successful.
- Store assets: all 12 PNG files match their required 1320×2868 or 2064×2752 dimensions.
- The mobile npm audit reports only known moderate transitive advisories in Expo/Clerk build tooling; no direct production dependency upgrade currently resolves them without a breaking toolchain change.

Phase 0–1 candidate preflight recorded on 2026-08-02:

- Expo Doctor initially identified `expo-asset` as a missing direct peer required by `expo-audio`; the SDK 57-compatible module and config plugin were added before generating the native binary.
- Mobile strict TypeScript and Expo lint pass; all 26 suites / 100 tests pass.
- Expo Doctor passes 20/20 after the dependency fix.
- The dependency audit has no unacknowledged high or critical finding.
- A local iOS Hermes production export completes successfully.
- EAS build 9 completes successfully with SDK 57, build number 9, production signing, and source commit `ba70743`.
- EAS submission `2aaf6efa-1b6d-4c74-8b48-da29401f8d58` finishes without error and requests the `CSG Internal` group. The optional automated **What to Test** note is unavailable on the current EAS plan and must be entered in App Store Connect if desired.

Phase 2 candidate preflight recorded on 2026-08-02:

- Rails passes 369 tests / 1,227 assertions, RuboCop across 269 files, Brakeman with zero warnings, and bundler-audit with no vulnerabilities.
- Web strict TypeScript, ESLint, 10 suites / 29 tests, and the production build pass.
- Mobile strict TypeScript, Expo lint, 28 suites / 103 tests, Expo Doctor 20/20, and CI iOS/Android production exports pass.
- Greptile reviewed every Phase 2 PR; all findings were fixed/resolved and each final review passed before merge.
- EAS build `2f310674-05f7-4eca-b97d-ff7590e58eeb` completed with SDK 57, build number 10, production signing, and source commit `690a84d`.
- Submission `69a8a286-8c5a-4ba1-9f0a-45fcc30788e1` uploaded successfully and Apple processed the binary. EAS reported an error only after Fastlane tried to assign `CSG Internal`; Apple's tester email independently confirms build 10 is available in TestFlight.

Curriculum-authoring candidate preflight recorded on 2026-09-13:

- Merged PRs #124–#131 cover the complete planned native curriculum-authoring sequence. Each phase passed CI and an automated review loop before merge; the final review stopped at the documented diminishing-return boundary only after all actionable findings were fixed and resolved.
- Rails passes 583 tests / 2,172 assertions, RuboCop across 354 files, Brakeman with zero active warnings, and bundler-audit with no vulnerabilities.
- Web strict TypeScript, ESLint, 25 suites / 90 tests, Netlify routing checks, dependency policy, and the production build pass.
- Mobile strict TypeScript, Expo lint, 63 suites / 355 tests, Expo Doctor 21/21, dependency policy, and iOS/Android Hermes production exports pass.
- Hands-on iOS simulator QA passes for the staff Today dashboard, curriculum search, lesson preview, full lesson editing, device-draft preview and clean restoration, messaging, announcements, and account/settings surfaces.
- EAS remote versioning reports build 20, so the production profile's `autoIncrement` will assign build 21. The production profile does not request the manual TestFlight group assignment that caused build 10's post-upload error.
- The concise internal-testing script for build 21 is in [`WHAT_TO_TEST_1.0.0_21.md`](./WHAT_TO_TEST_1.0.0_21.md).

Recording-library candidate preflight recorded on 2026-09-13:

- Merged PRs #134–#135 cover in-app hosted-media playback and the unified first-class recording library across Rails, web, and mobile.
- Rails passes 591 tests / 2,205 assertions, RuboCop across 356 files, Brakeman with zero active warnings, and bundler-audit with no vulnerabilities.
- Web strict TypeScript, ESLint, 25 suites / 90 tests, Netlify checks, dependency policy, and the production build pass.
- Mobile strict TypeScript, Expo lint, 64 suites / 378 tests, dependency policy, and CI iOS/Android production exports pass.
- Hands-on iOS simulator QA passes for staff hosted-link creation and draft handling, student in-app YouTube playback, progress state, help context, original-link fallback, and touch layout.
- The production profile uses remote auto-increment and does not request manual TestFlight group assignment. EAS assigned build 22 as expected.
- The concise internal-testing script for build 22 is in [`WHAT_TO_TEST_1.0.0_22.md`](./WHAT_TO_TEST_1.0.0_22.md).
- A local EAS production archive completed from exact merged-main commit `11b825c8b50b4a3b56f70a43c8ffebaef0e29911`. Expo Doctor passed 21/21; the signed IPA passed package-identity, App Store provisioning, and code-signature checks.
- The IPA is 31,851,826 bytes with SHA-256 `328025d4b7316adae8e409db92f9647991e1df4a765aa4f1f646913f0922fa36`. EAS submission `ab62f5fc-5a90-44b8-884a-7d3d9e6425fe` finished successfully; App Store Connect reports internal `IN_BETA_TESTING` and external beta ready for submission.

Messaging-smoothness candidate preflight recorded on 2026-09-24:

- PR #141 passed its required CI checks. Four CodeRabbit findings were fixed and resolved; its current-head review was rate limited. iOS simulator QA covered navigation and two consecutive demo sends. Signed-in web messaging still needs an authorized account check.
- EAS production environment was checked before archiving: the live API URL and Clerk configuration are present, and `EXPO_PUBLIC_DEMO_MODE=false`.
- The local production archive used remote build number 23 without advancing it again. The package identity, App Store provisioning, team, production API bundle, and code signature were verified from the finished IPA. Its SHA-256 is `9aabf9378e73c207cf6ea2f2ca00cecb5102ad216382d2be3d3e4951679eaf05`.
- Apple validated and uploaded the IPA without error after the queued EAS submission was canceled. App Store Connect reports processing state `VALID` and internal build state `IN_BETA_TESTING`; the English “What to Test” note was saved and read back through its API.
- The focused physical-device and web checks are in [`WHAT_TO_TEST_1.0.0_23.md`](./WHAT_TO_TEST_1.0.0_23.md).

## Physical TestFlight acceptance

The invited tester must install the **exact build selected for public App Review** through TestFlight and complete this acceptance pass with real authorized accounts. Build 32 is the latest uploaded candidate as of 2026-10-03; its Apple processing and internal availability remain unverified. Confirm the build number on the device before testing. The focused [build 32 script](WHAT_TO_TEST_1.0.0_32.md) supplements this broader checklist.

- sign in with Google and confirm unauthorized accounts receive the explicit no-access state;
- verify student, instructor, and admin role scoping where test accounts are available;
- open Today, Learn, Messages, Updates, Recordings, and You against production data;
- send and receive a message, test keyboard following, load older history, and use scroll to latest;
- exercise attachments, mentions, reactions, edits, deletion, pins, threads, and failed-send recovery;
- on a physical iPhone and Android device, open a direct message and a channel, read the pre-permission voice explanation, grant microphone access, record, stop, transcribe, review, edit, restore the original transcript, and explicitly send;
- deny microphone access and confirm typing/device keyboard dictation remain available; verify Cancel, Retry transcription, Record again, interruption, screen lock, backgrounding, a five-minute recording, and a poor network never lose existing typed text or auto-send;
- verify technical terms, commands, code, URLs, names, numbers, dates, and grades with representative CSG speech over a Guam mobile network; record latency and any meaning-changing cleanup before enablement;
- after successful transcription, cancellation, failure dismissal, sign-out, and app termination, confirm no playable voice-draft file remains in app-visible cache or conversation history;
- interrupt recording and transcription with existing class-recording playback, calls, route changes, and app background/foreground transitions; confirm playback and the audio session recover predictably;
- open a push notification from foreground, background, and terminated states and verify its deep link;
- open a lesson, submit or update eligible work, and confirm progress/feedback convergence with web;
- as staff, search the curriculum library, preview an existing lesson, edit its details and rich instructions, preview the device draft, save it, and confirm the same canonical content appears on web;
- create/reorder/archive a test module or lesson where authorized; configure objectives, rubric, retrieval check, hosted video, and browser runner, then confirm student preview remains read-only and matches the saved lesson;
- drag a long lesson/message code block horizontally with one finger and confirm its full contents remain reachable without using page controls;
- open a Phase 2 lesson and confirm objectives/success criteria appear before work, rubric criteria appear before submission, and criterion ratings/feedback appear after grading;
- answer a retrieval check incorrectly and correctly, confirm immediate explanation/retry state, and confirm only the correct attempt completes the checkpoint;
- dictate, review, edit, restore, and explicitly submit a thread reply, help question/response, and grading-feedback draft where authorized; confirm none auto-send or auto-save;
- play a secure recording, background/foreground it, use fullscreen/PiP, and confirm resume progress;
- exercise the staff attention queue and one grading action with an authorized staff account;
- verify sign-out clears account-scoped cached content.

Record any device-only defect before submitting the public version. Before enabling voice, update the public privacy policy and App Store privacy answers to describe microphone audio and temporary third-party transcription processing accurately; approve the production provider project's retention/data controls; then set `VOICE_TRANSCRIPTION_ENABLED=true`. After this checklist passes, confirm the privacy, age-rating, support, export-compliance, and review-contact fields one final time and explicitly submit the version to App Review.
