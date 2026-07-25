# Premium Messaging Quality Audit

Last reviewed: July 25, 2026

## Product standard

The mobile app is an alternative client for the same CSG account, workspaces,
messages, reactions, attachments, read state, and notification preferences used
by the web app. Background synchronization must preserve a person's context;
only the first authenticated load or a genuine access denial may replace the
active screen.

This standard follows Apple's guidance to keep content available while
background loading occurs and to preserve context across state changes:

- [Apple Human Interface Guidelines: Loading](https://developer.apple.com/design/human-interface-guidelines/loading)
- [Apple Human Interface Guidelines: Design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles)
- [Apple Human Interface Guidelines: Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback)

## Findings and resolution

| Area | Finding | Resolution |
| --- | --- | --- |
| Session continuity | Token/session revalidation set the same blocking flag used by first launch. The app layout could be replaced even when a valid user and navigation stack already existed. | Session revalidation now keeps the established user mounted. Clerk's token getter and the API client have stable identities, so token lifecycle updates do not rebuild downstream providers. |
| Screen continuity | Conversations, updates, workspaces, and staff communication settings depended on full user objects. A refreshed object could retrigger blocking loaders while the user was working. | Dependencies now use stable user IDs and role flags. Background workspace refreshes retain existing content and active selection. |
| Reactions | Mobile and web reaction chips immediately toggled the current user's reaction. Web participant names were available only through hover, and mobile had no participant view. | Reaction chips now open participant details on both platforms. Users can switch between reaction groups, see names, and explicitly add or remove their own reaction. Long-press/hover quick reactions remain available. |
| Image attachments | Mobile opened every remote attachment in the browser, breaking conversation context. | Images now open in a native full-screen viewer with previous/next navigation, metadata, close, and system sharing. Non-image documents retain the system link behavior. |
| Notification setting | The mobile row was labeled only as push even though the stored preference controls DM email and device alerts. The native switch's intrinsic size also floated above the visual center of the card. | The setting is labeled **Message notifications**, explains email and device alerts, uses a centered 44-point switch slot, and shows an inline loading indicator. The same switch treatment is used in staff communication and announcement editors. |
| DM email reliability | Provider exceptions were converted to `false` and ignored by the job. Failed sends appeared successful, could not retry, and logs included recipient email addresses and unbounded provider responses. | DM email sends now use a per-notification Resend idempotency key, verify the provider delivery ID, raise a typed failure, and retry with polynomial backoff. Structured logs identify message, notification, recipient user, skip reason, and provider delivery ID without logging addresses or message contents. |
| Accessibility | Reaction participation was not keyboard/touch discoverable on web, and image/reaction controls did not describe their result on mobile. | Web uses a focus-trapped dialog with tabs and explicit actions. Mobile controls have semantic roles, labels, hints, and at least 44-point primary targets. |

Slack also exposes reaction authors as a deliberate interaction on both desktop
and mobile rather than making participant information hover-only:
[Slack: Use emoji and reactions](https://slack.com/help/articles/202931348-Use-emoji-and-reactions).

## Quality characteristics already present

- Inverted mobile conversation lists keep the newest edge stable and preserve
  scroll position as older messages load.
- Keyboard appearance follows the latest message only when the user is already
  near the conversation edge; it does not steal position while reading history.
- Jump-to-latest distinguishes newly arrived messages from ordinary history.
- Drafts and failed sends persist per user and conversation.
- Action Cable reconnects with backoff and reconciles optimistic messages.
- Conversation mute settings override global message alerts.
- Attachments validate type and size before upload and display upload progress.
- Threads, pins, mentions, read receipts, workspace switching, search, and
  offline caches operate on the same API entities as the web client.

## Recommended next refinements

These are enhancements rather than release blockers:

1. Add pinch-to-zoom and double-tap zoom to the native image viewer.
2. Cache viewed image thumbnails on-device and expose a deliberate save-to-photo
   action after requesting photo-library permission.
3. Add lightweight haptic confirmation for send, reaction, and jump-to-latest
   actions, respecting reduced-motion/accessibility preferences.
4. Add Resend delivery webhooks so accepted, delivered, bounced, and suppressed
   states can be inspected from an admin-only delivery timeline.
5. Add message-level notification diagnostics for staff that expose safe status
   and timestamps, never message bodies, email addresses, or provider secrets.

## Release verification

Before TestFlight submission:

- Run all Rails, web, and mobile tests, strict type checking, and linting.
- Verify reaction details and explicit toggling in web and iOS.
- Verify an image opens and closes without leaving the app.
- Keep a conversation open through repeated session refreshes and confirm its
  route, scroll position, composer text, keyboard state, and modal state remain.
- Send a DM to an enabled recipient and verify one provider delivery ID appears;
  then simulate a provider failure and verify a retry is scheduled.
- Confirm disabled, archived, and email-less recipients produce safe skip-reason
  logs and no delivery attempt.
- Check profile, staff communication, and announcement switches in light/dark
  simulator accessibility sizes for consistent vertical alignment.
