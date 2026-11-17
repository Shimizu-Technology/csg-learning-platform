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
  Across curricula, definitions are copied and objective codes receive a unique
  `.COPY-<id>` suffix to avoid collisions.
- Admins can clone a cohort using a future start date and either its current
  curriculum or a new draft curriculum. End/access/support dates, module dates,
  submission deadlines, office hours and default unlock dates shift by the start
  date delta. Timed events preserve local wall time across DST. Private meeting
  configuration is copied; slots/bookings are not. Checkout starts off and a new
  public slug is allocated. Existing feature values, including absent/null
  inheritance, are preserved verbatim. The success dialog displays each explicit
  or inherited value and its resulting state.
- Enrollment, purchase, communication, recording and learner-work history stays
  on the source. Legacy announcements/recordings/class-resource history is
  excluded from cohort settings. Staff assignment/editing grants are not cloned;
  support/meeting instructors remain configuration references.
- Each operation and its retry receipt commit in one transaction. An actor-scoped
  advisory lock serializes retries; changed options with a reused request ID
  return 409. Timeouts return a retryable conflict. Video key locks precede row
  locks; storage objects are referenced, never duplicated. Rows use bulk inserts
  in batches of 500.
- Cloning stays admin-only. Existing instructor grants authorize lesson editing,
  whereas module cloning restructures curricula and may cross curriculum
  boundaries. This PR does not expand those grants.

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
- ASUS full prepared/unprepared API gate: **pending**. Uses the existing
  `scheduled-jobs-gate.sh`, including `MIGRATION_PROCESS_TEST_DATABASE_URL` port
  adapter, OpenAPI coverage, RuboCop and Brakeman. Exit-75 lock contention was
  respected; only one runner job was launched at a time. An earlier snapshot
  passed both API modes (2,257 tests / 43,583 assertions each), but Brakeman
  flagged its quoted video-key array. Rails SQL sanitization replaced that array;
  local Brakeman then reported zero warnings (one existing ignored warning).
  The final source rerun remains the acceptance gate.

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
