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

### Final combination and review fixes

Rebased onto `909301f42a57e601339f35c8f0b1f82e9f257c57` (P5 #198 and P7 #197). The native conversation conflict preserves P5's `refreshUnreadCaches` on all displayed-message acknowledgements, including the thread screen. No package locks or schema changed in the rebase. Repeated browser checks on `b0df949` passed desktop/390px exact replies, latest at maximum scrollTop 2484, and history arrival preserving scrollTop 100 with the new-message jump.

CodeRabbit on [PR #201](https://github.com/Shimizu-Technology/csg-learning-platform/pull/201) reported a review quota limit (33 minutes), despite a success-labelled status. It did not complete a code review. Main has no branch-protection requirement for that review. The shared PR workflow's advisory-unavailable fallback was used: an independent GPT-6.1-Sol reviewer inspected the production diff and surrounding code in two read-only rounds.

Round 1 found a P2 acceptance gap: web's unread divider retained the first fetched window's boundary when loading older history. It also identified native's existing optimistic unread clearing before viewability. Both were fixed at `eab1475b6bae7b10c1382427ba3cc97529fce0da`. Web preserves the opening read cutoff and shifts the divider into newly loaded earlier history. Native keeps server unread counts until displayed-message acknowledgement and ties workspace authorization to the current destination identity. Added tests cover these cases. Round 2 confirmed the fixes and reported **no material residual findings**. It created no files or runtime resources.

Final source validation at `eab1475`:

- API (unchanged after `b0df949`): **884 tests / 5,300 assertions**, zero failures/errors/skips; RuboCop **473 files**, no offenses; Brakeman **zero warnings**, one existing ignore; bundler-audit clean.
- Web: complete `npm run check`, **94 suites / 538 tests**, lint, types, service-worker/Netlify checks, production build, and bundle check passed.
- Native: complete `npm run check`, **103 suites / 697 tests**, brand, types, lint passed (22 existing warnings, zero errors).
- Impeccable advisory returned no findings. Dependency manifests and locks are unchanged; no Expo dependency-install check was needed.
- Review-fix browser QA at 1280×800 rendered actual Messages with controlled local API fixtures. Initial cutoff 50 / latest roots 160–201 opened at latest, with divider at 160. Clicking “Load earlier messages” loaded 49–159 and moved the divider to **51** (153 rendered rows total), retaining the original cutoff even after a read acknowledgement. This final targeted phase used a temporary Vite fixture harness; no API server or database was needed.

All temporary harness/auth files were removed. Lifecycle session `01a16190-d817-7fc0-a5f3-502f0230a6a2` has no active owned resources. Task-created databases `api_test_p6a_message_navigation`, `_0`, `_1`, and `csg_p6a_message_navigation_dev` were dropped. Existing simulators and shared services remain untouched. Only the assigned branch/worktree and open PR are retained.

Integration owner next step: inspect the final PR head/checks, acknowledge CodeRabbit's actual rate-limited status and the independent fallback, then decide merge/build delivery. The worker has not merged or deployed. Native installed-push/gesture/keyboard/platform-virtualization acceptance remains unrun under the assignment's screen-test fallback. Final documentation-only commits do not change the tested source.
