# What to Test — CSG Connect 1.0.0 (25)

Build 25 is the premium-messaging candidate. First confirm that TestFlight shows **1.0.0 (25)** on the iPhone. The upload succeeded, but Apple processing and internal tester availability must be confirmed before this script can be run.

Use two authorized accounts where possible: one to send and one to read. Test a direct message and a channel.

1. Send messages in several conversations, including an older conversation. Return to the Messages list after each send. The conversation with the newest activity should move to the top, and its preview and time should match its latest message. Check the same order on web.
2. Receive a push while the app is in the background. Tap it, then use the iPhone's left-edge swipe to go back. It should return to the full Messages list, not an earlier snapshot of the conversation. Repeat after opening a notification while the app is already in use and after a cold launch if available.
3. In a conversation, press and hold a message. Check that the action menu appears and a reaction can be added, changed, and removed. Check that the result appears on web and for the other account. Also try the equivalent web action.
4. Have the other account read several consecutive messages. Confirm the read indicator appears only on the last message in that read run, then send another message and read it. Check direct messages and channels where read indicators are available.
5. Leave several messages unread. Open the conversation and check that the unread divider marks the boundary. Open an older notification while newer messages are still unread; those newer messages should remain unread until actually viewed.
6. Send two messages quickly, switch conversations while one sends, then return. Confirm order, no duplicates, and a clear retry if delivery fails. Scroll into older history and return to the latest message. Repeat the core flow on web.

Report the iPhone model, iOS version, account role, conversation type, exact steps, and whether the issue also appears on web. Avoid including private message content. The [broader physical TestFlight checklist](README.md#physical-testflight-acceptance) still applies before public App Review.
