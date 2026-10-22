# PR #209 review fixes — October 23, 2026

Worktree `t3-8fa48416`, branch `fix/qa-a-fixes`; starting head `ee3606d`, base `origin/main` `0f13a9c`. Fetch/rebase found no drift. The integration owner merges; this worker must leave the PR open.

CSG Learn keeps learning evidence scoped to each enrollment. Learners use phones heavily; staff need safe restart/recovery controls. Sources: the common audit `WORKER_BRIEF.md` / `PLAN.md`, current code and project vision, Brain-Dump `code-school/csg-learning-platform-plan.md` (historical orientation), and the lead's four review findings. This affected-flow round covers restart conflict/concurrency, offline native lesson writes and video overview refreshes. Acceptance is agent-executed; no simulator is authorized.

| Item | Result and regression |
| --- | --- |
| 1. Same-course conflicts | Active and paused enrollments block, including expired active records. Copy names the learner, cohort and status and directs staff to complete/remove the conflict. Completed/dropped histories retain their evidence and permit restart. API integration tests cover each status and the audit/recovery snapshot. |
| 2. Native lesson failure | LessonScreen propagates query failure and expo-network disconnection into the common submission/completion/retrieval/video guard. Offline copy is “Offline — reconnect to submit”; online cohort validation uses its own message. The real screen/card test loads online, edits a draft/selects an answer, disconnects, fails refresh, checks all controls and draft storage, reconnects, checks writes remain paused until successful refetch, then verifies restored controls and draft. |
| 3. Concurrent restart | Staff progress exposes `restart_version` from the reset timestamp at microsecond precision. Access sends the observed token, including explicit null before the first restart. The service compares it under the student/enrollment locks; missing/stale requests get 409. Access preserves the error in a toast while refreshing. Two HTTP requests blocked behind one held row lock produce exactly one 201, one 409, one audit, one active plan and one intervention. A fresh token permits a later deliberate restart. |
| 4. Video heartbeats | Every save updates the lesson cache; only status/completion transitions invalidate overviews. Overview requests run outside the player's save queue. Repeated in-progress and completed heartbeat tests assert no invalidation; transitions still refresh all learner variants. |

CodeRabbit's other small findings were handled: the redo hint recommends feedback and explains confirmation, cohort stale/loading/error guards are tested independently, and Student Health asserts the rendered zero redo count. Its expired-active suggestion conflicts with the current explicit rule; the added test asserts that it blocks while preserving evidence.

Failing-before evidence is retained under untracked `.codex/`: paused conflict and old copy, missing/stale version, concurrent requests returning `[201, 201]`, Access omitting the token/not refreshing after 409, native saved-lesson failure without paused writes, and repeated heartbeat invalidation. Fixture/mock setup errors were corrected before behavioral failures were recorded.

| Runtime case | 1280×844 | 390×844 | Saved outcome |
| --- | --- | --- | --- |
| Active conflict | passed | passed | No restart created |
| Paused conflict | passed | passed | No restart created |
| Completed history permits restart | passed | passed | History retained, one audit/active recovery plan |
| Stale second Access tab | passed | passed | 409 shown, enrollment refreshed, post-restart submission retained, no second restart |

Browser evidence: `.codex/review-qa/results.json`, `saved-{width}.json`, screenshots/text, fixture manifest and runner. These checks use synthetic fixtures, a local Clerk adapter, the real React shell and Rails authorization/persistence on isolated ports 3631/5631. External requests are blocked. T3 snapshots failed twice with `Preview automation snapshot timed out after 15000ms.`; isolated Playwright ran the checks afterward. No production identity, storage, email or payment delivery is certified. Native runtime/device acceptance is **not_run**, per the no-simulator constraint; Jest mocks the platform, storage and API boundaries.

Full local gates pass under Ruby 3.3.7 and Node 22.22.3:

- API: RuboCop 481 files, no offenses; Brakeman 0 warnings (1 existing ignored); bundler-audit clean; 987 tests / 6,206 assertions, no failures/errors/skips. Dedicated `api_test_qa_a_fixes`, 2 workers.
- Web: `npm ci` and full `npm run check`, 115 suites / 767 tests, lint/types, Netlify/service-worker, build and bundle checks pass.
- Mobile: `npm ci` and full `npm run check`, 113 suites / 838 tests, brand/types/lint pass. Lint retains 24 existing warnings, 0 errors.

The exact pushed head and log paths are recorded in the untracked review handoff. Dependencies are unchanged, so no Expo dependency check is required. Advisory Impeccable returns `[]`; diff whitespace checks pass. The original QA document retains its earlier evidence and is superseded by this round for changed paths.

No migration or dependency change is needed. Deploy the API response/guard with the web sender; a cached old sender receives a safe 409 and needs a reload. This round does not request CodeRabbit or merge. The handoff records review replies, current checks and exact resource/database cleanup.
