# Submitted GitHub revisions — X-6 slice 3

CSG Learn serves Code School of Guam students and staff through a Rails API,
React web app, and Expo app. This slice changes manual GitHub source sync only
when both the school `github_app` switch and the cohort's explicit opt-in are
On. All existing cohorts, including Lance's Cohort 3, remain Off.

Initial base: `origin/main` at `15f6214e` (#315), rebased onto `7b576d2a`
after #316 merged. The integrated capture guard honors effective learner
extensions and rechecks removal after provider I/O. Specification:
`Brain-Dump/code-school/csg-learn-x6-prework-grader-parity-2026-11-18.md`, sections
2–3 and slice 3. Relevant existing behavior is in `GithubSyncService`,
`GithubRepositoryAccess`, `Submission.latest_attempts`, `SubmissionsController#grade`,
and the grading workbench's attempt history. No production deployment, student
data, cohort setting, or provider account was inspected or changed.

## Behavior and storage

- Resolve the default branch once, then fetch the configured files at that exact
  SHA through the GitHub App client. Numeric repository identity is checked on
  both source queries. Truncated, non-UTF-8 or byte-count-mismatched responses
  are refused, using the provider's `isTruncated` and `byteSize` fields
  ([GitHub Blob reference](https://docs.github.com/en/graphql/reference/git#blob)).
- Reuse Submission attempts as revisions. A changed file creates an ungraded
  attempt with its own source, SHA, branch, commit-specific URL, SHA-256 digest,
  path, capture time, binding ID and numeric repository ID. The repository name
  is retained as a snapshot so rebinding or deleting a connection cannot change
  historical provenance.
- Retain full UTF-8 source in `submissions.text`, capped at 256 KiB per exercise.
  Oversized source returns an error and imports no revision for that exercise;
  it is never silently truncated. The plan does not prescribe a numeric limit.
  Captured source and provenance remain with the attempt under its existing
  lifecycle; this slice adds no automatic expiry or history purge.
- Identical source creates no attempt and changes no submitted SHA, URL, grade,
  timestamp, or latest-seen metadata. Existing historical rows are never
  backfilled or relabeled as captured evidence.
- Preserve earlier grades, feedback, rubric results and issue URLs on their
  original attempts. The existing latest-attempt rule still rejects grading an
  earlier attempt with 409. Source fields on captured attempts reject ordinary
  model/API edits while grading and issue metadata remain writable.
- Recheck enrollment, switches, repository generation, exercise configuration
  and submission windows after provider I/O. Enrollment locks serialize import
  and grading; block locks preserve the curriculum-copy/write rules.
  Effective binding selection is resolved again under that lock, including a
  newly inserted module override; identical-timestamp rebinds must still be
  verified and match the original repository.
- New attempt timestamps never sort before the previous attempt, even after a
  backward wall-clock step. Equal timestamps use the existing ID tie-breaker;
  provenance retains the actual capture clock separately.
- Staff see the short SHA and capture time above the source, and revision SHA,
  time and grade in attempt history. A historical row without captured evidence
  is identified in a captured attempt's history. The optional staff-only
  `github_revision` API field is documented and both generated type files match.

The migration adds one nullable JSONB column with no default and no backfill.
It uses the existing transaction-local lock timeout pattern. Migration tests
clear every pooled connection cache and reset Submission's column information;
the existing pooler adapter handles the prepared migration leg.

## Acceptance and execution

Agent-executed affected-flow QA used the loopback-only harness, a new owned
`csg_qa_…` database, synthetic instructors/students, and the fake provider at the
App client boundary. A local fixture file simulates source changes and commits.
External HTTP remains blocked. Setup/reset additionally require the current
harness's database ownership record; refusal without that record was verified.
The Off fixture uses the legacy boundary with
synthetic source and a synthetic token-presence check.

| Required scenario | 1280 light/dark | 390 light/dark | Saved outcome |
| --- | --- | --- | --- |
| Sync source and grade it | Passed | Passed | SHA `aaaa…`, source and B feedback persist |
| Change source and sync | Passed | Passed | Attempt 2 awaits review; attempt 1 retains B and feedback |
| Read and navigate history | Passed | Passed | Prior SHA/time/grade and feedback readable; earlier grade controls disabled |
| Grade attempt 2, then sync identical content at a new SHA | Passed | Passed | Attempt 2 retains C, SHA `bbbb…`, source, capture time and updated_at; two rows remain |
| Off cohort regression | Passed | Passed | One legacy row, retained B/feedback, count increments only for changed content, SHA moves on identical source; no revision field or UI |

Both combined scenarios (R01 revision flow and R02 Off regression) passed all
four required viewport/theme dimensions: eight required case/dimension combinations.
The full eight-execution matrix passed again after integration with #316.
Screenshots and API outcome ledgers are
under ignored `.qa-local/github-submitted-revisions/`; the reproducible fixture
and spec are committed under `scripts/qa/`. Initial browser test failures were
locator/readiness mistakes (hidden phone feedback control before loading and
ambiguous text), corrected before the passing matrix. No product defect was
observed in those failures. These Chromium runs used browser pointer input and
simulated editor input. Browser resizing does not establish native Expo,
Safari, real Clerk, GitHub delivery, or actual push behavior.

Automated coverage includes changed A/B/C/R, identical source/new SHA, historical
rows, empty/oversized/truncated source, latest-attempt ties/backward clock steps, concurrent sync/grade and
duplicate sync, paused enrollment, closed window, changed binding/filename/gate,
curriculum copy, superseded grading, role/scoping contracts, and additive
migration up/down with a real historical graded row. QueryCounter fixtures grow
from 1 to 20 genuine attempts: sync, history and queue query counts stay flat.
The Off update uses 20 logical queries, matching the same fixture run against
the unmodified `origin/main` service at `7b576d2a`; it emits no binding,
installation or revision query and keeps the legacy HTTP/response assertions.

## Engineering gate

- Pre-integration focused Rails revision/App/migration tests pass locally in both
  prepared modes (40 tests, 447 assertions). They include immutable evidence,
  rollback-safe ordering, effective-binding races and curriculum scope.
- Full API attempts on ASUS exposed time-sensitive failures in the existing
  rate-limit reset, completed-enrollment announcement read, and curriculum-copy
  stale-write tests. A separate Python wall/monotonic-clock sampler measured a
  **1.314528-second backward wall-clock step** at **2026-11-18 09:01:27 UTC**.
  Earlier full runs passed in both modes, but these inconsistent runs are not
  used as the final gate. ASUS configuration was left unchanged. A temporary
  rate-limit test clock change was removed from this branch.
- The old-SHA ordering failure in the new revision flow was reproduced by an
  explicit backward-clock test (failed before the fix, passed after). New
  attempts now remain latest without altering the prior row. The full API gate
  passed before integration in both modes (2,474 tests, 45,429 assertions).
  After #316, both full modes passed again: **2,510 tests, 45,613 assertions,
  zero failures/errors** per mode (seeds 46774/56734). The one skip is the
  transaction-pooler canary, reserved for the PR's pooler CI legs. Both local
  runs used an owned database, removed provider credentials and a
  wall/monotonic-clock monitor; no clock steps were detected.
- Web lint, typecheck, all Vitest tests (255 files, 3,523 tests), production
  build, API twin check, bundle check, and Netlify routing checks passed locally.
  An unchanged ContentManagement focus-restoration test failed in a concurrent
  run; the complete rerun with two workers passed. Existing jsdom navigation
  diagnostic output was non-failing. The staff review
  test file includes the empty captured-file state.
- Mobile typecheck, lint and Jest passed locally after integration (142 suites,
  1,822 tests), as did brand, URI and release-tool checks. ASUS was occupied
  for this rerun; the earlier pre-integration mobile gate passed there. Both generated API type files match.
- RuboCop passed on the integrated source (853 files, no offenses). Brakeman
  passed with zero warnings/errors and one existing ignored warning.
- Impeccable 4.6.0 advisory scan of `SubmissionReviewPanel.tsx`: no findings (`[]`).

No check evaluation, grade suggestion, webhook, scheduled reconcile, issue
delivery redesign, or native revision controls are included. Existing Expo
clients tolerate the additive optional field; native acceptance is not claimed.

## Release and cleanup

Leon paused CSG Learn work after the gates completed. At the lead's explicit
request, the finished work is committed locally on `feat/github-submitted-revisions`.
It is not pushed, has no PR, and must not be resumed until Leon authorizes it.
The worktree remains in place as a named handoff to the lead. A production
frontend build is expected when eventually released because the staff review
component changed; no production release is part of this task.

Migration: `20261119080100_preserve_github_submitted_revisions.rb`, later than
integrated main's `20261119080000`. The original 12-hour commit-window wait was
cancelled by the lead, who explicitly authorized this timestamp for the local
commit. Do not infer a push, PR or rollout authorization from that exception.
The migration is additive, with no backfill; the transaction-pooler CI legs and
PR review remain for the lead when work resumes.

Integration QA used a freshly restarted harness so the post-I/O and extension
guards were loaded. Task-owned browser pages and harness processes were closed,
and owned QA/test databases were dropped. Task-created web/mobile dependencies
and build output were removed. Lifecycle status reports no active owned resources. Shared PostgreSQL, PgBouncer, Redis, the
existing simulator, and other baseline services are borrowed and remain untouched.
