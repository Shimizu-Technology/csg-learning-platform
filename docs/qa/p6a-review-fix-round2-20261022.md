# PR #201 — review-fix round 2, 2026-10-22

PR: https://github.com/Shimizu-Technology/csg-learning-platform/pull/201

Worktree: `/Users/leonshimizu/.t3/worktrees/csg-learning-platform/t3-ecdfabd0`.

Scope: the four material findings supplied against `5435064`, on `fix/p6a-message-navigation`. The assigned worktree was clean at that head. Rebased onto `origin/main` `f669c39` (including #200 and #202) without conflicts before implementation. Only this assigned worktree was edited. No merge, deployment, or CodeRabbit request is authorized for this worker.

## Context and acceptance

CSG Learn connects Code School of Guam students and staff across web and native clients. Sources: `docs/PRODUCT_VISION.md`, `AGENTS.md`, the integration owner's `audit/WORKER_BRIEF.md`, `audit/PLAN.md`, and `audit/verify-comms.md`. Ordinary opens must reach latest; exact links must reach the named reply. Paging must preserve a contiguous authorized window and the visible reading position. Arrivals outside a historical window must remain behind an explicit latest action. Read cursors must never advance to an unloaded arrival.

The agent executed affected-flow acceptance against isolated fixtures. Required browser dimensions: desktop 1280×800 and phone web 390×844. Installed native/device/keyboard/push acceptance is not run; this worker's brief prohibits simulator use. Native screen and transport tests are separate evidence, not a device pass.

## Findings

1. **Fixed — ordinary native transport.** `CsgApi.messageThread` uses the existing query-string helper, omitting undefined/null values. The API normalizes blank, whitespace, `undefined`, and `null` anchors to no anchor. Missing/deleted/inaccessible explicitly named messages retain their existing unavailable response.
2. **Fixed — paging and follow.** Native threads distinguish a loaded window's bottom from the actual latest reply using `has_newer`. Paging cancels following and pending positioning, uses FlatList's visible-content preservation, and does not arm following from programmatic scroll events. Keyboard/layout following still works at latest. Web paging also relinquishes following and preserves the prior scroll position.
3. **Fixed — deleted cursor boundary.** Before/after cursors resolve against the same authorized thread or conversation scope, including soft-deleted rows for their timestamp/ID only. Returned messages still exclude deleted rows. Rails request regressions exercise equal-timestamp thread boundaries and both channel and DM windows.
4. **Fixed — historical live arrivals.** Web/native threads and conversations hold unseen arrivals outside historical windows behind a counted latest action. Loaded updates/deletions still apply, repeated events do not inflate counts, and explicit latest requests replace the old window. Confirmed own sends also stay outside historical windows. Runtime QA additionally exposed web focus/poll refresh merging the latest feed into historical replies; background refresh now preserves historical windows, including an in-flight response check. A focus-refresh regression covers this path.

## Regression and transport evidence

- Guarded pre-fix checks restored production files from the rebased head temporarily, then restored the working implementation in `finally`. All three new Rails request cases failed against old code: a 404 for the serialized anchor and disconnected latest pages for deleted thread/conversation boundaries. Both web historical-arrival cases and all three selected native transport/history cases also failed before the fixes.
- Committed Rails tests use real requests, authorization, database rows, cursor queries, and paging metadata. Native API tests inspect the actual fetch URL; screen tests independently exercise viewability, layout, paging and queued arrivals.
- An additional runtime check bundled the actual native `CsgApi` with stubs only for unused Expo upload imports and called the isolated Rails server over HTTP. Ordinary open sent `/messages/1/thread?message_limit=80`, with no undefined parameter. Around 302 returned 262–341; older-before-262 returned 182–261. After soft-deleting boundary 341 through the API, newer-after-341 returned 342–421 with `has_newer=true`. Legacy `around_message_id=undefined` returned 200. No mocked message loader or paging response was used in this check.
- Local transport output: `/tmp/p6a-round2-live-transport-current.log`; pre-fix logs: `/tmp/p6a-round2-before-{api,web,mobile}-current.log`.

## Browser acceptance

Environment: actual Messages component and API client, Rails authorization, real HTTP reads/writes and ActionCable delivery; isolated DB `csg_p6a_message_navigation_dev`, API 3621 and web 5621. Temporary harnesses supplied fixture identity instead of Clerk and disabled provider jobs. No real email, push, or storage delivery occurred. Seed: a year-old root, 600 replies and 120 recent roots. One reply was deliberately soft-deleted and live fixture replies were added. The temporary harnesses are excluded from the implementation.

| Required scenario | Desktop | 390px web | Observable and saved evidence |
| --- | --- | --- | --- |
| Ordinary thread open | passed | passed | Open root 1, then its replies action without a reply anchor. Latest reply visible in an 80-reply window plus root. Final desktop scroll 2077/max 2077; phone 3793/max 3793. |
| Exact anchored reply | passed | passed | Reply 302 visible within its own pane, 81 rows including root. Desktop row y=325–352 in pane y=165–512; phone y=345.5–393.5 in pane y=94–645. Initial isolated cursor 302. |
| Earlier/newer paging, including deleted boundary | passed | passed | Earlier page contains reply 182. Desktop newer-after-deleted-341 renders 342–421, retaining scrollTop 2128 and row 340 y=306. Phone newer-after-342 renders through 422 while scrollTop stays 3791 and row 342 stays y=453. The saved phone cursor remains 342 rather than 422 or a queued arrival. |
| Live arrival during history, focus refresh, explicit latest | passed | passed | A real incoming Cable reply is absent from the rows, shows `New replies (1)`, and does not move the pane/cursor. Focus refresh preserves that window. Phone jump replaces history with 80 latest replies, shows reply 725, clears the badge, and advances the persisted cursor to 725 after display. Desktop final arrival 726 remains queued through focus at scrollTop 1083; ordinary reopen then displays 726. |

The phone document and viewport both remain 390 CSS pixels wide. Browser resizing does not prove physical touch or installed native behavior. T3 preview briefly disconnected and Chrome's injected browser helper also timed out; native Chrome controls and a recovered T3 preview completed the checks. The fallback QA tab was closed by its exact URL through Chrome Tab Search; no matching open tab remained, and the temporary viewport override was reset.

Local screenshots, visually inspected:

- Phone latest: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvj3av1j-ecf55265.png`
- Desktop latest: `/Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mvj3grha-69e190e0.png`

## Gates and handoff

The results below cover implementation commit `e23d1bb4a4a20344106903cb716d2c343f3a89f1`; the follow-up changes only this validation/handoff record. Keep the PR held for the integration owner; reviewer status is not represented as a fresh clean review. API deployment must precede clients using the destination/window contract. This round adds no migration or dependency change.

Final gate results (Ruby 3.3.7, Node 22.22.3):

- **Web passed:** `npm ci` and full `npm run check`: 104 suites / 630 tests, lint, typecheck, Netlify/service-worker checks, production build, and bundle check. The long 80-row navigation fixture and the multi-stage historical-window cases use a 15-second per-test budget after shared-machine runs exceeded Vitest's default five seconds. No assertion was removed. Impeccable advisory returned `[]`.
- **API ran with one timing failure, then the affected class passed:** full isolated suite: 943 tests / 5,771 assertions, one failure and no errors/skips. The unchanged delivery-concurrency case `deletion waits for an active broadcast critical section` exceeded its five-second join. Rerunning its entire class with one worker and session-local `synchronous_commit=off` passed 6 tests / 43 assertions. This was not a clean initial full-suite run. Final RuboCop: 480 files, no offenses. Brakeman: zero errors/warnings, one existing ignore. Bundler-audit: no vulnerabilities.
- **Native gate remains blocked outside this slice:** `npm ci`, brand assets, typecheck and lint passed (22 existing warnings, zero errors). Final full suite: 107 suites passed / 1 failed; 746 tests passed / 1 failed out of 747. The unchanged `native-learning-nav.test.tsx` Student Health partial-failure retry case remains visible after retry. It fails in isolation and also fails when all modified native production files are temporarily restored to their pre-fix versions; the working implementation was restored byte-for-byte afterward. No Student Health code/test was changed in this messaging slice. The 18 messaging screen tests and 26 API transport tests pass, including the additional own-send history case.

The native gate failure is a remaining integration blocker, not a claimed clean gate. The integration owner should handle the existing Student Health retry case separately and inspect current CI/review before any merge. `origin/main` advanced to `7ba243e` (#203) after the requested initial rebase; this tested work remains based on the requested `f669c39`. The PR was mergeable when inspected before the force-with-lease push.

QA runtime resources were cleaned through lifecycle session `01a161ee-440d-7563-9069-9db317145666`: exact API/web processes on 3621/5621 and all three task-created browser tabs. Chrome's temporary viewport override was reset. Final lifecycle status reports no active owned resources. Temporary harness files were removed. Shared/protected services and the borrowed simulator were left unchanged. All 12 task-created databases were dropped after the test processes exited: the isolated development DB, the test DB, and test copies `_0` through `_9`. A final catalog query found no matching task databases. The assigned branch/worktree remain for the integration owner.
