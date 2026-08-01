# Mobile Offline Continuity

## Product contract

CSG Connect supports interrupted and low-connectivity learning without claiming that local work reached the server. The Rails API remains the source of truth.

- Previously loaded learning queries, including lesson text, resource metadata, feedback, and **This Week**, are retained in a seven-day user-scoped SQLite cache.
- Channel and direct-message drafts, thread-reply drafts, failed channel/DM messages, and text-submission drafts are retained per signed-in Rails user.
- A text-submission draft is labeled **not submitted** until the create/update request receives a server response.
- A failed message is labeled **Not sent** and requires an intentional retry.
- Nothing in this phase auto-sends when connectivity returns.
- Sign-out and terminal authentication/authorization failures remove the signed-in user's query cache, authored drafts, and failed-message retry copies.

AsyncStorage is persistent but unencrypted, so it is used only for the minimum authored draft/retry state needed for continuity. Clerk tokens remain in SecureStore. The app must not place staff support-request text, voice audio, access tokens, or signed media URLs in this draft store.

## Text-submission behavior

1. After the server-authorized lesson loads, text changes are saved locally after a short debounce.
2. The interface says when the device draft is saving or saved and explicitly says it is not submitted.
3. A draft records the submission ID it was based on. If the server submission changes on another device, CSG does not silently overwrite it; the student can intentionally restore the older device draft.
4. A failed submit keeps the response visible, performs an immediate local save, and reports **Not submitted**.
5. Only a successful API response clears the local draft and reports submitted/updated success.

Repository URLs, pull-request details, attachments, and media are not offline submission types. They depend on current remote state and remain online-only.

## Message behavior

- Channel and DM composers restore their local draft even when the conversation refresh fails.
- Thread composers use a separate root-message-scoped key so a reply cannot replace the main conversation draft.
- Channel/DM sends use optimistic UI, but network/API failures become durable **Not sent** bubbles with a retry control.
- Thread failures restore and persist the reply in the composer; they do not create a false sent bubble.
- Attachments remain online-only because upload acknowledgment must precede message creation.

## Deferred boundary

Managed lesson/recording downloads remain deferred until retention, storage quotas, logout deletion, signed-URL handling, and device-loss policy are approved. Background write queues are also deferred: explicit retry is easier to understand and avoids duplicate submissions/messages until an idempotency contract exists.

## Release checks

- Open a previously loaded lesson without a network connection and confirm lesson text/feedback remain readable.
- Enter a text response, leave and reopen the lesson, and confirm the draft returns as **not submitted**.
- Attempt submission offline and confirm no success language appears; reconnect, retry, and confirm the draft clears only after acknowledgment.
- Create and restore channel, DM, and thread drafts while offline.
- Fail a channel/DM send and confirm **Not sent** survives an app restart and retries intentionally.
- Sign out, sign back in, and confirm the prior user's authored local state is absent.
- Confirm a second signed-in user's local keys are not removed by another user's cleanup.
