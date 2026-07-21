# CSG Connect Mobile Architecture

## Product boundary

CSG Connect is the native companion to the learning platform. Its first complete product slice solves the highest-frequency mobile job—staying connected to class—against the exact same Rails records and authorization rules as the web app. The longer-term parity program is defined in [MOBILE_PARITY_IMPLEMENTATION_PLAN.md](MOBILE_PARITY_IMPLEMENTATION_PLAN.md).

Included now:

- Cohort and community channels
- Direct and small-group conversations
- Real-time incoming message updates
- Optimistic message sending with failure recovery
- Unread cursors and mute controls
- Cross-conversation message search
- Anchored search results and paged message history
- Attachments, mentions, reactions, edits, deletion, pins, and threads
- Draft persistence and durable failed-message retry
- Announcements, staff publishing controls, and the complete notification inbox
- Staff workspace, membership, and channel controls
- Global and per-conversation notification preferences
- Native notification registration and deep links
- Encrypted Clerk session persistence
- A cached inbox fallback through local persisted state

Curriculum, recordings, submissions, grading, progress, office hours, and staff management stay in the responsive web/PWA until each native workflow earns its place.

## Runtime flow

1. Clerk authenticates the user and stores the session token in SecureStore.
2. `POST /api/v1/sessions` synchronizes the Clerk identity with the Rails user.
3. The app loads the server-authorized workspace list, channels, direct conversations, and announcements from the existing `/api/v1` REST API.
4. The selected workspace is remembered per user. Staff receive all active workspaces; students receive only active cohort enrollments and explicit community memberships. The inbox and DM member picker filter the same server data to that selection.
5. A short-lived, single-use cable token opens the authorized Action Cable stream for the active conversation.
6. Message mutations go through REST; cable events reconcile changes from every participant.
7. The native client registers an Expo device token with Rails. Existing notification jobs fan out independently to both Web Push and Expo Push.
8. Notification taps route directly to the matching channel, DM, or updates surface.

## Security and reliability

- Rails remains the only authorization boundary; native route guards are convenience, not security.
- Clerk tokens use encrypted platform storage and are refreshed after unauthorized GET responses.
- Device tokens are unique, user-owned, removable at sign-out, and invalidated after Expo reports `DeviceNotRegistered`.
- API requests have timeouts, a single safe retry for GETs, and user-readable errors.
- The inbox and workspace list cache only the signed-in user's scoped summaries. Signing out clears cached session, workspace selection, inbox, and device-token state.
- Demo content is restricted to `__DEV__` builds and never substitutes for API authorization tests.

## Next parity phases

- Curriculum, lesson delivery, progress, resources, and submissions
- Recording playback and offline downloads
- Grading, student/cohort operations, GitHub workflows, and other staff intervention tools
- Intentional web handoffs for high-density administration that does not benefit from a native duplicate
- Final App Store/Play Store metadata and screenshots after the parity program stabilizes

The Rails API remains the single product backend, so every native phase is additive rather than a fork of web behavior.
