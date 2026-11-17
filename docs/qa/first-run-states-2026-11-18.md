# First run, empty states and recovery — W8 PR 8.4

Implementation branch `feat/first-run-states`, based on `main` at `c290e00a`.
Agent-executed browser QA on Leon's MacBook. The final full gate runs on the
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
The native typecheck, lint and jest gate still runs; no native view is redesigned.
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

## Automated gate

The final ASUS gate on `242b0de3` is in progress. It runs one stage at a time,
with `PARALLEL_WORKERS=1`, the 55432 migration subprocess adapter and both API
prepared-statement modes. All 30 changed runtime file hashes match the remote
snapshot. This remains a readiness gate until every stage passes.

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
  stages. The combined branch is now running the complete gate again.
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
all nine unique synthetic QA databases dropped. The shared preview tab was
closed and released. The ASUS helper owns and cleans its exclusive temporary
Postgres container. The local gate database `csg_first_run_gate_20261118` and focused-test database
`csg_first_run_fixture_gate_20261118` are removed. Final lifecycle
status is checked after the final ASUS job finishes. Shared services and borrowed simulators
are left unchanged.
