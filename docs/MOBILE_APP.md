# CSG Connect Mobile Architecture

## Product boundary

CSG Connect is the native companion to the learning platform, not a second implementation of the entire LMS. Version one solves the highest-frequency mobile job: staying connected to class.

Included now:

- Cohort and community channels
- Direct and small-group conversations
- Real-time incoming message updates
- Optimistic message sending with failure recovery
- Unread cursors and mute controls
- Cross-conversation message search
- Announcements and pinned updates
- Native notification registration and deep links
- Encrypted Clerk session persistence
- A cached inbox fallback through local persisted state

Curriculum, recordings, submissions, grading, progress, office hours, and staff management stay in the responsive web/PWA until each native workflow earns its place.

## Runtime flow

1. Clerk authenticates the user and stores the session token in SecureStore.
2. `POST /api/v1/sessions` synchronizes the Clerk identity with the Rails user.
3. The app loads channels, direct conversations, and announcements from the existing `/api/v1` REST API.
4. A short-lived, single-use cable token opens the authorized Action Cable stream for the active conversation.
5. Message mutations go through REST; cable events reconcile changes from every participant.
6. The native client registers an Expo device token with Rails. Existing notification jobs fan out to both Web Push and Expo Push.
7. Notification taps route directly to the matching channel, DM, or updates surface.

## Security and reliability

- Rails remains the only authorization boundary; native route guards are convenience, not security.
- Clerk tokens use encrypted platform storage and are refreshed after unauthorized GET responses.
- Device tokens are unique, user-owned, removable at sign-out, and invalidated after Expo reports `DeviceNotRegistered`.
- API requests have timeouts, a single safe retry for GETs, and user-readable errors.
- The inbox caches only the signed-in user's scoped conversation summaries. Signing out clears cached session, inbox, and device-token state.
- Demo content is restricted to `__DEV__` builds and never substitutes for API authorization tests.

## Deferred native scope

- Attachments, threads, edit/delete, reactions, and staff channel management
- Curriculum and lesson delivery
- Recording playback and offline downloads
- Submissions, grading, and GitHub workflows
- Office hours and live classroom sessions
- App Store/Play Store production metadata and screenshots

The Rails API contracts make those additive phases; the messaging-first release does not need to be discarded or rewritten.
