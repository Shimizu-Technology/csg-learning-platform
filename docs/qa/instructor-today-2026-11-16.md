# W7 PR 7.2 — Instructor Today

Implementation source: `ae07ee49`, based on `a6a0c530` (#272). QA executed by the implementation agent on the Mac mini, November 16, 2026. Synthetic QA-harness data only; no production access. Documentation-only commits after this source do not change the tested application.

## Context and acceptance

CSG Learn serves students, instructors assigned to specific cohorts, and school admins. This change addresses instructors' daily triage: see the next actionable item immediately, open the right existing workflow, and return to the same scope. Sources: redesign README §§1–4, approved `04-instructor-today.html`, #272's `AttentionProjection`, `LearnerProgress`, `LearnerActivity`, and current dashboard/attention components.

Acceptance: deterministic help → oldest pending work → unread conversations → quiet ordering; source message text; cohort permission and feature checks; explicit page-local cohort scope; independent record links and action buttons; compact phone layout; saved action outcomes; additive API compatibility. Existing backend inactivity qualification remains authoritative. No new behind/status rule, migration, session-level SQL setting, worker, or Puma configuration was introduced.

## Decisions

- Extend `GET /api/v1/dashboard` with `today`, rather than introduce a second staff endpoint or break installed clients. Legacy payload fields remain available.
- Counts filter this same ranked inbox using `kind`, retaining `cohort_id`. Each count therefore leads to exactly the rows counted. Zero categories disappear. Access & invitations opens Students' existing `never-signed-in` filter, retaining cohort scope.
- The upcoming strip follows the inbox so events cannot push the first phone action below the fold. Office hours (including live-class occurrences) use the existing recurrence expansion; confirmed meetings are today's bookings, scoped to the instructor or all for admins.
- Replies, grading and messages open existing detail workflows. Quiet's Message creates/opens the cohort conversation through the existing endpoint. Names use `RecordLink` and its desktop peek behavior; staff message authors remain plain text rather than link to nonexistent learner records.
- Today shows each quiet reason once, without repeating unfinished step counts. The former attention/active-enrollment metric duplication and activity section duplication are absent.
- Expo reads the same ranked payload and native action paths. Cached/older responses without `today` retain the legacy view. Native physical-device acceptance remains separate from Jest.

## Automated verification

- API: full suite with `OPENAPI_COVERAGE=1`, `PARALLEL_WORKERS=1`, `PGGSSENCMODE=disable`, isolated `csg_instructor_today_test` database. Final result recorded below.
- RuboCop: clean. Brakeman: no warnings.
- Web: Node 22.23.5; typecheck, ESLint, Vitest (192 files, 2,268 tests), build, `test:bundle`, `test:netlify`, `api:check` passed. Impeccable advisory scan: `[]`.
- Mobile: Node 22.23.5; typecheck and Jest (136 suites, 1,381 tests) passed.
- Added regressions cover ranking/age stability, help text, exact actions, unrelated instructor exclusion, admin access, explicit allowed/forbidden cohort scope, school/cohort feature removal, upcoming office hours, read cursor and resolved help removal, staff DMs without learner links, web category filters/return scope, and native action paths. On main the new Today assertions fail because the payload/component does not exist. Existing QueryCounter growth test now explicitly requires Today rows.

## Query count and timing

The dashboard endpoint includes the full existing attention/progress projection and the additive inbox. QueryCounter clears the query cache and counts logical reads (including cache hits).

| Fixture growth | Enrollments / cohorts | Logical queries | Local measured time |
| --- | --- | --- | --- |
| 1 fixture set | 3 / 2 | 37 | 20 ms |
| 15 fixture sets | 31 / 16 | 37 | 84 ms |

The existing 1→5 fixture test also measured 37→37. Growth includes assignments, lessons, submissions, help requests, unread conversations and cohorts, not just repeated rows. At 15 sets the inbox has at least 15 entries. The shared projection was not a local CPU bottleneck, so its qualification logic was preserved. The dashboard's per-cohort feature lookups now reuse the school feature map to avoid per-cohort queries.

With `TODAY_LATENCY=1`, the optional test requests a 10 ms sleep per uncached logical query, excluding schema/transaction events: 35 delayed reads at both sizes, 2.144 s → 2.347 s. These are observed wall times, **not** a claim of 10 ms network RTT: a standalone 35×10 ms Ruby sleep control on this Mac took 2.043 s (timer coalescing). This verifies flat round trips under injected delay but cannot predict Neon/PgBouncer production timing. No production probe was run.

## Browser acceptance ledger

Shared T3 browser, local QA Rails/Vite harness, Chromium at 1280×844 and 390×844. Light and dark were explicitly applied and checked for each role and width (8 combinations). These are browser dimensions, not Safari or an installed native build.

| Scenario | Result and evidence |
| --- | --- |
| Phone action is visible immediately | Passed all role/theme combinations. Admin first row y=336, first action ends y=412; instructor first row y=388, action ends y=464. Initial help Reply button at y=430–474. No horizontal document overflow. |
| Independent student/cohort links | Passed. Admin opened `/admin/cohorts/2/students/6/overview` and `/admin/cohorts/2`, both showed the correct record and Back to Today. Action links separately opened submission/help records with encoded `return_to`. |
| Count destinations | Passed. Waiting for review chip set `kind=review` and rendered only review rows. Cohort scope persisted in links; Access & invitations targeted `/admin/students?filter=never-signed-in&cohort_id=1`. |
| Explicit scope and empty state | Passed. After completing Program work/help and reading its DM, `cohort_id=1` visibly said Showing: QA Program and You're caught up with the next suggestion. Other cohort work remained in All cohorts. |
| Help response saves | Passed as instructor at 390 dark. Reply → Respond & resolve → synthetic response → Send response and resolve. Record showed Resolved, saved response, owner QA Instructor, and disappeared from Today. |
| Grading saves | Passed as instructor at 390 dark. Grade submission 3 → rubric Meets → B. Record showed B; review count dropped from 2 to 1 on Today. Admin at 1280 dark also graded submission 6 with Meets and B; record showed B. |
| Unread conversation | Passed. Open message opened DM 1 and showed source text; a synthetic reply sent with Enter appeared in the conversation. The unread row disappeared from Today. |
| Quiet student Message | Passed. Isolated fixture activity timestamps were aged 12 days and enrollment start 20 days; shared projection then supplied quiet. Message opened a new exact conversation with QA Behind in QA Program; synthetic check-in sent and appeared. |

No real provider delivery, Clerk authentication, native keyboard/gestures, physical devices, Safari/WebKit or production deployment was tested. WebKit cannot launch under this Mac mini account. Scheduled meetings' full booking/join journey and every action in every theme/role combination were not independently repeated; recurrence/feature behavior has API coverage. Remaining follow-up: native device acceptance and production latency observation after release. No merge or PR watching was requested.

## Cleanup and final results

Final source `ae07ee49`: API 1,715 tests / 39,309 assertions passed, zero failures/errors/skips. OpenAPI coverage enabled. Final Web `check` and API type check passed; final mobile typecheck and Jest passed. RuboCop inspected 656 files with no offenses; Brakeman reported no warnings. The desktop learner peek was opened with keyboard focus: QA Behind, 0/18 lessons, zero waiting work/help and Going quiet; Escape closed it.

Closed task browser tab `tab_2u_89c280d8-30cd-43c8-87b2-8d384475a23b`. QA harness cleaned exact API PID 64490 and Vite PID 64493, and dropped `csg_qa_64477_1794812052`. Dropped `csg_instructor_today_test`. Lifecycle session `manual-20261116-165008-62671-c7f3` verified no remaining owned resources. Shared PostgreSQL and other baseline services were left running. Branch and checkout retained for the open PR; no runtime handoff.
