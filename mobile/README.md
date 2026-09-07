# CSG Connect Mobile

The native companion for the CSG Learning Platform. It covers the daily
learning and communication loop: staff/student dashboards, lessons, class
resources and recordings, grading, channels, direct messages, announcements,
contextual student help, a focused staff support queue, real-time updates, and
native push notifications.

## Stack

- Expo SDK 57 / React Native 0.86 / React 19.2
- Expo Router with protected route groups
- Clerk Expo with encrypted SecureStore token caching
- Rails REST API for history and mutations
- Action Cable for live conversation events
- Expo Notifications for iOS and Android push delivery
- PostHog manual product events with autocapture and session replay disabled
- Expo Audio for reviewed, foreground-only voice-to-text message drafts
- Manrope and Lucide React Native for the CSG design system

## Local setup

```bash
cd mobile
cp .env.example .env
npm install
npm run check
npx expo run:ios
```

Normal development uses real Clerk authentication and the Rails API. Keep `EXPO_PUBLIC_DEMO_MODE=false`, use the same Clerk publishable key as the web app, and restart Metro with `--clear` whenever an `EXPO_PUBLIC_*` value changes:

```bash
npx expo start --dev-client --clear
```

The inbox loads its workspace list from Rails. Staff can switch among every active cohort and community workspace; students see only active cohort enrollments and explicit community memberships. Channels, DMs, unread counts, and member pickers are filtered to the selected workspace without weakening the API authorization boundary.

Staff can publish a class recording from **Learn → Class recordings → Upload**.
Videos below 100 MB use a presigned form upload; larger videos use retryable
multipart upload through 5 GB. Keep the upload screen open until publishing
finishes. Admins can restart one student's live-class progress from the student
health screen through the authenticated web handoff; the action requires typing
the student's email and retains a recovery snapshot without removing the
account, messages, or other curricula.

The mobile package pins Node 22.22.3 independently from the web package because Expo SDK 57 dependencies require a newer Node runtime.

Required environment variables:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Rails API origin; `http://localhost:3000` works in the iOS Simulator |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk native application publishable key |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Expo project ID used to issue push tokens |
| `EXPO_PUBLIC_POSTHOG_KEY` | Optional CSG PostHog project key; development and demo builds never capture |
| `EXPO_PUBLIC_POSTHOG_HOST` | Optional PostHog ingest endpoint; defaults to `https://us.i.posthog.com` |

Clerk Native API must be enabled for the Clerk instance. Native push token creation also requires an EAS project and platform push credentials. Analytics events must follow `docs/ANALYTICS_EVENT_CONTRACT.md`; do not add direct PostHog capture calls outside the typed helper.

Voice message drafts use the Expo SDK 57 `expo-audio` config plugin with an explicit microphone permission string. This requires a new native build and cannot ship as a JavaScript-only update. Audio stays in the app cache, is sent only after an intentional recording action, and is deleted after success, cancellation, or terminal dismissal. The Rails endpoint remains disabled until its server-side provider/privacy gate is enabled.

The student Today tab also loads `/api/v1/weekly_plan`. This is the canonical **This Week** contract shared with web; do not derive a second weekly schedule from dashboard modules in native code. React Query persists this read-only projection for seven days inside the signed-in Rails user’s SQLite cache and sign-out removes that cache.

Offline continuity follows `docs/OFFLINE_CONTINUITY.md`. Previously loaded learning queries remain readable from the user-scoped cache. Channel, DM, thread, and text-submission composers persist device drafts; failed writes are explicitly **Not sent** or **not submitted**, require intentional retry, and clear only after server acknowledgment. Sign-out removes authored draft/retry state. Media downloads and automatic background write queues remain deferred.

### Clerk social sign-in

Google sign-in uses Clerk's browser-based SSO flow and returns through
`csgconnect://oauth-callback`. Before shipping a native build:

1. Enable Google for sign-in in the same Clerk application used by the web app.
2. Register `com.codeschoolofguam.connect` as the iOS and Android native app in Clerk.
3. Add `csgconnect://oauth-callback` to Clerk's mobile SSO redirect allowlist.
4. Configure production Google credentials in Clerk instead of relying on Clerk's development credentials.

Email/password access remains sign-in-only in the mobile UI. Production API access is
invite-based, so students and staff must use the email attached to their CSG account.

## Simulator walkthrough

For deterministic visual QA without using a real account, start a development build with:

```bash
EXPO_PUBLIC_DEMO_MODE=true npx expo start --dev-client --clear
```

Set `EXPO_PUBLIC_DEMO_ROLE=student` alongside demo mode to load the student
persona and role-specific learning, message, and notification fixtures. Omitting
it keeps the staff/admin walkthrough.

Demo mode only activates when React Native's `__DEV__` flag is true. Production builds cannot enter it from this environment variable alone. Prefer the one-command override above instead of saving demo mode in `.env`, so the next normal launch returns to real account data. It exercises navigation, filtering, composition, message sending, unread states, updates, profile, and empty states against local sample data. API contracts and native push delivery are covered separately by mobile and Rails tests.

### Native iOS smoke test

The checked-in Maestro flows exercise the real native navigation tree, open a
conversation, focus the composer, type with the keyboard open, and traverse
every shipped mobile route. Install Maestro, start the development server in
demo mode, and run the flows against a booted simulator:

```bash
EXPO_PUBLIC_DEMO_MODE=true npx expo start --dev-client --host lan --clear
CSG_METRO_HOST="$(ipconfig getifaddr en0)" npm run test:e2e:ios
```

For the student journey, restart Metro with the student persona and run its
dedicated flow:

```bash
EXPO_PUBLIC_DEMO_MODE=true EXPO_PUBLIC_DEMO_ROLE=student npx expo start --dev-client --host lan --clear
CSG_METRO_HOST="$(ipconfig getifaddr en0)" npm run test:e2e:ios:student
```

If more than one simulator is booted, set `CSG_IOS_DEVICE` to the desired
simulator UDID. Test artifacts stay in the ignored `.maestro-artifacts/`
directory.

## Quality checks

```bash
npm run check
```

This runs strict TypeScript, Expo ESLint, and Jest. The Rails suite includes the mobile device-token endpoint and Expo push delivery service.

## Release path

1. Confirm the existing Expo project ID and exact iOS/Android identifiers.
2. Configure Clerk Native API and production social-login redirects.
3. Configure Apple APNs and Android Firebase/FCM V1 credentials through EAS.
4. Build internal development clients and test push on physical iOS and Android devices.
5. Run `eas build --platform all --profile production`, then submit through the store review flows.

The Android-specific account conversion, policy, listing, reviewer-access, data-safety, testing, and staged-release runbook lives in [`docs/app-store/android/README.md`](../docs/app-store/android/README.md). Do not upload a bundle until every release gate there is reconciled against the final build.
