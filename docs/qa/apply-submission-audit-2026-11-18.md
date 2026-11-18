# Submission audit operations task — November 18, 2026

Implementation base: `6c169d6d`, `origin/main`. Execution owner: implementation worker on the Mac mini. Production was never accessed. Hold for lead review and the missing content-baseline acceptance below.

CSG Learn shares curriculum → module → lesson → block content across cohorts. Students retain recorded completion when an existing work block gains a submission type; adding new work can reopen a completed lesson. Sources: the task brief, `SubmissionAudit`, `SubmissionAuditReview`, `LessonBlockEditor`, `LessonCompletionImpact`, and `docs/qa/submission-audit-2026-11-17.md`.

## Runbook

Task: `ops:apply_submission_audit_20261118`. It applies 99 decisions: 82 library practice reviews selected by curriculum, nine bootcamp practice reviews, two existing-work submission changes, and six companion exercises. Five W9 decisions are reported as deferred and never changed.

Supply `ADMIN_USER_ID` and `AUDIT_BASELINE`. The baseline must be the original audit export from `d68e0b3`, with this envelope:

```json
{
  "audit_commit": "d68e0b3",
  "blocks": [
    {
      "id": 57,
      "lesson_id": "original audited lesson ID",
      "curriculum_id": "original audited curriculum ID",
      "curriculum_name": "original audited curriculum name",
      "content_digest": "original 64-character SHA-256 digest"
    }
  ]
}
```

The example documents the format, not runnable baseline data. Preserve all 82 library rows and the 17 other approved rows. A complete original audit export may include other rows; these remain untouched. Do not generate replacement digests from today's production content: that would erase drift evidence. Keep the baseline outside source control and have the lead review its provenance.

The lead runs these commands only after review, with the approved baseline installed at `/tmp/submission-audit-d68e0b3.json` and `ADMIN_USER_ID` exported to the intended admin's numeric ID:

```sh
cd /opt/render/project/src/api && DRY_RUN=1 APPLY=0 AUDIT_BASELINE=/tmp/submission-audit-d68e0b3.json bin/rails ops:apply_submission_audit_20261118
```

Inspect every row and its cohort/learner impact. Then, after the dry run is accepted:

```sh
cd /opt/render/project/src/api && DRY_RUN=0 APPLY=1 AUDIT_BASELINE=/tmp/submission-audit-d68e0b3.json bin/rails ops:apply_submission_audit_20261118
```

Without `APPLY=1`, the task is read-only. `DRY_RUN=1` overrides `APPLY=1`. Refusals return exit status 1; successful dry runs, applies and idempotent reruns return 0. Stdout contains JSON decision rows, a summary, then a complete JSON report on the last stdout line. Diagnostics go to stderr. Counts distinguish `applied`, `dry_run`, `already_applied`, `skipped` and `refused`.

Each row includes source context, current type/digest, intended change, source-block completed learners, canonical completed-lesson impact, and all using cohorts. The latter includes cohorts with no completed learners, so Cohort 3 remains visible even when nobody has finished that lesson. Completion impact uses `LessonCompletionImpact`; a nonzero count refuses companions and never submits a reopen acknowledgement.

The task locks each lesson and its blocks, validates all that lesson's decisions, and commits one transaction per lesson. A refused decision leaves that whole lesson unchanged; other valid lessons may still apply. Fix drift by obtaining a new explicit decision, not by editing the baseline to match current data. A rerun skips completed decisions and retries unapplied ones. Existing work with a conflicting effective submission type refuses the type change under the same block locks used by learner writes. Content changes go through `LessonBlockEditor`; practice reviews use the same model/digest update as the audit controller.

New exercises carry a source ID and original digest in metadata for idempotency. Reruns verify their type, instructions, title, placement, source digest and lesson submission flag. For already-applied changes, digest verification reconstructs only the permitted original submission state and legacy lesson flag and compares the exact SHA-256. This accounts for the editor updating `requires_submission`, including multiple decisions sharing a lesson. No database schema or application behavior changes.

## Agent-executed acceptance

Required focused scenarios passed locally: all three decision types, 82 curriculum-selected practice reviews, dry run with unchanged records/timestamps, explicit apply, `DRY_RUN` overriding apply, idempotent rerun, changed source refusal, changed companion refusal, missing baseline/moved block refusal, unexpected library candidate refusal, conflicting submissions, completed-lesson refusal with Cohort 3 impact, existing completion preservation, shared-lesson idempotency, and shared-lesson rollback.

Focused command (run from `api/` with a disposable local `DATABASE_URL` and `PARALLEL_WORKERS=1`):

```sh
bin/rails test test/lib/ops/apply_submission_audit_20261118_test.rb test/integration/lesson_block_editor_test.rb test/integration/submission_audit_recheck_test.rb test/integration/submission_audit_test.rb test/services/submission_audit_test.rb
```

Prepared statements enabled: connection reported `true`; 100 tests / 429 assertions, zero failures/errors/skips. Disabled: connection reported `false`; 100 tests / 429 assertions, zero failures/errors/skips. RuboCop passed across 799 files; Brakeman reported zero errors and zero security warnings (one existing ignored warning).

The full ASUS suite is not required by this task's standalone-script scope. No app service, controller, model, schema, frontend or mobile file changed. Browser/mobile and production provider checks are outside this CLI change.

## Missing production-mirroring seed and original audit baseline

The checked-in `scripts/qa/seed.rb` creates `QA Program Lab`, `QA Self Paced Lab`, and `QA Alumni Lab` with synthetic content. `docs/qa/README.md` explicitly says historical production-curriculum seeds must not be reused. Neither that seed nor the dated audit document contains the original 99 production digests. The brief's production-mirroring seed was not found in this checkout. The worker requested the original audit artifact; it has not been supplied.

Both modes were executed against the actual repository QA seed in the disposable local database `csg_qa_ops_apply_audit`. An explicitly empty baseline envelope was used to verify fail-closed behavior; this is not evidence of applying real approved content. Dry run returned exit 1:

```text
Summary: {"applied":0,"skipped":0,"refused":1,"dry_run":0,"already_applied":0}
```

```json
{"apply":false,"counts":{"applied":0,"skipped":0,"refused":1,"dry_run":0,"already_applied":0},"blocks":[{"status":"refused","reason":"baseline must contain exactly 82 library blocks; curriculum must be unique"}]}
```

Apply returned exit 1 with the same refusal and `"apply":true`. Full output is in `apply-submission-audit-2026-11-18/qa-seed-dry-run.txt` and `qa-seed-apply.txt`. The combined SHA-256 over blocks, lessons and audit reviews before/after both runs is unchanged: `760f98ce4c3bc342ce4b6069b1dd567554440401b3db63d082cb535f72d37cbe`.

**Blocked required acceptance:** a successful dry run and apply against the production-mirroring content seed. The synthetic tests pass, but they cannot establish the original production candidate membership or digests. Keep the PR draft until the lead supplies the original baseline and an authorized local seed, reruns both modes, inspects the real impact report, and records the result. No production command was executed by this worker.

## Resource disposition

Only disposable local databases were created. No app server, browser tab, simulator, emulator, container, or remote runner was started. Shared Postgres was already running and remains borrowed. The original checkout was restored clean after moving task-owned untracked files into the worktree. Cleanup and final PR/head status are recorded in the handoff.
