# CSG Connect Mobile

The native communications client for the CSG Learning Platform. This first release intentionally focuses on the daily loop: channels, direct messages, announcements, unread state, real-time updates, and native push notifications.

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

The mobile package pins Node 22.22.3 independently from the web package because Expo SDK 57 dependencies require a newer Node runtime.

Required environment variables:

| Variable | Purpose |
|---|---|
| `EXPO_PUBLIC_API_URL` | Rails API origin; `http://localhost:3000` works in the iOS Simulator |
| `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk native application publishable key |
| `EXPO_PUBLIC_EAS_PROJECT_ID` | Expo project ID used to issue push tokens |

Clerk Native API must be enabled for the Clerk instance. Native push token creation also requires an EAS project and platform push credentials.

## Simulator walkthrough

For deterministic visual QA without using a real account, start a development build with:

```bash
EXPO_PUBLIC_DEMO_MODE=true npx expo start --dev-client --clear
```

Demo mode only activates when React Native's `__DEV__` flag is true. Production builds cannot enter it from this environment variable alone. Prefer the one-command override above instead of saving demo mode in `.env`, so the next normal launch returns to real account data. It exercises navigation, filtering, composition, message sending, unread states, updates, profile, and empty states against local sample data. API contracts and native push delivery are covered separately by mobile and Rails tests.

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
