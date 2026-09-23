# What to Test — CSG Connect 1.0.0 (23)

Build 23 improves how conversations open, how messages appear while sending, and how older history loads on iPhone and web.

Please focus on:

- Open a direct message and a channel, switch between them, then visit Today or Learn and return to Messages. Check that conversations open smoothly and the composer keeps any unsent draft.
- Send two short messages quickly in the same conversation. Each should appear immediately, in order, and only once after delivery.
- Send an attachment on a weaker connection. Check that its message appears before the upload finishes, shows progress, and offers a retry if the upload fails.
- Scroll back through several pages of an active conversation. Check for missing or repeated messages, then use the control to return to the latest message.
- Switch conversations while a message is sending, then return. Check that delivery or failure is clear and that another message can still be sent.
- Repeat the navigation, sending, and older-history checks on the web app with the same authorized account. Confirm the message order agrees across devices.
- Spot-check replies, reactions, edits, and notifications for regressions.

Please report the account role, iPhone model and iOS version (or desktop browser), conversation type, connection quality, exact steps, and whether the issue also appears on web. Do not include private message content in a report unless it is necessary to reproduce the issue. Public App Review remains separate from this internal test.
