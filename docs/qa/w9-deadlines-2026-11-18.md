# W9.2: per-student deadlines and extensions

Implementation base: `c1cff777` (#313), isolated branch `feat/w9-deadlines` in `/Users/agent/work/csg-w9-deadlines`. Agent-executed affected-flow QA, synthetic fixtures only. No production data or settings changed.

## Product and acceptance

CSG Learn serves Code School of Guam learners and their instructors. This slice adds individual submission deadlines while retaining the existing cohort windows for learners without personal pace or grants. Sources: the approved W9 design at `/Users/agent/work/csg-learn-w9-self-paced-design-2026-11-18.md` (deadlines and build plan), #313's body/residuals, `LearnerPace`, `LearnerProgress`, and `SubmissionWindowStatus` at the base commit.

Weekly personal-pace milestones are soft. The final project has one firm date. A staff grant can extend that final date, one lesson, or one module week; grant multiple scopes to cover both. A reason is required. Editing or removing a grant keeps its history. Plan revisions also record moved final dates and future milestones. Re-planning retains grants independently of the plan.

There is no new feature switch. Personal-pace behavior uses the existing nullable cohort setting. Extensions are absent until an authorized staff member grants one. The Off-cohort golden file was not regenerated. The parity test now also checks nil, future and closed cohort windows against enrollment-aware windows, lesson responses, and submit enforcement.

The workspace inherits existing operational UI styles, quiet feedback, labeled controls, error recovery, and mobile touch targets. Extension reasons appear in the grading queue; learners receive dates without staff reasons or history. API changes are additive and generated into web and mobile types.

## Browser acceptance

Harness: local Rails test mode and Vite, Chromium; `scripts/qa/w9-deadlines-fixtures.rb` and `scripts/qa/w9-deadlines.spec.ts`. Each test performs the following six cases. Four runs cover 390 and 1280 pixels in light and dark mode; all passed.

| Case | Starting condition, action, saved outcome | Result |
| --- | --- | --- |
| Staff grant | Cohort week closed; admin opens student workspace, chooses lesson, supplies Guam date and reason; saved confirmation appears | Passed |
| Learner date | Learner opens that lesson; effective 2030 deadline appears | Passed |
| Submit inside extension | Cohort window closed; learner enters an answer and submits; waiting-for-review state survives reload | Passed |
| No-extension refusal | Second learner opens same lesson; closed state appears; API submit returns 403 | Passed |
| Off-program learner | Existing program persona opens Today; pace UI remains absent; API golden parity separately verifies unchanged payloads | Passed |
| History | Staff expands saved extension history; reason is visible | Passed |

Both widths were checked for horizontal overflow. Browser contexts close after each case. Initial runs failed because the fixture used a CDN-backed code editor, then an incorrect rich-text locator. The synthetic fixture now uses a Markdown answer and the real rich-text input; the final runs pass without external network access.

Not run: WebKit/mobile Safari (unsupported on the mini), native device interactions. Native lesson deadline rendering was typechecked and covered by the existing Jest suite; resizing Chromium does not establish native behavior.

## Engineering verification

- Local affected API runs passed with prepared statements on and off, including effective windows, CRUD/history, authorization, final plan revisions and re-planning, module-week isolation, soft weekly milestones, Off parity, migration round trip and curriculum-copy remapping.
- Growing-fixture QueryCounter checks add four learners/submissions/grants and additional workspace grants; queue and workspace query counts stay flat. Existing personal-pace batch query test passes.
- Migration `20261119050000`: DDL and `SET LOCAL lock_timeout` share a transaction; no session settings or advisory locks. Migration tests clear every pooled connection's statement cache.
- Web typecheck, ESLint, Vitest (252 files, 3,499 tests), and production build passed locally. Both generated type files were regenerated with `npm run api:generate`.
- Mobile typecheck, lint, Jest (142 suites, 1,820 tests) passed locally.
- RuboCop: no offenses. Brakeman: no warnings (one existing ignored warning).
- Impeccable 4.6.0 advisory scan: `[]`, no findings.

Full final ASUS gate status is recorded below after execution. The first snapshot found test token/mocking mistakes and the curriculum-copy table inventory; those were fixed and covered by passing local regression runs. That superseded run is not final-head acceptance.

## Deployment and remaining verification

Additive migration; no data backfill. API deploy needs the migration. A production frontend build is expected because web UI and API types changed. No production deploy, merge or mobile distribution is performed by this task. PR review is left to the lead; no independent reviewer was delegated by the implementation worker.

Resource ownership: `dev-lifecycle` is unavailable on the mini. The harness ownership ledger records exact task-created Rails/Vite PIDs and the synthetic database; cleanup status is recorded below. The shared PostgreSQL service and other sessions' resources are borrowed and remain running.
