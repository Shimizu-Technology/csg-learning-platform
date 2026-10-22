# PR #201 — review-fix round 3, 2026-10-22

PR: https://github.com/Shimizu-Technology/csg-learning-platform/pull/201

Worktree: `/Users/leonshimizu/.t3/worktrees/csg-learning-platform/t3-ecdfabd0`.
Branch: `fix/p6a-message-navigation`.
Implementation: `0678f0fa4e6db03ee49096c18070e2c1d9da23de`.
Base: `origin/main` at `7ba243e97e9f8616def164cc3d56534abb8b6292`.

The assigned worktree was clean at `09da3a9`; the rebase completed without conflicts before changes. The post-reboot audit found no task-owned server to clean. Only this worktree was edited. The lead owns integration and merge. No merge, deployment, or CodeRabbit request was made by this worker.

## Context and acceptance

CSG Learn serves Code School of Guam students and staff on web and native clients. Sources: `docs/PRODUCT_VISION.md`, the common `audit/WORKER_BRIEF.md`, `audit/PLAN.md`, `audit/verify-comms.md`, Brain Dump `code-school/csg-learning-platform-plan.md`, and the previous round's QA ledger. This round refreshes their messaging context: a loaded window must stay contiguous, notices must survive a REST/Cable race, and read cursors must only acknowledge displayed loaded content. Installed clients that make bare thread requests must still receive every visible reply.

Acceptance is affected-flow, agent-executed. Required cases: delayed latest responses on web threads (desktop and phone layout), native threads, and native conversations; read progression before/after closing the gap; explicit transport opt-in for updated clients; frozen bare-request compatibility. Native device testing remains with the lead because the common brief excludes simulator use by this worker.

## Findings and implementation

1. **Fixed — latest responses discarded unseen arrivals.** All three surfaces now reconcile queued IDs against the response's newest ID. Arrivals beyond that boundary retain their counted latest action. A later Cable event joins the queue, rather than creating a disconnected loaded window. Returned rows remove their queue entries; a latest replacement retires older entries covered by its boundary. Following remains disabled while unseen entries remain. Native conversations retain their jump control and count after the response as well.
2. **Fixed — installed-native thread compatibility.** Bare `GET /api/v1/messages/:id/thread` returns the full visible chronological reply collection, including when `:id` names a reply. Windowing is opt-in through `window`, `message_limit`, `around_message_id`, `before_message_id`, or `after_message_id`. Updated web/native API clients always send `window=1`; undefined anchors are omitted. API documentation describes both contracts. The frozen old-client request test uses no window parameters and no follow-up page, checks all 204 visible replies of a 205-reply fixture, excludes the deleted reply, and verifies unchanged read state.

No dependency or migration change. API deployment must precede clients depending on the new window/destination contract; old installed clients retain their bare-request behavior.

## Regression evidence

Before implementation, the new deferred-response tests failed on both web layouts and both native screens because the latest badge disappeared after resolving the response through 600. The frozen old-client test failed because it received only the newest 100 replies. Logs: `/tmp/p6a-r3-{web,mobile,api}-before.log`.

The committed regressions start in history, queue 599, request latest, deliver 600 and duplicate 601 Cable events before resolving the request through 600, then deliver 602 afterward. They verify that 601 remains counted once, 602 remains unloaded/counts twice, and a loaded 600 can be acknowledged without advancing beyond it. A second latest response containing 600–602 loads both missing rows and permits acknowledging 602. Native transport and web fetch tests verify explicit window opt-in, including the no-options call.

Focused suites passed: messaging API 59 tests / 298 assertions; web navigation/API 27 tests; native screens/API transport 47 tests. After strengthening the explicit read-cursor assertions, the four deferred-response cases passed again, followed by the complete web/native gates on the committed implementation.

## Browser acceptance

Actual Messages component, API client, layout, scroll handlers, and button interactions ran in Chrome. A temporary Vite harness supplied fixture identity, deterministic fetch responses, and Cable subscription callbacks. This verifies rendered interaction with the race, not real HTTP persistence, ActionCable transport, Clerk, provider delivery, or physical touch. Rails request tests separately cover authorization and the full/windowed response contracts. No real messages, email, push, or storage delivery occurred.

T3 preview opened but snapshot failed twice with `Preview automation snapshot timed out after 15000ms.` Chrome completed the checks. CSS dimensions were measured from the document; temporary viewport overrides were reset afterward.

| Scenario | Desktop 1280×800 | Phone web 390×844 | Evidence |
| --- | --- | --- | --- |
| REST through 600 resolves after Cable 601 | passed | passed | Loaded rows end at 600; counted latest action remains. |
| Cable 602 arrives after that response | passed | passed | Rows remain root + 599 + 600; `New replies (2)` stays visible. |
| Explicit latest closes the gap | passed | passed | Rows become root + 600 + 601 + 602; counted action clears. |
| Persisted read cursor over real HTTP | not run | not run | This round's browser harness controls transport; read arguments are verified in screen regressions. |
| Installed native/device interaction | not run | not run | No simulator/device was used; native screen/transport tests are separate evidence. |

## Gates

Ruby 3.3.7; Node 22.22.3. Both JavaScript apps ran `npm ci` successfully.

- API: full isolated suite **passed**, 947 tests / 5,800 assertions, no failures/errors/skips. `DATABASE_URL=postgresql:///api_test_p6a_message_navigation`, `PARALLEL_WORKERS=1`; no shared database was used. RuboCop: 480 files, no offenses. Brakeman: zero errors/warnings, one existing ignore. Bundler-audit: no vulnerabilities.
- Web: full `npm run check` **passed**, including lint, typecheck, unit tests, Netlify/service-worker checks, production build, and bundle check. 105 suites / 637 tests.
- Native: full check components **passed** (`brand:check`, typecheck, lint, `npm test -- --testTimeout=30000`). 108 suites / 778 tests. Lint reports 24 warnings outside this slice and zero errors. The previously flaky Student Health case passed; no change was made to it.
- Impeccable advisory on the three changed screens: `[]`. `git diff --check` passed.

Local logs: `/tmp/p6a-r3-api-full.log`, `/tmp/p6a-r3-{rubocop,brakeman,audit}.log`, `/tmp/p6a-r3-web-final-full.log`, `/tmp/p6a-r3-mobile-final-full.log`, and `/tmp/p6a-r3-impeccable.log`.

## Integration handoff and cleanup

The implementation is ready for the lead's next review round; this is not a fresh reviewer approval or permission to merge. Inspect the pushed PR head, CI, and review coverage before integration. This document supersedes round 2's gate status for this rebased implementation; earlier runtime evidence remains historical.

Lifecycle session `01a1635c-bc3e-7193-a393-946e602f52f1`: exact Vite PID 5924 on 5621 and both owned browser tabs were cleaned. Chrome viewport override was reset; temporary harness files were removed. The only created database, `api_test_p6a_message_navigation`, was dropped after API tests exited. Catalog verification found no matching task databases. Lifecycle status reports no active owned resources. Borrowed simulator, shared services, and other sessions' resources were left unchanged. The branch and assigned worktree are retained for the lead.

Start by verifying the branch/head and this ledger, then review the 12-file implementation commit against the rebased parent `7960212`. No production release or installed-native acceptance is claimed.
