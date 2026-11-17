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
