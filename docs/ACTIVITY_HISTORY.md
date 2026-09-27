# Activity history

CSG keeps a small, server-backed history for account access and learning work. Staff can review a student's history in the student workspace on web or native. Administrators can review instructor and administrator histories from Team on web. Each member can review their own history from Profile or You.

## What is recorded

- A sign-in is recorded once for each verified Clerk `sid`, even if the app refreshes its session or the member switches between web and native. The database stores an HMAC digest of the session ID, never the raw ID. If a verified token lacks `sid`, CSG cannot distinguish a new sign-in from a refresh and does not create a sign-in event.
- Completion and reopening of learning checkpoints, submitted work, updates to submitted work, and grading are recorded after successful server writes.
- The first saved progress and completion of a hosted or supported YouTube/Vimeo lesson video or class recording are recorded. Periodic player pings do not create timeline entries.

Video activity is **player-reported progress**. It does not prove attention, comprehension, or that someone watched every frame. The UI says this beside each video event. Native YouTube/Vimeo lesson playback now saves the same progress used by the history; external players outside the app are not observable.

## Access and privacy

The API serves a member's own history, student history to instructors and administrators, and staff history to administrators. A cohort filter requires the subject to have an enrollment in that cohort. Results are paginated by event ID, with a maximum page size of 100.

Events contain numeric user, cohort, and record references, an event type, an evidence label, and a timestamp. They do not store authored text, message bodies, submissions, feedback, video URLs, names, emails, or Clerk IDs. The read API resolves a current record title for display when that record still exists. PostHog remains separate and continues to follow `ANALYTICS_EVENT_CONTRACT.md`.

History starts when this migration is deployed. Earlier events are not reconstructed, and the preexisting `last_sign_in_at` field may reflect older refresh-based writes. No automatic retention window or export is included in this first release. Account deletion still follows the existing deletion process.
