# Submission audit operations task — November 18, 2026

**Current decision update:** the six companion sources are now practice-only. Reuse the successful 99-row baseline. See [the practice follow-up](submission-audit-practice-followup-2026-11-18.md) for current behavior, investigation and commands. The #309 decision counts and companion smoke below are historical.

PR #309, branch `ops/apply-submission-audit`, based on `6c169d6d`. Execution owner: implementation worker on the Mac mini. No production access, merge or PR watch. This record supersedes the original baseline format and instructions on `98b232b4`.

CSG Learn shares curriculum → module → lesson → block content across cohorts. Changing an existing work block's submission type retains completion; adding work can reopen a completed lesson. Changing `lesson.requires_submission` can also change siblings' implicit submission types. Sources: the task brief, `SubmissionAudit`, `SubmissionAuditReview`, `LessonBlockEditor`, `LessonCompletionImpact`, `ContentBlock#legacy_submission_type`, and `docs/qa/submission-audit-2026-11-17.md`.

## Lead-only production runbook

Set `ADMIN_USER_ID` to the intended active admin's numeric ID. Archived admins and Clerk IDs starting with `pending_` are rejected. All production commands below belong to the lead after code review. The worker ran only disposable local databases.

First export a baseline with the approved cutoff:

```sh
cd /opt/render/project/src/api && CUTOFF=2026-11-17T14:56:00Z bin/rails ops:export_submission_audit_baseline > /tmp/submission-audit-baseline-20261118.json 2> /tmp/submission-audit-library-20261118.log
```

This task runs in a read-only, repeatable-read transaction. It selects the named library curriculum's audit candidates using `candidate?`, including rows already reviewed in the UI. It requires exactly 82 library candidates and refuses overlap with any fixed practice, type, companion or deferred ID. It exports those 82 plus the 17 fixed approved IDs, rather than using `SubmissionAudit.rows`, which omits valid reviews. The resulting 82 library IDs must equal the apply task's current curriculum selection.

Inspect the exit status and `/tmp/submission-audit-library-20261118.log`. It prints the full library ID list, count, titles and lesson titles for comparison with Leon's decision document. Confirm all 82 are approved. The exporter lists **every** selected block and lesson whose `updated_at` exceeds the cutoff, and all missing fixed blocks. A refused export exits 1 and emits an offenders report instead of a usable baseline. Do not increase the cutoff to bypass a refusal; obtain a new decision for changed content.

A successful stdout file has this format (extra title fields support review):

```text
{
  source: "production_export",
  exported_at: ISO-8601 timestamp,
  cutoff: ISO-8601 timestamp,
  library_ids: [82 selected IDs],
  blocks: [{id, title, lesson_id, lesson_title, curriculum_id, curriculum_name,
            content_digest, block_updated_at, lesson_updated_at}]
}
```

The file makes no claim to be an original `d68e0b3` export. The old `audit_commit` envelope is rejected. Apply checks each baseline timestamp against its cutoff, then rechecks current block/lesson timestamps and the digest before any pending decision writes. Structurally verified completed decisions are no-ops on reruns; the script's own editor writes may legitimately have newer timestamps. Keep the baseline outside source control.

After comparing the exported selection with Leon's decisions, dry run:

```sh
cd /opt/render/project/src/api && ADMIN_USER_ID="${ADMIN_USER_ID:?set the approved admin ID}" DRY_RUN=1 APPLY=0 AUDIT_BASELINE=/tmp/submission-audit-baseline-20261118.json bin/rails ops:apply_submission_audit_20261118
```

Inspect all rows, learner/cohort impact, companion titles/instructions, `lesson_impact.requires_submission.before/after`, and `lesson_impact.sibling_changes`. These are planned outcomes; a refused lesson does not commit its projected changes. Each changed sibling includes ID, title, approval status, before/after effective types (default and each using cohort), and before/after audit digests. A digest-only sibling change is reported; an unapproved sibling's effective type change refuses the whole lesson. Deferred W9 blocks are not approved for such changes.

After accepting the dry run, apply:

```sh
cd /opt/render/project/src/api && ADMIN_USER_ID="${ADMIN_USER_ID:?set the approved admin ID}" DRY_RUN=0 APPLY=1 AUDIT_BASELINE=/tmp/submission-audit-baseline-20261118.json bin/rails ops:apply_submission_audit_20261118
```

Without `APPLY=1`, the task is read-only. `DRY_RUN=1` overrides `APPLY=1`. Refusals exit 1; successful export, dry run, apply and idempotent rerun exit 0. Apply stdout contains JSON decision rows, a summary and a complete JSON report on its last line. Export stdout is one JSON object; its human comparison data and offenders also go to stderr.

## Write behavior and refusal rules

The task covers 99 approved decisions: 82 library practice reviews, nine bootcamp practice reviews, two existing-work submission changes and six companion exercises. Five W9 decisions are reported as deferred without writes. Global library membership or overlapping IDs refuse the whole run before any lesson writes.

Each lesson is locked and committed in its own transaction. A refusal leaves that entire lesson unchanged, while other valid lessons may apply. Practice-only lessons take `FOR NO KEY UPDATE` block locks. Content-editing lessons retain learner-exclusive locks while checking learner evidence. Statement and connection errors produce per-lesson refusals and a final report.

Content writes use `LessonBlockEditor`. Before writing, the task projects the editor's recalculation of `requires_submission` without saving anything. It refuses unapproved effective-type changes, then checks actual saved digests and the lesson flag against that projection before commit. Conflicting learner submissions refuse type changes. Nonzero `LessonCompletionImpact` refuses companions; the task never acknowledges reopening a completed lesson.

A companion source must be instructional, not an existing exercise, code challenge or checkpoint. Its title is `Exercise: <source title>`, falling back to `Exercise: Your work`; its body copies the source's body, matching the UI shortcut, with the UI fallback when blank. Both appear in the dry-run report. Adding the companion also records a reviewer-stamped practice review of the source's final digest, removing it from the audit queue.

Companion markers are searched across all lessons. A marked companion moved away from its source refuses the decision instead of creating a replacement. Reruns verify marker provenance, source content, companion title/body/type/placement and the source review. Expected editor changes to the legacy lesson flag are included in digest verification. No schema, model, service, controller, frontend or mobile behavior changed.

## Fix-round acceptance

The independent Opus review supplied by the lead covered `98b232b4`; it confirmed service writes, lock order, a no-write dry run, drift refusal, idempotency, completion preservation and byte-identical HTML siblings. It identified the issues addressed in this round. That prior review is not approval of this new head.

Agent-executed focused coverage includes the original decision/drift/completion cases plus overlap with all four fixed-decision groups; companion and type-change refusal for an implicit-type sibling; safe digest-only sibling changes with byte-identical HTML; copied companion preview and blank-title fallback; source audit dismissal; work-block refusal; a moved companion rerun; timestamp-only drift; post-cutoff baseline refusal; pending admin refusal; statement/connection-error reports; practice-only lock strength; reviewed-row export; full offender reporting; library-count/overlap refusal; and export → apply → post-cutoff idempotent rerun.

From `api/`, using a disposable local `DATABASE_URL` with `?prepared_statements=true` and then `?prepared_statements=false`, and `PARALLEL_WORKERS=1`:

```sh
bin/rails test test/lib/ops/apply_submission_audit_20261118_test.rb test/integration/lesson_block_editor_test.rb test/integration/submission_audit_recheck_test.rb test/integration/submission_audit_test.rb test/services/submission_audit_test.rb
```

Prepared statements enabled: **123 tests / 557 assertions**, zero failures/errors/skips. Disabled: **123 tests / 557 assertions**, zero failures/errors/skips. Both connection settings were explicitly queried. The first disabled-mode pass found a test-only instrumentation assumption about bound SQL values; the lock assertion now supports both bound and inlined SQL. RuboCop: **800 files, no offenses**. Brakeman: **zero errors and zero security warnings**, with one existing ignored warning.

The real CLI export → dry run → apply → rerun also passed in `csg_ops_apply_submission_audit_fix_qa`, using a synthetic 99-decision dataset with timestamps before the requested cutoff and an HTML sibling. Export produced 99 rows and 82 library IDs. Summaries:

```text
Summary: {"applied":0,"skipped":5,"refused":0,"dry_run":99,"already_applied":0}
Summary: {"applied":99,"skipped":5,"refused":0,"dry_run":0,"already_applied":0}
Summary: {"applied":0,"skipped":5,"refused":0,"dry_run":0,"already_applied":99}
```

All **86 tables** (84 application tables plus Rails metadata tables) were hashed before export and after dry run: both hashes were `c6b16bc9974f822a387b344be2189c9c07d73f1a515965c5ef682bfbc8d9ec71`. The hashes before/after the rerun also matched: `4964a2d1c6da889553a8c1783fdcd95f9fba2c1c0439bdb14fe69b662e19e057`. Summary data and a complete companion/sibling preview are in `apply-submission-audit-2026-11-18/fix-round-smoke.json`.

This synthetic smoke does not establish the real production membership or learner counts. The production-mirroring seed mentioned in the original brief remains unavailable here; the repository's ordinary QA seed is explicitly synthetic. The previous `qa-seed-*.txt` and hashes are historical refusal evidence for `98b232b4`, not current-baseline acceptance. The lead must inspect the real cutoff export and dry-run impact before production writes.

No full ASUS suite is required for this standalone script/test scope. Browser/mobile, production integrations and deployment behavior were not exercised.

## Cleanup and hold

Only disposable local databases were created. No app server, browser tab, simulator, emulator, container or ASUS job was started. Shared Postgres was already running and remains borrowed. Both task databases (`csg_ops_apply_submission_audit_fix_test` and `csg_ops_apply_submission_audit_fix_qa`) were dropped after final checks; lifecycle session `manual-20261118-113653-42739-3126` reports no active owned resources. The original checkout remains untouched. PR #309 remains held for lead review; the branch/worktree and updated local handoff are preserved. Final head, CI/review status and cleanup confirmation are reported at handback.
