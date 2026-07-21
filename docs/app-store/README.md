# CSG Connect App Store Release Record

Last updated: 2026-07-22 (Pacific/Guam)

This directory is the durable source record for the App Store presentation of the completed mobile-parity program. It records what was uploaded, how the images were produced, and what remains before public App Review.

## Current iOS release

| Item | State |
| --- | --- |
| Marketing version | `1.0.0` |
| TestFlight build | `4` |
| EAS build ID | `b031b7f6-6758-4f41-b330-90a88b63e6dc` |
| Source commit | `070b4dc` (`main`) |
| App Store version | `1.0`, Prepare for Submission |
| Internal group | `CSG Internal` |
| Tester access | Active invited internal tester; identity retained in App Store Connect only |
| Public App Review | Intentionally not submitted pending physical TestFlight acceptance |

Build 4 finished successfully, was processed by App Store Connect, is attached to the 1.0 App Store draft, and is available to the internal group.

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

Final regression evidence recorded on 2026-07-22:

- Rails: 291 tests / 877 assertions; RuboCop 212 files; Brakeman zero warnings; bundler-audit clean.
- Web: 5 suites / 21 tests, ESLint clean, production build successful, and no high-severity npm audit finding.
- Mobile: strict TypeScript and Expo lint clean; 16 suites / 52 tests; Expo dependency check clean; Expo Doctor 20/20; iOS and Android Hermes exports successful.
- Store assets: all 12 PNG files match their required 1320×2868 or 2064×2752 dimensions.
- The mobile npm audit reports only known moderate transitive advisories in Expo/Clerk build tooling; no direct production dependency upgrade currently resolves them without a breaking toolchain change.

## Physical TestFlight acceptance

The invited tester must update to build 4 in TestFlight and complete this final acceptance pass with real authorized accounts:

- sign in with Google and confirm unauthorized accounts receive the explicit no-access state;
- verify student, instructor, and admin role scoping where test accounts are available;
- open Today, Learn, Messages, Updates, Recordings, and You against production data;
- send and receive a message, test keyboard following, load older history, and use scroll to latest;
- exercise attachments, mentions, reactions, edits, deletion, pins, threads, and failed-send recovery;
- open a push notification from foreground, background, and terminated states and verify its deep link;
- open a lesson, submit or update eligible work, and confirm progress/feedback convergence with web;
- play a secure recording, background/foreground it, use fullscreen/PiP, and confirm resume progress;
- exercise the staff attention queue and one grading action with an authorized staff account;
- verify sign-out clears account-scoped cached content.

Record any device-only defect before submitting the public version. After this checklist passes, confirm the privacy, age-rating, support, export-compliance, and review-contact fields one final time and explicitly submit the 1.0 version to App Review.
