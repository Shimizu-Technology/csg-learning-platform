# P6a message navigation — 2026-10-22

Implementation worker: Codex. Integration and merge owner: the lead. Do not merge this PR from the worker session.

## Context and acceptance

Started in the assigned clean worktree at `3eee7c4`, fetched and rebased onto `dc86257` (PR #196), and created `fix/p6a-message-navigation`. Sources: `docs/PRODUCT_VISION.md`; Brain Dump `code-school/csg-learning-platform-plan.md` (mobile-first, shared learning hub); the lead's `audit/WORKER_BRIEF.md`, `audit/PLAN.md`, and `audit/verify-comms.md` findings N-C1, N-C2, N-C9, S14. Students use phones heavily; students and staff need exact communication destinations across enrollment/workspace contexts. Rails authorizes access; Clerk supplies identity; push and email delivery are separate integrations.

Acceptance: root links highlight their root; reply links resolve the old root and display the named reply in its thread, even beyond the feed window. Ordinary conversation opens show the latest messages. New arrivals preserve someone reading history and expose a jump action. The unread divider remains available when history reaches it. Read cursors never advance to hidden replies or newer unseen items. Authorized native destinations select their workspace once so Back reaches the correct inbox, without continuously undoing a deliberate community selection. Message and mention email links name the exact message while stored clearing paths remain unchanged. Density, author context, and visual redesign belong to P6b.

## Implementation

- Reuse `GET /api/v1/messages/:id/thread` as the authorized resolver. It already fetches the root and all chronological replies independently of the conversation window. Deleted anchors/roots now return 404; unauthorized workspaces remain forbidden. Resolving does not mark anything read.
- Web resolves the anchor before fetching surrounding root context, merges the complete thread, opens it for reply destinations, and delays highlighting/read acknowledgement until the rendered pane exists. Ordinary opens ignore saved history offsets and wait for the conversation shell before scrolling to the bottom. Manual scrolling cancels the initial follow operation. Hidden replies do not drive conversation read cursors.
- Native search retains `messageId`. Conversation anchors resolve before loading; replies push the thread with that anchor. The thread supports an anchored virtualized row, bounded measurement retries, visible-row reads, and a latest/new-message jump. Thread identity gates prevent a previous destination from authorizing reads/sends after parameter changes. Native conversation reads use viewability, and the opening unread boundary is retained while loading older pages.
- Native conversation/thread workspace selection follows fresh authorized responses once per destination. A small WorkspaceProvider guard prevents initial cohort restoration from superseding an explicit selection in the same commit. The integration test uses the real provider and verifies a subsequent community selection remains selected.
- Email delivery builds canonical conversation URLs with `?message_id=ID` for roots and replies. Notification records and read-clearing paths are unchanged. Existing PR #196 push/navigation helpers remain in use.

## Regression evidence

Temporarily ran the new tests against the original `dc86257` production implementations, then restored every implementation file in a `finally` block. API: 2 expected failures (deleted target incorrectly resolves; reply email lacks anchor). Web: 4 expected failures across anchored thread/root, latest opening, and history arrival behavior. Native search route: 1 expected failure (matched reply ID discarded). This was a controlled local comparison, with no baseline changes committed.

## Affected-flow QA

Executed by the implementation agent. Web used T3 Chromium at 1280×800 and 390×844, isolated Rails API port 3621 and Vite port 5621, database `csg_p6a_message_navigation_dev`. A temporary fixture identity replaced Clerk only in the local harness; Rails authorization, thread/window requests, and read writes were real. Realtime arrivals were injected through the actual screen subscription callback. No real pushes or emails were sent. The harness and local-auth initializer were removed before commit.

- **Passed — exact reply:** one-year-old root, 220 replies, reply 150 outside the latest feed window. Desktop and phone web display it inside the thread. At 390px, reply bounds were y=345.5–393.5 inside pane y=94–645; document width stayed 390px. Initial cursor advanced only to the reply, leaving 70 newer messages unread.
- **Passed — exact root:** historical root opens/highlights without opening the thread. Native screen tests assert root routing and visible-row acknowledgement.
- **Passed — latest opening:** long recent-root window opens at scrollTop 2484, equal to its maximum, despite a saved non-bottom offset. The fix also handles the message response arriving before the workspace shell mounts. Web component tests cover initial scroll events and hidden newer replies; native screen tests cover unread backlogs and loading history back to the retained divider.
- **Passed — reading history:** a simulated new arrival preserves scrollTop 100 and shows “New messages”; the unread divider remains present. Native conversation tests assert no scroll/read call on an arrival while away from the bottom.
- **Passed — unavailable targets:** service/integration and native screen tests cover deleted/inaccessible targets, with no workspace change or cursor advancement. Existing DM authorization tests remain part of the full suite.
- **Passed — workspace/Back contract in components:** observer tests retain Messages beneath pushed destinations. The actual ConversationScreen plus real WorkspaceProvider changes the inbox behind it from A to B only after authorization, persists B, and permits deliberate community selection afterward.
- **Passed — native long thread in screen tests:** 210 replies; matched row index 149; unmeasured-row fallback and retry; highlight; only viewable anchor acknowledged. FlatList is controlled in these tests to expose native layout/viewability callbacks; this does not prove platform virtualization or gestures.
- **Passed — delivery contract in service tests:** message/mention emails contain the named root/reply and preserve stored notification paths. Provider sends are stubbed.
- **Not run — native device:** another session's `Hafa Core QA 18.5 01a13a79` simulator was already booted. Per assignment, no simulator was created, borrowed, or modified. Installed push delivery, physical swipe-back, keyboard behavior, and native list measurement on-device remain for the integration owner. The authorized fallback was component/screen tests.
- **Not run — production/Clerk delivery:** no deployment, migration, production data changes, real email, or push delivery. Universal/app links are outside this slice.

## Gates and integration handoff

Before the final rebase: API full suite 870 tests / 5,177 assertions passed; RuboCop 471 files clean; Brakeman zero warnings (one existing ignore); bundler-audit clean. Web and native complete gates were run with Node 22.22.3; Ruby 3.3.7. Final combined-head gate results and review status are recorded below after rebasing onto the newer main.

Runtime cleanup: the exact owned API/Vite processes and T3 browser tab were stopped/closed. No simulator, Metro, container, or shared resource was started or altered. Only task-created isolated databases are removed at the end. The branch/worktree remain for the lead; no merge is authorized for this worker.
