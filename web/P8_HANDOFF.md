# P8 web implementation handoff

Date: 2026-10-22. Integration owner: parent at `t3-a397a451`, branch `fix/p8-learner-entitlements`. Worker: `t3-26f6fae9`, branch `t3/web-learner-entitlements`. Base: `83f92a70b126694b10986b79cbcd6c8ad5607839` (#198); fetched origin/main matched the base.

## Context and scope

CSG Learn serves Code School of Guam learners and staff. This slice keeps enrollment context, support eligibility, past-course review, and recovery consistent for learners using the web app. Sources: repository `docs/PRODUCT_VISION.md`; Brain-Dump `code-school/_overview.md` (historical context); the parent's audit `WORKER_BRIEF.md`, `PLAN.md`, and `verify-student.md` (S5/S9/S10/N-S3/N-S4/N-S6). Current code and the parent's explicit capability contract take precedence over historical notes.

Only `web/**` changed. No API/native changes, servers, PR, push, or merge. `Messages.tsx` is untouched. Dashboard unenrolled/pending rendering is untouched; its self-paced weekly-plan skip is removed.

## Implementation

- **S5:** Guided help uses `guided_help`. Self-paced `course_question` opens the assigned instructor's course DM through the existing conversation API. `messageComposerState` persists the unsent context before navigation to `/messages/dm/:id?cohort_id=...`; existing draft content remains intact, identical context is not appended twice, and persistence failure leaves a retryable error on the source page. Lesson/exercise/recording links identify the exact selected item. No message is sent automatically. Expired support displays its end date and the established account-support email route. Prior responses stay readable without new-request/cancel controls when support is unavailable.
- **S9:** Explicit capabilities govern learner writes. Missing or cached lesson capabilities fail closed. Past courses display “Past course · review only.” Submission editors, completion/reopening controls, retrieval attempts, and both hosted/external lesson video progress writes are locked while content, feedback, and playback remain available. Recording progress uses verified dashboard capabilities.
- **S10:** Dashboard fetches weekly plans for self-paced enrollment. `self_paced` renders course name, next lesson, access/support dates, the appropriate support action, and redo feedback. Alumni retains `library` rendering. Existing dashboard redo attention remains visible.
- **N-S3:** Lesson/Profile failures have retry controls. Forbidden/not-found, session failures, service failures, and connection failures have distinct copy. Lesson retries retain cohort return links; cached lessons are identified and read-only. Profile retry does not reload notification/block preferences or replace an edited GitHub username.
- **N-S4:** Help matching includes cohort ID, context type, source, and ID. Async history/actions ignore superseded contexts.
- **N-S6:** The recordings-list generation guard already existed at this base (from earlier exact-destination work). New regressions verify late A success/failure cannot replace B; delayed progress responses are also guarded.

`LearnerCapabilities` has the exact supplied fields: `can_submit`, `read_only`, `support_mode`, `support_expires_at`, `access_expires_at`, `support_instructor_id`. Response properties remain optional for older fixtures; absence never authorizes learner writes or instructor support. `WeeklyPlan` adds `mode: 'self_paced'`, `course_name`, and `next_lesson: { lesson_id, title, module_id } | null`.

Resources already renders ZIP downloads without filtering out completed enrollment. The API worker owns the download entitlement change.

## Automated verification

- `npm ci`: passed; no dependency or lockfile changes.
- Supported gate runtime: Node 24.19.0.
- `npm run check`: passed (ESLint, TypeScript, all 553 tests in 93 files, Netlify ignore/routing/service-worker checks, production build, and landing-bundle checks).
- Final focused rerun: 57 tests passed across five files.
- Focused regressions cover capabilities/read-only controls, hosted-video callback suppression, lesson/profile retries and cached state, full help identity and expiry history, assigned-instructor DM draft handoff/preservation/storage failure, self-paced overview/redo, and recordings races.
- Advisory: `IMPECCABLE_NO_TELEMETRY=1 npx impeccable@4.6.0 detect --json` on all eight changed UI files returned `[]` (exit 0). This is static advice, not visual or usability acceptance.
- One full-run failure came from an existing recordings API mock missing the new capability fetch; the fixture was updated. A subsequent production-build failure identified a missing `completed_at` in a new regression fixture; it was corrected.

## Parent runtime acceptance

Execution owner: parent, using its prepared API/web ports 3618/5618 and isolated `csg_p8_learner_entitlements_dev` fixtures. These runtime cases are **not_run by this worker** on desktop and phone web. Mocked DOM tests do not establish API integration, media playback, layout, or saved outcomes.

1. **S5:** Guided lesson/exercise/recording help submits in the exact course/context. Self-paced course questions open the assigned instructor DM with readable context, preserving an existing unsent draft. Support-expired state shows the correct date/account route and readable prior responses.
2. **S9:** Open a completed course with an otherwise-open submission window. Review submitted code and feedback, play hosted and external video, and confirm no submission, completion, retrieval, or progress-write requests occur. Active enrollment remains writable. Verify expired read access separately through API authorization.
3. **S10:** Self-paced Today shows the purchased course, next lesson, access/support dates, and redo links. Alumni still shows Alumni Learning Library. Exercise the first-redo dashboard hero and additional redo rows.
4. **N-S3:** Fail initial lesson/profile loading, retry successfully, and confirm context/preferences survive. Forbidden lesson does not expose content. Cached lesson shows its warning with writes disabled; successful retry restores current capabilities.
5. **N-S4:** Seed matching numeric lesson/exercise IDs plus another cohort/source. Each widget displays and cancels only its own help request, including mixed resolved/open requests.
6. **N-S6:** Delay cohort A recordings, select B, resolve B then A success/failure. Only B remains selected and playing. Confirm a delayed A progress response cannot update B.

Integration follow-up: cherry-pick the worker commit, combine with the API/native work, resolve any Dashboard overlap with #200 while retaining its unenrolled/pending behavior, rerun affected acceptance and the integration gates, and perform the parent's required review/PR workflow. No independent reviewer or production release was requested from this worker.

## Resources and checkout

No task-owned servers, browser tabs, simulators, containers, or databases were started. The lifecycle session is `01a161a0-1f45-75a3-af85-77fd476700a6`; cleanup completed and final status reports no active owned resources. Preserve this committed worktree for the parent's cherry-pick.
