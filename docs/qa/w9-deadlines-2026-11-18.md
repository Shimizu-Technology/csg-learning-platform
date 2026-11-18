# W9.2: per-student deadlines and extensions

**Status: draft PR; full normal gate remains time-blocked.** PR: https://github.com/Shimizu-Technology/csg-learning-platform/pull/316. Implementation revision: `7239bb5b`. Base: `c1cff777` (#313). Branch: `feat/w9-deadlines`; worktree: `/Users/agent/work/csg-w9-deadlines`.

## Product and acceptance

CSG Learn serves Code School of Guam learners and instructors. Sources for this slice: the approved W9 design at `/Users/agent/work/csg-learn-w9-self-paced-design-2026-11-18.md` (deadlines/build plan), #313's body/residuals, and the base implementation of `LearnerPace`, `LearnerProgress`, and `SubmissionWindowStatus`.

Weekly personal-pace milestones are soft. The final project has one firm date. Staff can grant a final-date, lesson, or module-week extension with a required reason; multiple grants cover both final and specific windows. Every change/removal retains history. Final grants also move future plan milestones and write plan revisions. Re-plans keep the explicit extension date even when the newly chosen pace is longer.

There is no new feature switch. Personal pace uses the existing nullable cohort setting; extensions are absent until staff grant one. Learners receive effective dates without staff reasons/history. StaffCohortScope restricts grants, reads, edits and removals, with identical 404 bodies for authorization/lookup denials. LearnerProgress remains the status source. The queue and workspace batch grants; query fixtures grow by four additional learners/submissions plus additional workspace grants.

The extension form inherits existing operational styles, waits for history before accepting writes, offers reload after failure, and resets when the workspace changes learner. Extension reasons appear in the grading queue. The outline, Today, lesson and mobile responses use effective windows; web and mobile lesson views show dates. The Off-cohort golden file was not regenerated. Its parity test now also checks nil/future/closed windows, lesson responses, and submit enforcement. Workspace module assignments sort by module position then ID.

## Browser acceptance — passed

Agent-executed, synthetic fixtures only, local Rails test mode/Vite/Chromium. No production data or settings changed. `scripts/qa/w9-deadlines-fixtures.rb` and `scripts/qa/w9-deadlines.spec.ts` reproduce the cases. Browser code tested at `b30d9ff4`; web/mobile source is unchanged between `5ab5cd45` and `7239bb5b`.

Each test performs all six cases. Four passing runs cover 390/1280 pixels in light/dark mode (24 case/dimension observations).

| Case | Starting condition, action and observed outcome | Result |
| --- | --- | --- |
| Staff grant | Cohort week closed; admin chooses a lesson, enters Guam date/reason, saves and sees confirmation | Passed |
| Learner date | Learner opens that lesson and sees the effective 2030 date | Passed |
| Submission inside extension | Learner submits after the cohort close; waiting-for-review state persists after reload | Passed |
| No-extension refusal | Second learner sees the same lesson closed; API submit returns 403 | Passed |
| Off-program learner | Program persona opens Today without pace UI; separate API golden test verifies unchanged payloads | Passed |
| History | Staff expands the saved extension history and sees the reason | Passed |

Both widths were checked for horizontal overflow. Pages/browser contexts close after each test. Early browser runs used an unavailable CDN editor and then an incorrect locator; the final fixture uses the real Markdown rich-text input and passes with external requests blocked.

Not run: WebKit/mobile Safari (unsupported on this mini), native device interactions. Chromium resizing does not establish native behavior.

## Engineering results

| Gate | Revision/environment | Actual result |
| --- | --- | --- |
| Affected API, prepared on | `7239bb5b`, ASUS | **162 runs, 1,289 assertions, 0 failures/errors/skips** |
| Affected API, prepared off | `7239bb5b`, ASUS | **162 runs, 1,289 assertions, 0 failures/errors/skips** |
| Full API, prepared on | `5ab5cd45`, ASUS, normal validation | **2,391 runs, 44,606 assertions, 0 failures/errors, 1 skip**; OpenAPI inventory passed |
| Full API, prepared off | `5ab5cd45`, ASUS | **2,391 runs, 1 failure** in the existing post-copy request clock fixture; corrected at `68765e4f`, then retested in both final affected runs |
| Full final API/production migration bootstrap | `7239bb5b` | **Blocked/not complete** by the future timestamp window below; not represented as a passing full gate |
| Web typecheck, lint, Vitest, build, bundle/type checks | ASUS at `5ab5cd45`; client source unchanged at final code | Passed; 252 Vitest files, 3,499 tests |
| Mobile typecheck, lint, Jest | ASUS at `5ab5cd45`; client source unchanged at final code | Passed; 142 Jest suites, 1,820 tests |
| RuboCop, Brakeman | Final source, mini | Passed; 812 Ruby files, no offenses; no Brakeman warnings (one existing ignored warning) |
| Impeccable 4.6.0 | Changed web UI, mini | `[]`; no findings |

Final affected API checks cover extensions, personal pace, Off parity, cohort windows, copy/remapping, submissions/grading, migration round trip and OpenAPI contract. They disable only the migration timestamp check in their test processes because the requested timestamp is temporarily outside Rails' permitted window. The port adapter remains `127.0.0.1:55432` on ASUS; test databases are local/disposable. Application configuration was not changed.

The one standard full-suite skip is `TransactionPoolerCanaryTest`, which runs only in pooler CI legs. Migration round-trip tests clear statement caches across every pooled connection. The migration uses a transaction containing DDL and `SET LOCAL lock_timeout`; no session settings/advisory locks.

Other fixed findings: curriculum copies now remap extension targets/history; submission tests fetch the ID returned by their create response instead of an ambiguous timestamp order; the post-copy test explicitly advances its request clock; all declared extension responses and the input schema are exercised. Superseded/blocked runner jobs were stopped only through verified owned process trees; their wrappers cleaned the containers.

## Remaining gate and handoff to lead

The migration is **`20261119070000_create_learner_extensions.rb`**, per Leon's timestamp correction. All migration timestamps on this branch are unique. #315 owns `20261119050000_guard_github_app_operations.rb`; that file was not touched.

Rails accepts migration timestamps less than `Time.now.utc + 1.day`. At testing time on November 18, `20261119070000` was too far ahead. **After 07:00 UTC November 18 (17:00 Guam), normal validation accepts it. Use 07:01 UTC to avoid the equality boundary.** Normal local schema/test boot was observed rejecting this timestamp. A test-only override can exercise the migration and affected behavior, but the production-bootstrap process tests deliberately replace RUBYOPT and retain normal validation. Their two prepare cases remain time-blocked. No global/application workaround was added, and the blocked full run was stopped rather than called green.

Next actions, already within the task's authorization:

1. Verify this worktree/branch, the live PR head, `git status`, and the UTC clock. The final commit after `7239bb5b` is only this QA record.
2. After 07:01 UTC, run the **normal full gate without any timestamp override**:
   `asus-test --postgres csg_learning_platform_test /Users/agent/work/csg-w9-deadlines -- bash scripts/qa/w9-deadlines-gate.sh`.
   Run only one ASUS job at a time. Its scratch copy's obsolete `20261119050000_create_learner_extensions.rb` was removed by this worker; do not remove #315's distinct guard migration.
3. Rerun failed CI jobs after that time, address any genuine final-source failures, and obtain the repository's required review. PR remains draft; no independent review was delegated by this implementation worker. Do not merge/watch under this worker brief.
4. Record the full normal results and remove draft status only after the remaining gate is satisfied.

Deployment is not performed: additive API migration, no backfill. A frontend production build is expected because UI/generated types changed. No mobile distribution was attempted.

## Resource disposition

`dev-lifecycle` is unavailable on the mini, so exact ownership was tracked through the QA harness ledger and runner wrapper. Both local harness phases reported “Owned servers stopped and database dropped”; pages closed after each browser case. The separately named branch test database was dropped after verification. ASUS wrappers removed their disposable test containers and stopped their owned WSL sessions; temporary timestamp helpers were removed by EXIT traps. No runtime resources are handed off and no ownership is unresolved. The shared PostgreSQL service and unrelated resources remain running. The unmerged branch/worktree remain available for the lead.
