# Submission audit — November 17, 2026

Implementation base: `aa0cf1b4` (W5 PR 5.5). Execution owner: implementation agent on the Mac mini.

## Scope and acceptance

CSG Learn serves program and self-paced learners and staff. Content is shared through curricula → modules → lessons → blocks. Sources: `AGENTS.md`, redesign README §2/4/5, `LearnerProgress`, `ContentBlock#effective_submission_type`, `CurriculumModule`, and the local QA harness README.

Required journeys: admin discovers suspect blocks, follows curriculum/module/lesson/block links, opens a selected block with a suggested submission type without saving changes, and dismisses practice persistently. Students/instructors cannot access decisions. Reviews record reviewer/time and become invalid when text changes. Widening MWF to weekdays hides empty rows while preserving release days and progress. The existing submission/work guards remain in force.

The operational view uses existing surfaces, sentence case, wrapping actions and no new motion. It is admin-only; instructor editing grants do not grant audit access.

## Content findings for Leon

No production content or learner data was edited. The current browser harness is synthetic (`docs/qa/README.md`). A separate disposable local database loaded the schema and imported the repository's `scripts/prework_exercises.json` through `curriculum:import_prework`. This is the available prework export, not a fresh production snapshot or the whole live course. Counts below are local import counts; they are not Lance's completion counts.

The heuristic matches submit, push, turn in, create a repo/repository, build, deploy, screenshot and share your link in title/body. Of 106 raw matches, 103 already inherit `prework_github_sync` through the established legacy resolver and are excluded. Three unresolved candidates remain. This avoids calling working legacy submissions missing. Text edits reopen dismissed candidates. Suggestions are not saved automatically.

### CSG Full-Stack Bootcamp 2026 › Prework

| Lesson / block | Local link | Completed learners | Suggested decision for approval |
| --- | --- | --- | --- |
| Week 2 Overview Lesson 3: Command line version control | [Open block](/admin/lessons/31/edit?block=57) | 0 | Needs a submission: repository link. Instructions explicitly require committing and pushing a new problem in deliberate-practice. Confirm whether this is intended to be assessed or independent practice. |
| Week 4 Overview Lesson 3: Managing files and folders in the terminal | [Open block](/admin/lessons/79/edit?block=128) | 0 | Practice only — mark as reviewed. This is a terminal-navigation drill; the GitHub folder name triggers the heuristic but no hand-in is requested. |
| Week 5 Day 5 Lesson 4: Deploy a website | [Open block](/admin/lessons/126/edit?block=187) | 0 | Practice only — mark as reviewed for this instructional block. The deployment title triggers the heuristic; inspect the companion exercise before changing any submission requirement. |

Local numeric IDs above identify the disposable import and must not be used for production writes. Locate the same titles in the deployed audit. Leon must approve each content decision in the tool after deploy. Full current live-course coverage, including Lance's lesson 213, still requires an authorized current content seed; this export cannot establish it.

## Verification ledger

Browser build: local Vite/Rails working tree based on `aa0cf1b4`, with the final implementation files in this PR. Agent-executed affected-flow QA used the disposable synthetic harness at 1280×844 and 390×844, each in light and dark (theme attribute asserted).

| Required journey | Result |
| --- | --- |
| Admin list, contextual links, completion counts | Passed in all four viewport/theme combinations |
| Needs a submission → selected block settings, suggested type, Save remains disabled | Passed; phone opens Settings immediately |
| Practice only → row removed, reload remains dismissed | Passed; reviewer ID and timestamp verified in the database |
| Widened module in staff Content calendar | Passed; Monday/Wednesday/Friday only, no empty-day toggle |
| Student outline before/after decisions | Passed; main content identical, no Tuesday/Thursday headings |
| Cohort Schedule | Passed; classes/office-hours list, no generated empty weekday headings |
| Progress and release-day persistence | Passed; four synthetic completed blocks kept their types and progress, lesson offsets remained 0/2/4 |
| Student/instructor authorization, stale review rejection, changed text reopens audit | Passed in API regression tests |

The module was changed from MWF to weekdays in fixture setup and its saved lesson offsets checked before/after. Separate API coverage checks computed calendar dates before/after widening. `week_and_day_for` is unchanged. Student outline code already groups actual lessons, and cohort Schedule already lists actual sessions; the remaining display change removes Content calendar's opt-in empty rows. New-exercise placement still offers all configured weekdays.

Initial browser failures exposed the API URL prefix and phone Settings visibility, both fixed and retested. Later locator/fixture failures were corrected: scoped the module heading, selected the phone detail pane, reset consumed practice fixtures, used the actual schedule heading and asserted the actual theme preference key. Final browser run: 4/4 passed. This is four complete journey cases, not a claim of whole-app acceptance.

Engineering gates: web typecheck, ESLint, Vitest (208 files / 2,422 tests), production build, test:bundle and api:check passed. Both generated type files were regenerated from OpenAPI. Mobile TypeScript and Jest passed (139 suites / 1,506 tests). RuboCop passed (700 files); Brakeman reported no warnings. Impeccable advisory scan returned `[]` for the audit page.

The initial full API run found the new table missing from the cohort-copy reference inventory. It now explicitly stays with the original content, with a regression test that copied content starts unreviewed. Migration up/down is tested; its ensure clears every pooled connection's statement cache. Final API runs use `OPENAPI_COVERAGE=1 PARALLEL_WORKERS=1` against `csg_submission_audit_test`: prepared statements enabled passed with 1,940 tests / 41,188 assertions. Prepared statements disabled also passed with 1,940 tests / 41,188 assertions, zero failures/errors/skips in each mode. The earlier disabled-statement full run also passed (1,939 tests / 41,185 assertions) before the additional copy-policy regression was added. No prepared-statement mode was disabled as a workaround, and `MigrationDatabaseProcessTest` was not changed.

Owned QA API/web PIDs 37920/37948 were stopped by the harness and its database dropped. The shared preview tab was closed. Lifecycle session `manual-20261117-121105-33210-5e76` reports no active owned resources. Both task databases (`csg_submission_audit_test` and `csg_submission_audit_content`) were dropped after verification. Borrowed Postgres remains available. Safari/WebKit and physical devices are not run on this host. Native mobile behavior, production Clerk, provider delivery, and deployment are outside this local QA.

## Fix round — independent review and CodeRabbit

Merged `origin/main` at `c290e00a` (#295), including the scheduler and the `student_experience_v2` switch. Regenerated both clients from the merged OpenAPI document. The unshipped audit migration is now `20261118030000`, after main's `20261118020000` migration; its reviewer reference is nullable with `ON DELETE SET NULL`. A regression deletes the reviewer and verifies that the practice decision survives. Migration tests clear every pooled statement cache in `ensure`.

- Only exercise, code-challenge and checkpoint blocks receive suggested submission types. The Inspector submission picker is again limited to those work blocks. Instructional candidates offer **Add a companion exercise**, which opens an unsaved exercise immediately after the source block. The original block stays unchanged. The companion uses a learner-supported work block; the normal Save and learner-work guards still apply.
- The audit resolves every using cohort's module GitHub configuration and GitHub feature switch. Fully configured blocks are omitted; mixed cohorts remain listed with their individual behavior. Curriculum/cohort preloads and one school-settings read preserve flat QueryCounter coverage. No school setting is lazily created by the audit; read-only transaction coverage passes.
- The matching table covers all requested phrases and inflections, removes bare `build`, and strips fenced code, inline code and HTML tags before matching. Draft/archived curricula are excluded.
- A suggestion is visible only while its original block is selected and is consumed by a successful save. Audit query actions are removed once the saved draft is clean. Older editor loads cannot overwrite the companion draft. Delayed-GET coverage proves a successful review cannot be undone by an earlier audit reload.
- Schedule confirmation describes added weekdays as options for new exercises and says existing saved days stay unchanged and empty days stay hidden (the pre-existing `tth` date-shift caveat remains below).

Regression verification: 42 focused API tests / 113 assertions passed. Focused web tests: 64 passed. Full web: 236 files / 2,645 tests passed; typecheck, lint, build, test:bundle and api:check passed. Mobile: typecheck, lint (0 errors, 74 warnings), 141 Jest suites / 1,544 tests passed. Local RuboCop: 743 files, no offenses; Brakeman: no warnings. Advisory UI scan: `[]`.

Browser: 4/4 Chromium journeys passed at 1280×844 and 390×844, light/dark, including unsaved companion creation, the two decisions, staff calendar/schedule, and identical student outline before/after review. The program fixture explicitly uses `student_experience_v2: false`, preserving the current-student shape; main's v2 journey tests remain in the full web gate. Persistence checks verified four completed source blocks, four reviewer-stamped decisions, unchanged source types and 13 saved lesson blocks; companion drafts were not persisted. Safari/WebKit and physical devices remain not run.

Re-running the separate repository prework import with the new matcher still yields the same three local candidates. The deployment instructional block now has no suggested type; it offers a companion exercise or practice review. The original three recommendations above remain proposals for Leon, not production edits. This does not fill the previously recorded full-live-course content-source gap.

The ASUS gate initially returned exit 75 because another run held its lock. No borrowed run or resource was stopped. Final ASUS results are recorded below when the requested two-mode gate completes.

Cleanup: QA harness PIDs 97514/97519 and its `csg_qa_97505_1794917651` database were cleaned; the shared preview tab was closed/released. Lifecycle session: `manual-20261117-221027-96840-d075`. Test/content databases are removed after verification. Shared Postgres is borrowed and remains running.

Interim integration check while the ASUS was occupied: full local API with OpenAPI coverage in both prepared-statement modes passed, 2,126 tests / 42,480 assertions per mode, zero failures/errors/skips. This supplements, rather than replaces, the requested ASUS run.

The first ASUS run used its reused `csg-learning-platform-c` mirror, which contained obsolete record-detail tests absent from this checkout. It ran 2,146 tests instead of 2,126, with failures on missing record-detail routes. The runner helper copies tracked files but does not remove obsolete ones in a reused Git mirror. A fresh secret-free source snapshot was therefore prepared at `/tmp/csg-submission-audit-asus.nx2yl97i`; its Ruby test inventory was compared with this checkout and matched exactly. The clean-snapshot run below is the required acceptance run; the contaminated mirror run is retained as failed runner evidence.

### Final additions requested by the lead

At `873b0357`, CI passed. The lead capped the CodeRabbit cycle after three new findings and one coverage addition:

- The review PATCH now documents HTTP 409 with a named `SubmissionAuditConflictResponse` schema containing the controller's exact stale-digest message. Both clients were regenerated. The existing stale-input integration flow now asserts the recovery body and explicit contract entry.
- The companion request ref is consumed immediately when an exercise is inserted, independently of draft hydration. The regression adds, saves, moves and reloads the lesson, checking seven blocks and a clean draft rather than an eighth unsaved companion.
- Audit lesson-editor/cohort links use the route registry and `URLSearchParams`. A test changes the registry helper bases and verifies both those bases and the preserved audit parameters.
- The mixed-cohort test additionally asserts `prework_github_sync` plus `manual_complete` with GitHub sync enabled; its disabled-sync text/manual assertion remains.

The clean ASUS source run on `873b0357` exposed a pre-existing time-dependent fixture in `StudentWorkspaceTest`: a synthetic one-hour booking created at 23:xx in the course zone crossed a course-week boundary. The fixture now uses noon in its config's saved zone; a late-night regression demonstrates the old failure. No booking validation or production scheduling code changed. The final-source gate rerun below includes this fixture repair and the lead's additions.

No more CodeRabbit review rounds are requested after these fixes. Residuals remain the explicitly deferred copy-review carry-over, repeat-review history, empty-day authoring toggle, pre-existing `tth` date shift, and full live-content seed coverage. Repository-wide OpenAPI security lint annotations are outside these targeted response-contract changes; admin-only API authorization remains enforced and tested.

Final local API integration checks passed in both prepared-statement modes with OpenAPI coverage: 2,127 tests / 42,484 assertions each, zero failures/errors/skips. Final web: 236 files / 2,647 tests; final mobile: 141 suites / 1,544 tests. All requested web/mobile static/build gates passed. Final browser rerun: 4/4 passed, with source progress/reviews/types unchanged and no companion draft saved. Its QA PIDs 15039/15049, shared preview tab and `csg_qa_14962_1794920836` database were cleaned.

The next ASUS prepared pass had one pre-existing post-copy override regression return `content_moved` (2,127 tests / 42,479 assertions, 1 failure). The same source's unprepared full pass succeeded (2,127 / 42,484). That routing test now explicitly starts its requests one second after the copy's database timestamp, making its intended post-copy phase independent of clock timing; the adjacent in-flight-write regression still verifies refusal. Focused copy/audit/workspace coverage passed in both modes: 48 tests / 353 assertions each. Production copy and enrollment guard logic is unchanged. A final complete-source ASUS rerun is used for acceptance below.

### Lead-directed integration with #290

Merged `origin/main` at `670dc8eb`. The only conflict was the overlapping private-meeting fixture helper. Kept main's exact comment and `(Time.current + offset.days).in_time_zone(config.timezone).change(hour: 10)` line, retaining this PR's late-night course-week regression. No production meeting/scheduling logic changed.

As directed by the lead, final integration verification is the focused API suite (submission audit, student workspace and the audit migration) with prepared statements enabled and disabled, plus web typecheck and affected tests. Both API modes passed **33 tests / 220 assertions**, zero failures/errors/skips. Web typecheck passed; the affected audit/editor/Content suites passed **66 tests**. Regenerating both API clients produced **no diff**: their SHA-256 hashes were identical before/after generation. All merge conflicts are resolved.

This lead-directed scope supersedes the pending full ASUS retry. The owned retry process 18052 was terminated while the runner was busy (exit-75 attempts); no other run was stopped. The temporary local source snapshot was removed, the focused test database dropped, and lifecycle session `manual-20261117-221027-96840-d075` has no active owned resources. Earlier ASUS failures/results above remain historical evidence, not a claim that the final merged head ran the full remote suite. CI passed all 12 checks on `1254b936`; the new merge head's CI is reported separately.
