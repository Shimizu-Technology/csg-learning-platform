# P11 native teaching operations

Implementation worker handoff, 2026-10-22. Base: `f669c39049cc74979f78e261897d62cd936e71bc`; branch: `t3/native-recording-activity`. Only `mobile/` changed. The parent owns API/web integration, PR/review, combined QA, and release. No push, PR, server, simulator, or further delegation was performed.

Context and acceptance come from the parent's `audit/WORKER_BRIEF.md`, `PLAN.md`, and `verify-staff.md` (N-T7 and T8) beside `/Users/leonshimizu/.claude/projects/-Users-leonshimizu-Desktop-ShimizuTechnology-csg-class-csg-learning-platform/e2dd1685-7507-47a2-b2aa-110cee933c2f/audit/WORKER_BRIEF.md`. Repository evidence was refreshed against the base: recordings already expose draft status and authorize PATCH by cohort; activity was still a personal history endpoint. This work serves staff teaching assigned cohorts and learners reviewing published class recordings.

## Behavior and integration contract

- N-T7: upload/link keep `publish_immediately=false` by default. Their success action opens the exact recording and cohort for review. Lists/details show Draft or Published, including Published for legacy links that have no draft state.
- Staff draft detail checks the API's staff-scoped cohort list before offering publication. `PATCH /api/v1/cohorts/:cohort_id/recordings/:id` sends only `{status:'published'}`. Only a confirmed published response updates recording caches; a rejected save leaves the displayed draft and allows retry. The server remains the final authorization boundary.
- Cohort home now offers one Schedule action using the authenticated `/admin/cohorts/:id?tab=schedule` handoff for public sessions and private meetings. Administrative learning schedule/releases is shown only to admins with the projected permission. The native draft review/publish flow does not need a web recording-manager handoff; the parent's teacher-accessible fallback is `/admin/cohorts/:id?tab=recordings`.
- T8: staff cohort home offers Cohort activity. The shared activity screen sends `feed=cohort&cohort_id=X`; learner filtering adds `user_id`, category adds `category`, pagination adds `before_id`. Parent API must honor these together. Native school feed is deliberately unavailable; the API type accepts `'cohort' | 'school'` as requested.
- The event type accepts optional `subject_user: {id,name,role}` and response `recorded_since`. Optional fields preserve compatibility with the personal feed. Learner links open `/staff/student/:id?cohort_id=X`; submission, lesson, and recording destinations reuse the exact existing activity destination mapper. Cohort home has a separate link. Unavailable records have no record action.
- Learner/category filters run through the API. Last 7/30 days filter loaded pages locally; if matching rows are absent while another page exists, the screen explicitly invites loading earlier history. Filter selections are stored in route params; the mounted stack and query cache retain pagination when navigating away/back. Changing cohort scope resets filters and uses a separate cache key. No extra server time-filter contract is assumed.
- All added UI uses adaptive theme tokens and controls at least 44px high. Dependency manifests and locks are unchanged.

## Verification

Agent-executed checks use mocked native rendering and API responses, not a running native build.

- Focused regression command: `npm test -- --watchman=false teaching-ops-screens api.test recording-upload destination-screens` — 4 suites / 64 tests passed before the final fixture cleanup. The full gate below includes the cleaned fixtures.
- `npm run check` — passed, 108 suites / 744 tests, with brand/type/lint passing (22 existing lint warnings, zero errors). This run preceded the final parent-requested Schedule handoff/admin-link follow-up. Final-tree focused navigation/teaching-operations tests and TypeScript/changed-file lint are recorded below; parent will run the combined full gate after cherry-pick.
- Final-tree focused command: `npm test -- --watchman=false teaching-ops-screens native-learning-nav` — 2 suites / 24 tests passed, including the combined Schedule handoff and instructor/admin controls.
- Final-tree `npm run typecheck` and ESLint on the follow-up cohort screen/teaching-operations test file — passed (exit 0).
- Existing navigation fixtures now mock `setParams`; two asynchronous settlement assertions allow up to five seconds after a full-run timing failure and a passing isolated rerun. Their expected outcomes are unchanged.
- Advisory `impeccable@4.6.0 detect --json` on all changed UI files — `[]` (exit 0).
- `git diff --check` — passed.
- `npm ci` completed without dependency edits. Initial install used local Node 22.0.0 and emitted engine warnings; validation uses installed Node 22.22.3.

## Native acceptance still owned by parent

All following runtime scenarios are **not_run**, per the explicit no-server/no-simulator worker assignment. Passing component tests does not establish these saved outcomes:

1. Assigned instructor/admin: upload and link save privately, open exact draft, review playback, publish, then confirm learner visibility.
2. Wrong-cohort instructor denied by real API; rejected publication retains the draft and supports retry.
3. Staff cohort home → combined Schedule (public sessions and private meetings); instructor lacks administrative release/settings actions. Staff cohort home → activity with multiple learners; category/learner/time filters, earlier pages, exact submission/lesson/recording/student/cohort navigation, and back preserving filters/cursor/scroll.
4. Personal history unchanged; student/unauthorized cohort feed denied; inaccessible/deleted record recovery; adaptive light/dark and device layout.

No runtime resources were started. Lifecycle session `01a161e7-2030-7b13-b242-26c715dc5fa7` had no owned resources at baseline. Cleanup ran and status reported no active owned resources.

Parent integration review: unknown publish outcomes now reconcile the exact cohort recording. A lost response that already published updates the detail; an unconfirmed outcome offers a status check before another write. Confirmed HTTP rejection retains the private draft. Component regressions cover both paths; final combined checks are recorded in `docs/qa/p11-cohort-workspace-20261022.md`.
