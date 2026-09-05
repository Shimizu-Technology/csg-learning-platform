# Messaging stabilization plan

**Last updated:** 2026-09-05
**Status:** In progress

## Outcome

Make messaging dependable enough to replace the day-to-day class communication currently handled in Slack, without turning the learning platform into a generic workplace suite.

The finished experience must work on desktop web, mobile web, and the native iOS app. A user should be able to move between conversations without losing or misdirecting a draft, send or retry without creating duplicate messages, reach older history, format the intended text, and understand whether a message is pending or failed.

## Re-audit findings

### Correctness issues

1. Message creation has no idempotency contract. If the server accepts a send but the response is lost, a manual retry can create a duplicate message and duplicate notifications.
2. The web composer owns one global draft. Switching channels, DMs, or thread context can carry that text to the wrong recipient.
3. The web clears the composer before the API confirms delivery. A failed optimistic message is marked “Not sent,” but cannot be retried, edited, or discarded and does not survive reload.
4. Native message editing reuses the conversation draft state. Starting an edit overwrites the unsent draft; cancelling or saving erases it.
5. The API accepts 5,000 message characters, while native inputs accept 10,000 and web does not enforce or explain the limit.
6. The API exposes bounded history and pagination metadata, but the web client only keeps the latest window and cannot load older messages.

### Composer and interaction issues

1. TipTap's default list command converts whole paragraphs. That is normal editor behavior, but it does not meet the requested chat behavior when a caret or partial selection sits inside existing text.
2. The always-expanded web toolbar consumes too much of a mobile viewport and clips controls horizontally.
3. The formatting toolbar lacks complete pressed-state and toolbar semantics for assistive technology.
4. Web message editing falls back to a raw Markdown textarea instead of the same composition model.
5. The web client lacks native's copy-message action and does not make its send/newline keyboard behavior clear.

### Real-time and parity gaps

1. Messages, edits, deletes, reactions, pins, unread counts, read receipts, Web Push, search, and connection recovery already exist and should be preserved.
2. Typing state is not implemented. It is valuable only after send, draft, history, and composer behavior are reliable.
3. Native renders rich Markdown but does not offer formatting controls. It needs a compact selection-aware affordance rather than a desktop toolbar copied onto a phone.

## Delivery sequence

### PR 1 — delivery integrity and native draft safety

- Add an optional per-author client message ID with a database uniqueness guarantee.
- Make identical retries return the original message, resume unfinished notification or realtime delivery, and avoid repeating completed delivery work.
- Route soft-delete events through the same recipient checkpoints so an interrupted realtime deletion is recovered without a manual refresh.
- Reconcile native optimistic messages against realtime events by client message ID.
- Keep native edit text separate from the unsent conversation draft.
- Enforce the shared 5,000-character limit in native conversation and thread inputs.

### PR 2 — web state and history reliability

- Store drafts per signed-in user and exact target, with a separate thread draft.
- Preserve failed optimistic sends across reload and provide retry, edit, and discard actions.
- Reuse the same client message ID for every retry.
- Add older-message pagination and preserve scroll position.
- Enforce and explain the 5,000-character contract.

### PR 3 — composer behavior and accessibility

- Implement selection-aware list insertion for the caret and partial selections.
- Make the web toolbar compact and usable at phone widths, with correct toolbar and pressed states.
- Align rich editing, copy actions, keyboard hints, focus behavior, and error feedback.
- Add compact native formatting controls that operate on the current selection.

### PR 4 — real-time collaboration, only after the prior gates pass

- Add privacy-conscious, ephemeral typing indicators with expiry and disconnect cleanup.
- Add an in-timeline unread boundary if testing shows it improves orientation beyond the existing new-message control.

## Release gate

Each pull request must pass Rails tests, RuboCop, Brakeman, dependency audit, web lint/typecheck/unit tests/build, mobile lint/typecheck/unit tests/export checks, focused browser testing at desktop and phone widths, and native simulator testing where applicable. Every actionable CodeRabbit finding must be fixed or answered against the current commit before merge.

After the final merged regression passes, archive the next production iOS build from merged `main`, submit it to App Store Connect, and verify the TestFlight processing state. Physical-device acceptance remains a human gate.
