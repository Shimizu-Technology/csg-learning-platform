# First run, empty states and recovery — W8 PR 8.4

Implementation branch `feat/first-run-states`, based on `main` at `c290e00a`.
Latest evidence: [review fix round](#review-fix-round). Original acceptance follows.
Agent-executed browser QA on Leon's MacBook. The final full gate passed on the
ASUS through `asus-test --postgres csg_learning_platform_test <repo-root> -- bash
scripts/qa/first-run-states-gate.sh`, after the MacBook returned to home Wi-Fi.
The wrapper keeps the existing migration subprocess port adapter at 55432 and
runs both API prepared-statement modes. Earlier local checks are recorded below.

Final runtime source: `242b0de3`, including `origin/main` `670dc8eb` (#290).
The final browser matrix runs this combined source, including a one-letter
module name to verify both target dimensions. [Runtime source hashes](first-run-states-2026-11-18/source-sha256.json).

## Product brief and acceptance

CSG Learn serves program students, self-paced purchasers, paused learners and
alumni. Today should give a new learner one clear starting point, then preserve
their course and return context as they navigate. A library is for browsing,
not a course completion target. Students see only their own learning and
reachable instructors; paused learners retain past material and feedback.

Sources: approved redesign README (all sections, especially §§1, 3, 5, 6 and 12),
`10-first-run.html`, audit U-5.4/U-5.8–11/S-15/L-1.5/L-1.9/L-1.11 in Brain Dump,
merged #293, #294 and #295, and the current `LearnerProgress`, `StudentToday`,
`EnrollmentCapabilities`, `StaffContact` and recording/resource read rules.

Required acceptance:

- Only explicit resolved `student_experience_v2: true` renders new student UI.
  Lance/Cohort 3 remains Off; the existing Dashboard snapshot must remain exact.
- A brand-new enrollment gets one three-step welcome, a real starting lesson,
  date-only help period and its reachable instructor. #283's dismissal is reused
  per enrollment. Finishing a lesson or handing in work ends first-run eligibility.
- Course switching reaches that course's Today; Alumni points to active learning
  elsewhere. Published/readable media and resources determine new navigation.
- Library framing, useful error/empty actions, context-preserving Back links,
  profile receipts and 44px controls, and public legal recovery work at 390/1280
  in both themes without horizontal overflow.
- LearnerProgress remains the source for statuses/counts. Query counts stay flat
  against fixtures that actually gain cohorts and media. Native old views remain.

No new enter animation is needed: welcome and navigation respond immediately.
The existing press feedback remains; the profile toggle disables movement under
reduced motion. Theme roles and existing button components are reused.

## Scope confirmed already implemented

- #295: Today links the hero cohort, next lesson and next-close lesson; Alumni
  Today already says library and lists recently added lessons. Requests start
  while the experience switch resolves (`dashboardRequest.ts`).
- #293: library outline has no progress counts, locked empty course modules or
  course-unlock copy; new Learn replaces Materials/module/cohort-home views.
- #283: slug-based course detail links back to all courses; enrollment open
  goes to Today; Start here dismissal is stored on each enrollment. The query
  variant (`/courses?offering_id=…`) still hid other courses without a recovery
  link; that remaining case is fixed here.
- Profile already capitalizes statuses, links readable enrollments and shows
  joined dates. Recordings and Resources already say Back to Today.
- Daily-unlock email lesson names already link to the exact cohort/lesson.
- #279 already fixed the announcement cohort and its return link.

## Execution ledger

| ID | Required journey and saved outcome | Coverage | Result |
| --- | --- | --- | --- |
| F1 | New solo course → welcome → dismiss → reload → open Orientation | 390/1280, light/dark | Passed |
| F2 | Program first day → welcome → dismiss → reload → open Orientation | 390/1280, light/dark | Passed |
| F3 | Alumni → recently added / continue watching, no course progress | 390/1280, light/dark | Passed |
| F4 | Alumni with active program → program Today, no stale library state | 390/1280, light/dark | Passed |
| F5 | Paused → saved work and readable lessons, no welcome/submission action | 390/1280, light/dark | Passed |
| F6 | Synthetic Lance/Cohort 3 Off → unchanged Today | 390/1280, light/dark + snapshot | Passed |
| F7 | Profile → real 44px email switch; human activity copy; context Back | 390/1280, light/dark | Passed |
| F8 | Public Privacy → deletion request and way back | 390/1280, light/dark | Passed |
| F9 | Receipt success/failure/retry and purchaser authorization | Unit/API, provider simulated | Passed |
| F10 | Empty features and paused cutoff; growing query fixtures | API/unit | Passed |
| F11 | Query-selected public course → Back to courses → both offerings | 390/1280, light/dark | Passed |

The final browser run passed **32/32** checks in 1.4 minutes. The six personas
ran at both widths and in both themes (24 dimensions), plus four public-legal
journeys and four query-selected catalog recovery journeys. New solo and program learners opened Orientation, returned to Today,
dismissed the welcome, reloaded and reopened Orientation. Alumni with two
courses reached the active program's actual redo work, used the course selector
in both directions, and opened an instructor conversation. Phone Back retained
the exact workspace; the desktop cohort link opened its Learn page. Profile's 48×44px switch
saved across reload and was restored; its 48×28px visual track stays compact.
The dark solo cases also verified reduced motion disables thumb movement.
Four additional Alumni destination retests passed: Open the library → browser
Back → Continue watching selects its recording → Open Learn returns to the
library. External playback delivery is not claimed.
The two-course journey opens Learn with a one-letter module name and verifies
that its link remains at least 44px wide and tall in all four dimensions.

There are **40 screenshots**: each persona at each dimension, plus Profile, Privacy, the instructor conversation and filtered catalog at all four dimensions. All 390px captures are 390px wide; Today and
legal routes also assert document width directly. [Structured results and image
index](first-run-states-2026-11-18/browser-results.json). Representative captures:
[self-paced phone](first-run-states-2026-11-18/self-paced-new-390-light.png),
[program phone](first-run-states-2026-11-18/program-first-day-390-dark.png),
[Alumni phone](first-run-states-2026-11-18/alumni-390-dark.png),
[two courses](first-run-states-2026-11-18/two-workspaces-1280-light.png),
[paused](first-run-states-2026-11-18/paused-390-light.png),
[Lance Off](first-run-states-2026-11-18/lance-off-390-dark.png),
[Profile](first-run-states-2026-11-18/profile-390-dark.png),
[conversation](first-run-states-2026-11-18/dm-header-390-dark.png),
[public Privacy](first-run-states-2026-11-18/legal-390-light.png),
[filtered catalog](first-run-states-2026-11-18/catalog-390-light.png).

Fixture preflight: synthetic user 7 has one new self-paced enrollment, user 9 is
on the program's first day, user 8 has an Alumni recording partially watched,
user 4 has Alumni plus a program redo, user 5 is paused, and synthetic Lance
(user 3) has an ongoing Off course ending Dec 19. No production database was read.
API regressions verify enrollment-scoped dismissal, published/legacy and paused
visibility, purchaser-only receipts, and constant queries while the fixture grows
from one to five cohorts and from zero to four published recordings.
Real iPhone/Safari touch, installed-app behavior, Clerk, external media playback,
Stripe transport, email and push delivery are outside this local browser harness.
The native typecheck, lint and jest gate passed; no native view is redesigned.
The design README explicitly schedules native screen adoption for W10.
The public routes and their AASA exclusions are unchanged.

## Implementation

- `StudentToday.first_run` uses LearnerProgress's completed lessons and latest
  submissions, the enrollment dismissal, and active/non-library status. The new
  welcome replaces the old purchase card and hero, so they never appear together.
  Dismissal failures keep the card and allow retry. A late success is scoped to
  that user and cohort, so it cannot hide the next enrollment’s welcome. Instructor actions still use
  the server's permitted contact; blocked people do not gain a new action.
- New navigation uses batch-loaded media/resource visibility, matching legacy
  recording replacement, publication, ready files and paused read cutoffs. Off
  cohorts keep their prior nav and payload. Switching an On course opens its
  Today; library Today points to other active courses and resumes an unfinished
  recording owned by this learner.
- Module headings link to their place in Learn. Dated recordings link to their
  course week; undated recordings link to Learn. Recordings have no lesson
  foreign key, so titles are never used to invent an association.
- Recovery actions cover cohort errors and unenrolled Learn only when On; Off
  error markup stays unchanged. The On cohort route normally uses Learn. Resource/recording
  Back links keep course scope. Message Back keeps its workspace, student DM
  cohort names link to Learn, and the inbox's origin is honored by lessons,
  recordings and conversations. The new lesson header and Previous/Next retain
  the original Today/Notifications path.
- The query-selected public catalog now links back to the full catalog, while
  keeping the selected course and checkout intent until the learner chooses Back.
- Profile uses a real 44px target, human activity copy, lesson-access dates and
  paid-purchase receipts. Receipt loading is local until clicked, then resolves
  this purchaser's hosted Stripe receipt; failure offers retry and requesting a
  copy. The provider response is simulated in tests, not a real payment.
- Public legal pages expose deletion on phones and link back to Today. Their
  route placement and AASA exclusions are unchanged. No migrations are needed.

## Original automated gate

The final ASUS gate on `242b0de3` runs one stage at a time, with
`PARALLEL_WORKERS=1`, the 55432 migration subprocess adapter and both API
prepared-statement modes. All 30 changed runtime file hashes match the remote
snapshot.

| Stage | Final result |
| --- | --- |
| API, prepared statements On | Passed: 2,119 tests / 42,672 assertions; zero failures, errors or skips |
| API, prepared statements Off | Passed: 2,119 tests / 42,672 assertions; zero failures, errors or skips |
| RuboCop / Brakeman | Passed: 749 files clean; zero security warnings (one existing ignored warning) |
| Web typecheck, lint, vitest, build, bundle, API and routing | Passed: 237 files / 2,713 tests; all other stages passed |
| Mobile typecheck, lint, jest, brand, URI and release | Passed: 141 suites / 1,544 tests; lint has zero errors and 74 existing warnings |

The wrapper finished with **zero failed stages** on the ASUS. [Structured gate
results](first-run-states-2026-11-18/automated-results.json). No assertions,
feature-switch defaults or prepared-statement policy were relaxed to pass.

## Failures and retests

- Earlier local prepared API passed 2,091 tests / 42,397 assertions. The local
  unprepared run hit one locked-search latency assertion (1.83s against 1s)
  after shared load rose above 25. No assertion or prepared-statement policy
  was relaxed; the ASUS is used for the final gate.
- The first ASUS attempt passed prepared API, Ruby security/lint, web and native
  stages, but unprepared API returned `409 content_moved` in a curriculum-copy
  write test. Its exact local unprepared recheck passed 11 assertions.
- The next ASUS attempt hit a private-meeting fixture crossing a course week,
  a rate-limit reset assertion in prepared mode, and an announcement read in
  the unprepared expiration test. #290 brought the same midnight-safe meeting
  helper into main; this branch retains it and adds a late-night regression.
  Focused meeting tests passed 22 tests / 166 assertions in each local mode.
  Rate-limit and expiration tests passed 30 tests / 10,870 assertions in each
  mode. That pre-merge ASUS snapshot also passed all Ruby, web (236 files /
  2,663 tests), native (141 suites / 1,544 tests) and extra routing/brand/release
  stages. The complete rerun on the combined branch passed both modes and all remaining
  stages; the prior failures are retained here for follow-up if they recur.
- The first browser attempt found the new lesson header hardcoded Back to Learn:
  one case failed, one was interrupted and 26 were not run. The origin hook,
  Previous/Next forwarding and three regressions fix it. Follow-up matrices
  passed, including the expanded 32-case matrix after merging #290.
- Legacy inbox scoping passed 147 focused checks plus web typecheck/lint; the
  paired phone Back regression passed 35 checks and preserves Off navigation.

The query-selected catalog regression failed on the old code and passed after
the recovery link was added (14 tests). A new catalog fixture initially lacked
a required start date; that browser run was stopped and its database removed.
The corrected fixture and expanded final matrix passed 32/32.

The advisory Impeccable 4.6 scan of the changed UI returned `[]`: [result](first-run-states-2026-11-18/design-scan.json).

## Cleanup

The browser phase ended with all pages closed, both owned servers stopped and
all ten unique synthetic QA databases dropped. The shared preview tab was
closed and released. The ASUS helper owns and cleans its exclusive temporary
Postgres container. The local gate database `csg_first_run_gate_20261118` and focused-test database
`csg_first_run_fixture_gate_20261118` are removed. Final lifecycle
status shows no active owned resources after the final ASUS job. Shared services and borrowed simulators
are left unchanged.


## Review fix round

Fix commit `c81adb9c` addresses the findings on `dc29e735`. Main advanced to
`d68e0b38` (#288), merged as `989d988a`. The combined OpenAPI schema preserves
both sides and both type files were regenerated. App.tsx and routePreload.ts
match main, including the lazy SubmissionAudit route; the `book` helper matches
main exactly. The original evidence above remains
available; this round's [44 screenshots and structured results](first-run-states-2026-11-18/review-round-1/browser-results.json)
and [runtime hashes](first-run-states-2026-11-18/review-round-1/source-sha256.json)
are separate.

Changes and acceptance:

- Legal recovery is Today only for authenticated On learners or staff, home for
  signed-out visitors, and absent for Off learners and authenticated profile
  loading. Phone deletion stays visible. The shared public header wraps, grows
  beyond 72px when needed and fits both brand lines at 390px.
- Activity's learner empty copy applies only to the learner's own On view.
  Staff retain the backfill caveat. Empty category filters name sign-ins,
  learning or work; Off learner copy remains unchanged.
- Conversation Back visibility and destination use the same validated origin.
  Desktop shows one link; phone Back keeps a query-only origin and workspace.
  Recordings upgrades only a validated legacy inbox origin before URL updates.
- Learn consumes week/module expansion hints when the user changes expansion,
  so closing either the current or another hinted week sticks. Recording links
  share Learn's curriculum-week and scheduled-opening computations, including
  module overrides and breaks. Schedules and assignments are batch-loaded. Collapsing a hinted week also
  preserves other expanded weeks.
- Receipt URL parsing failures return 404. Profile receipt/access-date rows
  use each enrollment's server fields, including when an Off course is selected.
  The profile controller and #287 CurriculumName queries are untouched.
- Welcome says "Follow the class schedule". The QA solo fixture reloads before
  saving media settings, with an explicit On assertion and an Off school default
  to expose a lost cohort override.

| Verification | Result |
| --- | --- |
| Focused API, prepared On | 36 tests / 264 assertions passed |
| Focused API, prepared Off | 36 tests / 264 assertions passed |
| Post-merge affected web tests | 11 files / 169 tests passed, including Off snapshots and SubmissionAudit |
| Web typecheck, lint, build, API transport check | Passed |
| `api:generate` | No diff in either generated type file or OpenAPI |
| Changed Ruby lint | Five files clean |
| Advisory Impeccable 4.6 | No findings |
| Browser matrix | 44/44 passed in 1.8 minutes, 390/1280 and light/dark |
| Post-merge API, prepared On | ASUS: 121 tests / 595 assertions passed |
| Post-merge API, prepared Off | ASUS: 121 tests / 595 assertions passed |
| Full ASUS gate before main integration | Prepared: 2,122 / 42,685 passed; unprepared initially failed one support-expiry test, then the unchanged full rerun passed 2,122 / 42,685 |
| Other full ASUS stages before main integration | Web: 237 files / 2,732 tests; native: 141 suites / 1,544 tests; lint/security/build/bundle/routing/brand/release all passed |

The new schedule query regression initially exposed 19 versus 23 queries as
recordings and assigned cohorts grew. Preloading the assignments' module
association fixed it; the final fixtures grow from one to five scheduled
recordings with flat queries. Both focused API modes passed afterward.

Browser acceptance includes signed-out Privacy → home with the exact home
heading, On deletion → Today with Eli's heading, Off Privacy without a Today
link, full phone brand text, admin student and team activity filters, a single
Notifications Back in the desktop conversation, and the original welcome,
Alumni, switching, profile and recovery journeys. Receipt transport and external
media remain simulated; actual Safari/iPhone and native visual checks are not
claimed. The fixes add no migrations or contract changes; main integration includes
#288’s migration and contract. AASA is unchanged. Post-merge web typecheck, lint,
build, bundle/API checks and mobile typecheck passed; another api:generate
produced no diff.

Cleanup: the isolated browser servers and database are removed. The focused
local database `csg296_review_test` was removed by its test wrapper. The ASUS
helper removed its temporary test database/container after each completed job.
The post-merge browser phase passed 44/44 and its servers/database are removed.
Final lifecycle status reports no active owned resources. See the
[structured verification results](first-run-states-2026-11-18/review-round-1/automated-results.json).


The complete pre-merge ASUS run encountered one failure in the untouched
`LearnerCapabilitiesTest#test_self-paced_support_expiry_or_missing_assigned_instructor_never_advertises_course_questions`:
expired support advertised `course_question` instead of `none`. The full
unprepared rerun on a fresh ASUS database passed without application/assertion
changes. The isolated entitlement suite also passed locally in each mode
(11 tests / 130 assertions). The cause was not established; retain this as an
intermittent test failure for follow-up, not a claimed entitlement fix.

Post-merge API coverage includes the first-run, outline, Today, student-workspace,
submission-audit integration/recheck/service and audit migration tests. The first
focused wrapper inherited the full-suite OpenAPI completeness flag and stopped
after the passing prepared subset because unrelated routes were not exercised.
The corrected focused wrapper keeps per-response schema validation, omits only
that whole-suite completeness audit, and passed both modes. Both prepared-mode
guards remain intact. Before the earlier full run’s web stage, the final
CourseOutline client/test files were synced and all 33 runtime hashes verified;
API sources were unchanged during that run.


## Final CodeRabbit round

On November 18, the five minor comments on `cf7cb5e1` were fixed in
`8d692d21d76da0947cc542783938ff04221c4b6c`. The recording browser selector was
corrected in `7ec6e18a`; application code stayed unchanged for that retest.
This affected-flow round was agent-executed on the MacBook with Node 22 and the
isolated synthetic QA database. The product brief and acceptance above still
apply. No API, contract, native, AASA or curriculum-query changes were made.

- Welcome dates distinguish active support from ended support. Tests cover both.
- Both legal recovery links wait for auth to finish, then retain the signed-out,
  On and Off destinations. Tests cover both loading auth values and settlement.
- A week-only recording link opens every matching module group. The fixture has
  two modules sharing Week 1; collapsing one preserves the other. An unmatched
  week keeps the existing fallback. No module-id API extension was needed.
- Valid router state wins over a conflicting query destination, matching the
  documented trust order. Unsafe state still falls back to a validated query.
- Admin activity initializes the requested theme before navigation and asserts
  the actual `html[data-theme]` value before capture. Both staff views retain
  category-specific empty copy and the backfill caveat.

The seven affected web files passed **163 tests**. Web typecheck, lint and build
passed. `npm run api:generate` produced no diff in the schema or generated types.
The advisory Impeccable scan of the three changed views returned no findings.
API tests in both modes were not rerun because this round changes no API code,
as requested; the previous ASUS results remain recorded above.

Browser acceptance: **6 journeys passed in all 4 dimensions (24/24)**, at 390 and
1280 in light and dark. Required journeys were On legal deletion → Today,
signed-out Privacy → home, Off legal recovery, admin student/team activity,
recording → both Week 1 groups → independent collapse, and expired-support
welcome → Orientation. The first attempt passed 20 cases; four new recording
cases timed out because the test shortened the existing link label. After
correcting the selector to “Open Week 1 in Learn”, all four retests passed
without an application change. The initial failure summary is retained.

Evidence: [browser results](first-run-states-2026-11-18/review-round-2/browser-results.json),
[automated results](first-run-states-2026-11-18/review-round-2/automated-results.json),
[initial attempt](first-run-states-2026-11-18/review-round-2/attempt-1-summary.json),
and 16 screenshots in `first-run-states-2026-11-18/review-round-2/`, including
[dark admin](first-run-states-2026-11-18/review-round-2/admin-activity-390-dark.png),
[overlapping weeks](first-run-states-2026-11-18/review-round-2/recording-week-390-dark.png)
and [ended support](first-run-states-2026-11-18/review-round-2/support-ended-390-dark.png).
Actual Safari/iPhone and native journeys were not rerun in this web-only round.

Cleanup: task-owned servers, synthetic database and all browser tabs were
removed. Lifecycle status reports no active owned resources. The PR remains
open and unmerged. This is the final CodeRabbit minor-fix round; any further
minor comments belong in the PR body's residuals instead of another fix round.
