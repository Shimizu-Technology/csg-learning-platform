# T-12 authoring clones — 2026-11-18

Implementation worker: `feat/authoring-clone`, isolated worktree
`~/work/csg-authoring-clone`, based on main `3a8b3ebf`. Hold for the lead:
**do not merge or watch**. No production database or provider was accessed;
Cohort 3 (Lance) was untouched.

## Context and acceptance

CSG Learn gives Code School of Guam students assigned lessons and staff reusable
curricula, cohort delivery, grading and support. Sources: `docs/PRODUCT_VISION.md`
§§4–5, `AGENTS.md`, `CurriculumCopyForCohort`, `LessonDuplicate`,
`StaffCohortScope`, `FeatureSwitches`, Content studio and CohortManagement on the
base commit. These clones create new authoring records; the existing cohort copy
continues to remap learner data and enforce `content_moved_at` guards separately.

Agent-executed affected-flow QA covers curriculum, module and cohort cloning,
retry safety, rollback, permissions, preserved content and bounded query growth.
Required UI dimensions: bundled Chromium, 390×844 and 1280×844, light and dark.
Operational dialogs reuse the app's modal, focus and button patterns; no new
motion. Browser resizing establishes responsive web coverage only.

## Resulting behavior

- Admins can clone a curriculum from Content. Modules, all lessons (including
  archived lessons), blocks, rubric definitions/criteria, objectives, alignments,
  knowledge checks, schedules/release days and ready course ZIP references are
  copied. Internal content links are remapped. The new curriculum is a draft,
  without cohort assignments or learner data. Package identity is cleared.
- Admins can clone a module into any curriculum at a zero-based position.
  Existing modules shift in one query. Copied lessons start archived; no alumni
  assignments or learner work are created. Within the same curriculum,
  curriculum-level rubrics/objectives remain shared, as in lesson duplication.
  Across curricula, only referenced definitions are copied; retry receipts retain
  provenance so later module clones reuse those copies. Newly copied objective
  codes receive a unique `.COPY-<id>` suffix to avoid collisions.
- Admins can clone a cohort using a future start date and either its current
  curriculum or a new draft curriculum. End/access/support dates, module dates,
  submission deadlines, office hours and default unlock dates shift by whole
  weeks between the Monday anchors of the source and target kickoff weeks.
  Source module overrides stay explicit and snap to their configured weekday.
  Assigned modules without source overrides keep inheriting when that yields
  the correct weekday; only wrong-weekday inheritance needs a pinned alignment
  row. Explicit overrides and breaks stay in the same weeks. Timed events preserve local wall time across DST. Private meeting
  configuration is copied; slots/bookings are not. Checkout starts off and a new
  public slug is allocated. Existing feature values, including absent/null
  inheritance, are preserved verbatim. The success dialog displays each explicit
  or inherited value and its resulting state.
- Enrollment, purchase, communication, recording and learner-work history stays
  on the source. Legacy announcements/recordings/class-resource history is
  excluded from cohort settings. The support instructor receives an assignment
  before being set on the copy; lesson-editing grants are not copied. Other
  staff assignments are not cloned. Meeting instructors remain configuration
  references.
- Each operation and its retry receipt commit in one transaction. An actor-scoped
  advisory lock serializes retries; changed options with a reused request ID
  return 409. Timeouts return a retryable conflict. Video key locks precede row
  locks; storage objects are referenced, never duplicated. Rows use bulk inserts
  in batches of 500.
- Cloning stays admin-only. Existing instructor grants authorize lesson editing,
  whereas module cloning restructures curricula and may cross curriculum
  boundaries. This PR does not expand those grants.

Initial-PR implementation evidence (before the review fix round below):
browser/UI and locking/ordering checks used
`b4374f90`; the SQL-sanitizer and hosted-storage regression change is
`91fb915f`. The final full API gate uses `91fb915f`. Later documentation-only
commits do not change the tested application.

## Browser scenarios

Preflight: secret-free harness, eight synthetic personas, fresh local QA database;
source cohort 1 had inherited recordings Off at school level, explicit help
requests Off and office hours On, module schedule, submission deadline, recurring
office hours and private meeting configuration. All external browser traffic was
blocked. Source and learner counts were snapshotted before testing.

| Required journey | 1280 light | 1280 dark | 390 light | 390 dark |
| --- | --- | --- | --- | --- |
| Clone curriculum, open its focused outline, confirm draft | Passed | Passed | Passed | Passed |
| Clone module into another curriculum at position 1, open it | Passed | Passed | Passed | Passed |
| Clone upcoming cohort at chosen new date, open it | Passed | Passed | Passed | Passed |
| Show Inherit → Off / explicit Off / explicit On correctly | Passed | Passed | Passed | Passed |
| Student Learn omits draft; direct module URL returns to Learn | Passed | Passed | Passed | Passed |
| No horizontal overflow or uncaught page errors | Passed | Passed | Passed | Passed |

Final browser run: **4/4 dimension cases passed, 19.8 seconds**. Each case executes
all journeys. Light exercises the shared curriculum; dark also clones it.
`authoring-clone-verify.rb` independently verified all four browser-created
cohorts: zero learners, unchanged original/learner rows, shifted schedule and
submission-window shapes, office-hour dates, meeting config, switches, curriculum
choice and draft status. Direct API access to draft-clone content is separately
refused in integration tests.

Reproduce after `scripts/qa/run start`:

```sh
# From api/, use the exact owned QA database printed by startup:
DATABASE_URL=postgresql://localhost/<owned-qa-db> bundle exec ruby ../scripts/qa/authoring-clone-fixtures.rb
# From repo root, with the lifecycle helper on PATH:
QA_SPEC=authoring-clone.spec.ts DEV_LIFECYCLE_SESSION=<session> node web/node_modules/@playwright/test/cli.js test --config scripts/qa/playwright.config.ts
# From api/:
DATABASE_URL=postgresql://localhost/<owned-qa-db> bundle exec ruby ../scripts/qa/authoring-clone-verify.rb
```

Evidence stays in ignored `.qa-local/`: browser result JSON, screenshots, source
snapshot and JSONL identifiers for the final four copies. Earlier failed runs
found the destination-picker bug and a glossary violation, both fixed. Subsequent
test-only corrections handled label selection, unique rerun fixture names, the
v2 redirect behavior and a response matcher that initially captured the original
curriculum refresh instead of the clone. Final verification uses the created ID.
The initial shared-preview form automation timed out twice; testing continued in
the bundled Chromium harness. No passed result relies on the interrupted runs.

## Engineering checks

- Focused API cloning tests: **8 tests / 127 assertions, zero failures/errors**.
  Migration round trip also passed; it clears all pooled connection statement
  caches and resets model column information. Migration timestamp
  `20261118070000` is later than main's `20261118060000`.
- QueryCounter compares small and grown fixtures for all three clone kinds.
  Growth adds eight modules, 64 lessons, 320 blocks, eight objectives/rubrics,
  64 checks/alignments, eight office hours and module schedules. Each clone kind
  permits at most two additional queries, with bulk queries per entity type.
- Web typecheck, ESLint, **245 Vitest files / 2,902 tests**, build and generated API
  consistency passed. Both web and mobile types were regenerated from OpenAPI.
- Hosted video tests stub storage only: missing objects roll back; verified
  objects reuse their keys and acquire one bulk advisory-lock query.
- Changed Ruby files passed RuboCop. Impeccable's advisory scan returned `[]`.
- Final ASUS full API gate on `91fb915f`: **passed in both modes**.
  Prepared: **2,258 tests / 43,594 assertions**, 319.17 seconds.
  Unprepared: **2,258 tests / 43,594 assertions**, 302.02 seconds.
  Both had zero failures/errors and one existing pooler-canary skip.
  OpenAPI inventory coverage, full RuboCop (785 files), and Brakeman passed.
  Brakeman reported zero security warnings and one existing ignored warning.
  `scheduled-jobs-gate.sh` retained the migration-process port adapter.
  Exit-75 contention was respected, with one ASUS job at a time.
  An earlier snapshot passed both API modes but failed Brakeman on a quoted
  video-key array; Rails SQL sanitization fixed it without adding an ignore.
  Raw final gate output is retained in
  `.qa-local/authoring-clone-asus-final.log`.

## Limits and cleanup

Safari/WebKit, native Expo, real Clerk login, real S3 playback/storage deletion,
payments and external delivery were not run. No application release/deployment
was requested or performed. Independent PR review and CI status are reported on
the held PR, separately from local acceptance.

Lifecycle session `manual-20261118-070749-6433-9dac`: owned shared-preview tab was
closed; Playwright pages closed/released in `finally`; harness cleaned exact
Rails/Vite PIDs 8541/8544 and 11046/11055, and dropped
`csg_qa_8523_1794950142` and `csg_qa_11037_1794950973`. The separate local
`csg_authoring_clone_test` database was dropped. Shared PostgreSQL and protected
home-server services were left available. The requested old staff-reliability
worktree was already absent. Keep the held branch/worktree for the lead.

Host setup issue: `dev-lifecycle` was absent from PATH, so the synced helper was
used directly. The guidance freshness check could not load the missing
`~/.config/shimizu-technology/agent-context.json`; relevant synced skill/guide
files were read directly. No authentication/configuration state was copied.

## Lead handoff

Retain `~/work/csg-authoring-clone`, branch `feat/authoring-clone`, base
`origin/main` at `3a8b3ebf`. Initial application implementation ended at `91fb915f`; the review fix round
below changes application code at `7d7b109b`. Recheck the PR head,
current main, checks and independent review before continuing. The worker was
instructed to open the PR without merging or watching it.

Next action: lead review of the final diff and CI/reviewer results. No production
data migration, deployment or feature activation has been performed. No local
runtime is handed off; the branch, source, QA scripts and ignored evidence are
retained. The ASUS gate exited successfully through its temporary-container cleanup
trap. Lifecycle cleanup/status confirmed no unresolved owned resource.


## Fix round after independent Opus review of 0337c895

The review confirmed independence, shared S3-key deletion safety, no learner
copies, exact switch inheritance, authorization/contract/migration behavior,
and four concurrent submissions producing one clone plus three replays in both
modes. Those confirmations cover the reviewed head, not this fix head.

`origin/main` remained at `3a8b3ebf`; merging it returned already up to date.
Fix implementation: `7d7b109b`. Application acceptance for this round:

| Finding | Change and evidence |
| --- | --- |
| P1 weekday drift | Week-anchored shifts replace raw day deltas. Monday overrides Nov 9/Nov 30 from a Tuesday Oct 27 source become Monday Jan 18/Feb 8 after Thursday Jan 7 kickoff. The three-week gap remains. Assigned implicit starts are snapped with `next_start_date_on_or_after`; unassigned modules without overrides stay unassigned. Tests call `valid?` on schedules and office hours. Office/live-class times retain weekday and local wall time. |
| P2 support instructor | Create the new cohort without support, copy the support instructor membership with default (no editing grant) fields, then set support under normal model validation. A self-paced source clone returns 201 and `valid_support_instructor?` passes. |
| P3 definition over-copying | Gather only rubric, criterion, knowledge-check and alignment dependencies of the copied module. Store source-to-copy IDs with the retry receipt, scoped by destination curriculum, and reuse definitions across subsequent clones without recopying criteria. Unrelated definitions are excluded. |
| P3 archived curriculum | Retaining an archived curriculum returns a clear 422 telling the admin to choose “Clone the curriculum too”; that choice succeeds with a draft. |
| P3 unnecessary S3 | A same-curriculum cohort clone skips both video queries and S3 configuration/storage checks. Regression test raises if S3 is inspected and checks captured SQL. |
| P3 redundant index | Migration `20261118080000` adds definition provenance and drops the standalone `user_id` index; the unique `(user_id, client_request_id)` index retains its prefix lookup. Round-trip tests clear every pooled statement cache and reset model metadata. Timestamp is unique and later than main and the prior clone migration. |

Focused API/migration suite: **13 tests / 167 assertions in each mode**, zero
failures/errors/skips, prepared and unprepared. Growing QueryCounter fixtures
still pass; each measured new destination begins without a pre-existing reuse
map, so growth compares equivalent operations. Separate reuse tests assert that
repeated copies create no extra objectives, rubrics or criteria.

Web typecheck, lint, all **2,902 tests / 245 files**, build and generated-type
consistency passed. Impeccable advisory scan returned `[]`. The modal explains
weekday-preserving week shifts and the support instructor assignment without
an editing grant. No public API fields changed.

Browser execution used the shared T3 browser against a fresh secret-free harness
at 1280 and 390 in light and dark. Four cohort copies were created through the
form, alternating retained and newly cloned curricula. Each opened with zero
learners and the correct switch states. Settings showed Jan 18 and Feb 8;
student preview’s All outline showed corresponding Jan 18/Jan 19/Jan 20 lesson
unlocks; Content labelled release day zero Monday. All four checks had zero
horizontal overflow. A separate database verification checked valid Monday
schedules, the break, Thursday office hours, matching `week_and_day_for` labels,
zero enrollments and unchanged original settings/learner counts.

The PR’s Playwright spec now uses Thursday Jan 7 rather than a same-weekday target,
checks both displayed module dates and the preview’s saved unlock date, and
selects All to expose locked future lessons. Its four cases parse/list correctly;
this fix-round browser execution was through shared preview automation, not a
second Playwright browser. One initial preview wait missed hidden modules under
the default To do filter; selecting All exposed them and completed verification.
Evidence is retained in `.qa-local/authoring-clone-fix-browser.json` and
`.qa-local/authoring-clone-fix-verify.rb`.

The requested **one full ASUS run** used production prepared-statements-off mode
with OpenAPI coverage and the unchanged migration subprocess port adapter:
**2,263 tests / 43,631 assertions, one failure, zero errors, one existing skip**
(seed 42069, 302.47 seconds). The failure is
`ScheduledUpdateRacesTest#test_a_claim_released_after_another_job_settled_the_push_is_unsettled_again,_and_the_re-request_sends_only_to_it`,
line 224: expected one requeued push, got zero. The test, job and publisher are
unchanged from main. This is a failed full gate, not a green run. The focused ASUS
recheck of that unchanged class at the same seed **passed: 10 tests / 63
assertions**, zero failures/errors/skips (2.14 seconds). Full ASUS RuboCop and
Brakeman then passed: zero security warnings, one existing ignored warning.
No second full rerun was started; the failed full gate is not replaced by the
passing isolated retry. The full log is `.qa-local/authoring-clone-fix-asus.log`;
the isolated/static log is `.qa-local/authoring-clone-fix-race-recheck.log`.

Cleanup: shared-preview tab closed/released; exact owned Rails/Vite PIDs
17449/17452 stopped and `csg_qa_17397_1794953404` dropped; local
`csg_authoring_clone_fix_test` dropped. Shared PostgreSQL and protected home
services remain available. Lifecycle session is
`manual-20261118-080627-16556-cfa7`. ASUS wrappers own their disposable containers
through the runner cleanup trap. No production data, including Lance’s Cohort 3,
was touched. Keep the PR unmerged; the six requested fixes need final-head review,
and the failed full-suite gate remains visible for the lead.

Both ASUS wrappers exited through their disposable-container cleanup traps.
Final lifecycle cleanup/status confirmed no unresolved owned resources.


## Lead follow-up: preserve inherited module dates

The lead’s review of `6c70e3e7` found that the prior fix materialized every assigned
module as an override, pinning dates that previously followed kickoff. This was
a behavior change. The clone now copies an override only if the source had one
or the target’s inherited date would fall on the wrong weekday.

`CurriculumModule#legacy_start_date_for` is exactly `cohort.start_date +
day_offset + first_scheduled_day_index`; it does not align weekdays. For a
Monday module seven days after a Thursday kickoff, inheritance yields Thursday,
not Monday. Such a module still needs an explicit alignment row. That necessary
row stays pinned on later kickoff edits, like any explicit override. This fix
does not change inherited-date behavior globally for existing cohorts.

New integration regressions clone through POST and then edit kickoff through
PATCH, covering both retained and cloned curricula: a Monday-aligned inherited
module has no override and moves from Jan 11 to Jan 25 when kickoff moves from
Jan 4 to Jan 18; the source’s explicit Jan 18 override stays fixed. A Thursday
kickoff case demonstrates why inheritance would be invalid (Jan 14 Thursday),
keeps the valid Jan 11 Monday alignment override, and verifies its intentional
pinning on a later kickoff edit. Source kickoff is unchanged.

Focused clone/migration tests pass in **both modes: 15 tests / 192 assertions**,
zero failures/errors/skips per mode. Changed Ruby files pass RuboCop. The wire
contract and frontend are unchanged; the previously green web gate is not being
rerun for this backend-only correction. A final-source full ASUS unprepared-mode
run is pending. Main remains unchanged at `3a8b3ebf`.

Clarification of the earlier “full-suite race failure”: on fix source `7d7b109b`,
the ASUS **unprepared (prepared_statements=false)** full run, seed **42069**,
failed only
`ScheduledUpdateRacesTest#test_a_claim_released_after_another_job_settled_the_push_is_unsettled_again,_and_the_re-request_sends_only_to_it`
at **line 224** (expected one requeued push, got zero). That test and its
`PushNotificationJob` / `ScheduledAnnouncementPublisher` production code are
unchanged from main and outside this PR’s cloning changes. An isolated ASUS
rerun of the unchanged class at the same seed **passed: 10 tests / 63 assertions,
zero failures/errors/skips**. No causal link to cloning was found. The original
full failure remains in the historical record; its passing isolated retry was
not presented as a green full run. The lead reports CI green on `6c70e3e7`.
