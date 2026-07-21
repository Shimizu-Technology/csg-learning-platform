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

Curriculum, lesson progress, resources, submissions, office hours, class recordings, staff attention triage, student health, and quick grading are now native. Dense authoring, bulk operations, and comparison matrices remain deliberate authenticated handoffs to the responsive web app.

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
- The Phase 3 recording library and S3/lesson-video player add native resume, progress sync, signed-URL renewal, speed control, fullscreen rotation, interruptions, and PiP. Legacy YouTube/external recordings use a safe system handoff.
- Managed offline recording downloads remain deferred until retention, device-storage, privacy, and logout-deletion policy is approved. The player does not cache signed media URLs.
- Phase 4 gives staff a ranked cross-cohort attention queue, student health and progress drill-downs, a focused grading queue, native A/B/C/Redo reviews, concise feedback, and direct submission push routes.
- Staff can browse active and upcoming cohort recordings and resources without pretending to be enrolled in those cohorts.
- Curriculum authoring, bulk enrollment/team operations, dense grading/watch-progress matrices, and repository inspection retain labeled one-time authenticated web handoffs because they are desktop-shaped workflows.
- Final App Store/Play Store metadata and screenshots after the parity program stabilizes

The Rails API remains the single product backend, so every native phase is additive rather than a fork of web behavior.
