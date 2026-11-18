# Submission audit practice-only follow-up — November 18, 2026

Base: fresh `origin/main` at `9926b61c` (merged #309). Scope: ops task and tests; no normal editor behavior changes. The worker did not read production or `/tmp/sab-dryrun.txt` on the instance.

The lead reported a successful cutoff export of 99 blocks whose 82 library IDs match the approved audit, followed by 86 dry-run rows, 13 refusals and five skipped rows. Those are lead-provided production results. The six companion sources already have real submission exercises in their lessons. Under Leon's approved defaults, **356, 358, 1088, 1093, 1099 and 1101 are now practice-only**.

## Current behavior

The run now has 97 practice reviews (82 library plus 15 bootcamp), two existing-work type changes (57 and 700), no companions, and five deferred decisions. Dormant companion support remains covered by a test-only scenario overriding the private decision plan. There is no production option enabling companion decisions for this run.

Practice-only lessons bypass sibling projection entirely. They report `sibling_changes: []` and an unchanged before/after lesson flag, save only audit reviews, and never invoke `LessonBlockEditor`. A regression applies practice reviews to lessons with `requires_submission=true` and implicit submission exercises: blocks, lessons, timestamps and sibling types remain unchanged; rerunning is idempotent.

Only pending type/companion content changes project sibling impact. Both 57 and 700 have fixture cases showing no sibling changes, and cases refusing a type change when an implicit sibling would change from manual completion to text submission. Existing completion-preservation coverage remains. The lead reported these two production rows as dry-run OK; their full production sibling reports were not available locally. Confirm both still show no sibling changes on the next production dry run.

The existing successful 99-row export is accepted unchanged; no re-export is needed. The exporter's ID set still comes from `PRACTICE + TYPES + COMPANIONS`. Moving the six IDs leaves that union unchanged. A regression applies all 99 decisions using the unchanged baseline and checks the exporter still selects the same IDs. Cutoff, digest, learner-work and library-selection checks remain in force.

## Projection investigation

The ops projection used `ContentBlock.instantiate(original.attributes)`. `instantiate` expects raw database values, but `attributes` returns already-deserialized enum names. For integer-backed submission enums, an explicit value such as `repo_and_live_url_submission` is reinterpreted as integer zero (`manual_complete`). The projection reapplied `block_type` from its payload, but left unchanged submission types vulnerable to this conversion. This can manufacture a sibling type change even with a true/true lesson flag.

The projection now uses `dup` to preserve typed attributes, restoring original IDs for comparisons. A regression with an existing repository-and-live-URL sibling proves a true/true flag produces no sibling changes and applying preserves the sibling type. Practice-only lessons construct no projected blocks.

A genuinely nil submission type on an exercise with the same true flag resolves to text submission in the local reproduction, before and after projection. The summary alone does not establish that every reported production sibling had exactly those stored attributes; the full production report was not inspected. The reproduced enum conversion is an ops projection defect, not evidence that a normal editor save produced that true/true transition.

### Residual for a separate editor fix

The normal editor has a separate confirmed risk. `LessonBlockEditor#save_lesson!` chooses `Lesson#primary_assignment_block` and recalculates `requires_submission` when the primary has an explicit type. If that primary is `manual_complete`, saving sets a previously true flag false. A later exercise with a nil type then changes from text submission to manual completion through `ContentBlock#legacy_submission_type`.

A regression documents this existing service behavior directly: an unchanged save with a manual primary turns the true flag false and drops the sibling's effective requirement. This is a **true → false** flag transition, distinct from the reported true/true projection output. **Separate fix required:** prevent unacknowledged changes to legacy sibling requirements when the editor recalculates the primary assignment. Editor behavior is unchanged in this PR. Practice reviews avoid the editor; content edits retain the sibling guard.

## Lead dry run and apply

Reuse the successful export. Set `AUDIT_BASELINE` to its actual path and `ADMIN_USER_ID` to the approved admin ID:

```sh
cd /opt/render/project/src/api && ADMIN_USER_ID="${ADMIN_USER_ID:?set approved admin ID}" AUDIT_BASELINE="${AUDIT_BASELINE:?set existing successful export path}" DRY_RUN=1 APPLY=0 bin/rails ops:apply_submission_audit_20261118
```

Confirm 97 practice decisions, only the two approved type changes, no companions, empty sibling changes for practice-only lessons, and no sibling changes for 57/700. Retain any refusal for investigation. After reviewing:

```sh
cd /opt/render/project/src/api && ADMIN_USER_ID="${ADMIN_USER_ID:?set approved admin ID}" AUDIT_BASELINE="${AUDIT_BASELINE:?set existing successful export path}" DRY_RUN=0 APPLY=1 bin/rails ops:apply_submission_audit_20261118
```

## Local verification and cleanup

From `api/`, with `PARALLEL_WORKERS=1` and local database `csg_audit_practice_followup_test`, the following focused command passed with `prepared_statements=true` and `prepared_statements=false`: **131 tests / 635 assertions per mode**, zero failures/errors/skips. Both connection settings were explicitly queried.

```sh
bin/rails test test/lib/ops/apply_submission_audit_20261118_test.rb test/integration/lesson_block_editor_test.rb test/integration/submission_audit_recheck_test.rb test/integration/submission_audit_test.rb test/services/submission_audit_test.rb
```

RuboCop passed across **801 files**, with no offenses. The owned test database was dropped, and lifecycle session `manual-20261118-120948-51830-1e9a` reports no active owned resources. No browser, app server, simulator, container, remote runner or production connection was started. Shared Postgres is borrowed; the owned test database is dropped before handback. The follow-up PR is held for review and must not be merged by this worker.
