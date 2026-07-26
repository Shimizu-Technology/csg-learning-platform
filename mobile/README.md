# CSG Connect Mobile

The native companion for the CSG Learning Platform. It covers the daily
learning and communication loop: staff/student dashboards, lessons, class
resources and recordings, grading, channels, direct messages, announcements,
real-time updates, and native push notifications.

## Stack

- Expo SDK 57 / React Native 0.86 / React 19.2
- Expo Router with protected route groups
- Clerk Expo with encrypted SecureStore token caching
- Rails REST API for history and mutations
- Action Cable for live conversation events
- Expo Notifications for iOS and Android push delivery
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

Clerk Native API must be enabled for the Clerk instance. Native push token creation also requires an EAS project and platform push credentials.

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

If more than one simulator is booted, set `CSG_IOS_DEVICE` to the desired
simulator UDID. Test artifacts stay in the ignored `.maestro-artifacts/`
directory.

## Quality checks

```bash
npm run check
```

This runs strict TypeScript, Expo ESLint, and Jest. The Rails suite includes the mobile device-token endpoint and Expo push delivery service.

## Release path

1. Create the Expo project and place its ID in app/EAS configuration.
2. Configure Clerk Native API and the exact bundle/package identifiers.
3. Configure Apple APNs and Android FCM credentials through EAS.
4. Build internal development clients and test push on physical iOS and Android devices.
5. Run `eas build --platform all --profile production`, then submit through the store review flows.
