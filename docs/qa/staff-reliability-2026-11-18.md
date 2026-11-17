# Staff reliability — November 18, 2026

Implementation source: `800d94bd` (API/web acceptance on `4245ee8f`; native refusal wording verified on the final source; includes `ed834928` for flat snapshot capture and `5c230eb1` for bound remapping/notification validation) on `fix/staff-reliability`, based on main `08236d2e` (#300). Agent-executed affected-flow QA; synthetic local data only. No production data, migrations, provider sends, deployments, merge or PR watch.

## Context and acceptance

CSG Learn serves students, instructors and admins. Staff author lessons and rubrics, customize personal plans, answer help requests and schedule updates. Students must retain readable paused history and never see a draft or scheduled update before publication. Staff surfaces must use the same attention reasons, with readable names and explanations on phones and desktop.

Sources: repository `AGENTS.md`, `docs/PRODUCT_VISION.md`, `scripts/qa/README.md`, existing editor/attention/paused-access QA records, current projections and access rules, #222's complete PR body and #299's PR body. The Brain Dump audit is unavailable on this Mac mini; the full U-0.14 backlog wording could not be verified. The task explicitly permits the PR-history fallback. Installed skills resolve to the matching canonical `~/Shared-Guidance/skills` files.

Required acceptance: all lesson exit paths warn or preserve text; other staff editors retain or warn about edits; resolving help leaves other attention reasons intact and visible; the manual-complete filename is honest with On and unchanged with Off; module/cohort schedule edits preserve the paused library; a refused scheduled update tells its author and remains visibly unsent in Drafts. Students remain denied; publication locking and push-outbox behavior remain covered; API changes are additive and both clients' types regenerate.

## Reproduction and changes

| Item | Baseline evidence | Result |
| --- | --- | --- |
| U-0.6 | Main already had lesson backups, the router blocker and unload protection (#267). Existing leave/save/restore tests passed. Browser checks also exposed a second-exit race after Keep editing. Update Cancel changed `?edit=1` without hitting its path-only guard. Plan Cancel directly closed its draft. New rubric text lived outside the lesson draft and was lost on inspector changes. | Observe each blocker instance; guard update query exits and plan Cancel/tab changes. Hold unfinished rubrics in the lesson editor, keyed by block, with a leave/unload guard. Leave dialogs render above the phone Settings inspector so its record-link warning can actually be answered. Phone inspector closure and tab/block changes retain them. |
| U-0.7 | Main's `AttentionProjectionTest` already resolves help and checks inactivity across support scopes, dashboard and cohort home. Its shared projection remains the source of truth. Browser QA found the cohort attention row at 1280px squeezed the learner/reasons column to **0px** beside its buttons. | Let actions wrap in narrow cards. The same reason now has **230px** of width in that card. No duplicate attention calculation was added. |
| U-0.12 | The renderer showed an unlabeled `practice.rb` chip with manual completion and no submission editor. The new reference-copy test fails against main's renderer and passes against this implementation (explicit negative/positive control). | Extracted `ManualCompleteBlock` shows “Exercise file” and “Work in your own editor. Nothing to upload here.” with On. Off retains the existing filename chip and completion copy. |
| U-0.14 | New regression failed on main's availability logic: moving a module date to release a later lesson advanced the whole-module timestamp and hid an earlier paused lesson. | Capture readable lesson IDs with the pause cutoff. Later cohort/module/lesson scheduling cannot expand or shrink that frozen set. Archive, enrollment expiry, assignment containment and authorization still apply. Resume clears it. Curriculum copying remaps the IDs in one statement. |
| #299 | Publisher explicitly returned a refused schedule to an unscheduled draft with no author notification. Removing the teaching assignment also excluded it from the author's Manage list. | Atomically record `schedule_failure` and one author system notification in the existing row-lock transaction. The author can read their failed draft even after removal; editing/posting still requires cohort access. Notifications and Drafts show the reason; native draft cards and detail show it through their existing status/date line. Reschedule/publication clears the refusal notice so it cannot consume the normal notification's unique source key. |

**Already done on main:** the basic lesson exit/backups flow, the basic plan leave guard, shared server attention calculations and help-resolution inactivity retention. Tests prove these existing pieces; no entire backlog item is marked already done because remaining gaps were reproduced and fixed.

## Browser acceptance

Final uninterrupted run: **8 cases passed in both required dimensions, 16/16 viewport runs**, Chromium at 1280×844 and 390×844, one worker. `scripts/qa/staff-reliability.spec.ts`, with its prepared synthetic fixture; local harness API/Vite, Clerk stub and external requests blocked.

| Case | Visible and persisted/downstream outcome | 1280 / 390 |
| --- | --- | --- |
| B1 Lesson exits | Type instructions; Back, a visible record link (the phone Settings inspector or desktop breadcrumb) and browser Back ask; Keep editing retains text. Native tab-close request asks and can be dismissed. Native reload asks; accepting reload and restoring backup returns the exact text. Address-bar lesson switching warns/preserves a backup. Explicit Discard leaves. | Passed / Passed |
| B2 Manual filename | On shows the exercise-reference copy and no Submit; Off retains chip/copy. No horizontal overflow. | Passed / Passed |
| B3 Paused history | Paused learner reads the earlier lesson, cannot complete it; actual API module override and cohort start-date changes to 2035 preserve that visible lesson after reload. Later lesson remains denied. Synthetic dates reset afterward. | Passed / Passed |
| B4 Help resolution | Staff replies and resolves through the request page; Support, student workspace and cohort workspace retain the visible inactivity reason. Staff Today shows no remaining Help requests chip after the final request resolves, and its API retains the inactivity reason. | Passed / Passed |
| B5 Update Cancel | Unsaved title triggers the query-exit question. Keep retains it; Discard closes editing. Reading the saved update through the API confirms its original title. | Passed / Passed |
| B6 Plan Cancel | Personal-plan title survives Keep editing; only explicit Discard closes the draft. | Passed / Passed |
| B7 Rubric | Unfinished rubric survives inspector tab changes; phone close/reopen retains it. Leaving asks explicitly. | Passed / Passed |
| B8 Refused update | Removed instructor sees the refusal in Notifications and Manage › Drafts. Student detail request returns 404. | Passed / Passed |

Selected screenshots: [desktop attention](staff-reliability-2026-11-18/help-chromium-1280.png), [phone lesson draft](staff-reliability-2026-11-18/lesson-chromium-390.png), [manual On](staff-reliability-2026-11-18/manual-on-chromium-390.png), [manual Off](staff-reliability-2026-11-18/manual-off-chromium-390.png), [paused lesson](staff-reliability-2026-11-18/paused-chromium-390.png). They accompany interaction assertions; screenshots alone are not acceptance.

Initial failures are retained in the local traces/logs: incorrect API base paths and a nested test locator were repaired; the real 0px attention column and blocker race were fixed. Retesting the visible phone record link then exposed a leave dialog beneath Settings; moving the leave dialogs last in DOM order fixed pointer/focus access, and the entire 16-run matrix passed again. One combined attempt was invalidated by type generation triggering a page reload while a leave question was open (trace records beforeunload); the final 16/16 run happened after generation completed. Native keyboard/device behavior, installed PWA, Safari/WebKit, live Clerk and actual notification/push delivery were not tested. The real browser close/reload prompts above were Chromium automation, not native-mobile certification.

## Engineering gates

| Gate | Result |
| --- | --- |
| Full API on ASUS, prepared on/off | Prepared on: **2,229 runs / 43,289 assertions, 0 failures, 0 errors, 1 existing skip**, seed 32470. Unprepared: **2,229 runs / 43,289 assertions, 0 failures, 0 errors, 1 existing skip**, seed 47443. **771 RuboCop files clean; Brakeman 0 warnings; gate exit 0.** No test exclusions; unchanged migration-process port adapter. |
| Focused pause/search/assignment | 57 runs / 364 assertions passed after cutoff-compatibility fix. |
| Publisher/races/migration/progress | 50 runs / 487 assertions passed, including repeated refusal, reschedule, post and normal notification recovery. The final follow-up also passed 66 tests / 560 assertions in both modes, adds failed-draft list cardinality coverage, and verifies validation alone never deletes the stored notice. |
| Curriculum copy | 33 runs / 198 assertions passed, including paused-library ID remapping. |
| Migration | Unique `20261118060000`, later than main's latest `050000`. Additive nullable fields; explicit transaction with `SET LOCAL lock_timeout`; locked, idempotent backfill preserves pause/update timestamps. Down/up/repeated-up test clears every pool's caches and resets model columns. |
| Snapshot/query follow-up | **92 tests / 574 assertions passed in each statement mode**. A new capture-cardinality regression reproduced 11 → 47 queries with 1 → 5 modules before preloading. The final method preloads schedules, modules/lessons and assignments and uses `LessonReadAccess`; the counts are now equal. |
| Query counts / publication boundaries | Existing full-suite cardinality, row-lock race, rollback, retry, outbox and student invisibility regressions retained. Snapshot reads add no per-lesson query; curriculum snapshot remapping uses one UPDATE. |
| Web final gate | Typecheck, ESLint, **243 files / 2,869 Vitest tests**, Netlify/service-worker checks, API contract/type check, build and initial-bundle check passed. Two Vitest workers to fit the mini. |
| API types | `npm run api:generate` regenerated web and mobile. Added nullable `schedule_failure`; existing fields and requests remain compatible. |
| Mobile | Typecheck passed; lint 0 errors / 74 warnings; **142 suites / 1,549 tests passed**. The additive transport field is also displayed on native draft cards and detail through the existing date/status line. A rendered-screen test covers both locations and denied editing; native devices were not run. |
| Impeccable 4.6.0 | Advisory `[]` for changed editor/renderer screens. |

The one API skip is the repository's transaction-pooler CI canary (`POOLER_CANARY` is not enabled by the requested direct-Postgres ASUS gate). Prepared-statement behavior was asserted explicitly before each full run. The initial pre-correction ASUS run failed five cutoff-compatibility cases in both modes; a later all-green API run was blocked by Brakeman flagging interpolated copy SQL. That SQL now uses a bound JSON map, and Brakeman reports 0 warnings locally. A final full run covers the correction and flat-query follow-up; those failures are superseded only by the final run's results, not hidden or excluded.

## Limits, rollout and disposition

The backfill preserves the set readable at migration time. It cannot reconstruct lessons already hidden by an earlier historical date edit; no dates or historical pause times are invented. A snapshot is tied to its exact stored pause cutoff; changed/legacy cutoffs fall back to the existing conservative rules. New pauses capture a fresh set, and resume removes it. Active learner release dates are untouched. A removed instructor may read the failed draft but cannot send or edit in an unauthorized cohort; an admin can restore/reassign it.

The unavailable Brain Dump's other U-0.14 bullets remain unverified; this change covers the reproduced module-timestamp defect, cohort start dates and subsequent schedule changes. No claim of a complete historical audit is made.

Deployment requires the new migration before the updated API; no production action was taken. PR is held for lead review: do not merge or watch. Source worktree is retained at `/Users/agent/work/csg-staff-reliability`. Resource cleanup and final ASUS results are recorded below before handback.

Local resource cleanup: all owned harness servers and synthetic databases were removed; the preview tab and every Playwright page were closed. Lifecycle reports no active owned resources or runtime handoffs. The protected local PostgreSQL service was borrowed and remains running. The final ASUS wrapper exited successfully after its exact temporary-container cleanup and released the runner lock; no remote runtime handoff remains.

Setup: the requested `~/work/csg-backend-hardening` worktree was absent; no unrelated worktree or shared checkout was removed or changed.


## PR #302 review fix round

Source: `7f53729d`, on merged main `53c5ddcb` (merge `309e0d0e`). Independent Opus review covered the earlier `ae63c92a`; it is not approval of this fix commit. No production access or changes were made.

- Reproduced the dated paused-module regression with the reviewer’s integration test. One shared module-read gate now serves module show, video, lesson access, search and activity destinations. Dashboard/progress metadata agree. Frozen lesson membership still excludes archives, expired enrollments and assignments created after the pause; active release dates remain unchanged. The other `accessible?` callers are calendar calculations, staff counts or active-only writes/help requests.
- Rows paused by an older API without a snapshot capture it under the enrollment lock on first read. Calendar-changing model callbacks capture missing snapshots from persisted dates before editing them, including cohort start dates and new module overrides. This closes the rollout gap without a second migration or changing release dates. Historical content already hidden by old-API edits cannot be reconstructed from current dates; the separate production investigation remains with Leon.
- Pause updates reload under the existing learning-write guard before computing the snapshot. An HTTP race regression performs a cohort copy after request start, receives 409, then verifies a fresh pause stores only copied lesson IDs.
- Deleting/replacing blocks prunes rubric drafts; dirty checks consider existing blocks. Save clears the deleted block warning while remaining drafts stay protected. Rubric-create responses preserve text typed after the request started. A combined lesson/rubric departure uses one dialog.
- Authors can delete their own refused drafts on web/mobile and through the API; editing, posting and rescheduling remain denied. Tests cover detail access, denied mutations, colleague denial and author deletion. The publisher and exactly-once transaction remain unchanged.
- Manual-complete On copy contains the filename once and one upload/completion explanation. Off UI stays unchanged. Enrolled-student privacy now has a published control. Fixture dates restore in `finally`; attention actions are checked at 390 and 700px.

Final focused API: **99 tests / 821 assertions passed in each statement mode**, plus the earlier expanded **150 / 1,340** in each mode. The final focused set includes the #303 move-cutoff and activity-cardinality tests. The first full ASUS run exposed both interactions; the fixes retain assignment creation cutoffs and reuse the activity feed’s already-preloaded cohort schedules. An initial local parallel test launch hit the Mac pg/fork crash; it was stopped and the tests reran with one worker.

Web: ESLint, typecheck, **244 files / 2,896 tests**, contract checks, Netlify/service-worker checks, production build and bundle gate passed. Mobile: full `npm run check`, **142 suites / 1,552 tests** passed; lint has the existing warnings. `api:generate` regenerated both type files without a diff. Impeccable 4.6.0 advisory returned `[]`.

Browser: Chromium, local synthetic fixtures and stub auth; 390×844 and 1280×844. The 20-run matrix passed after waiting for save settlement before sampling beforeunload. It covers dated (`unlocked: false`) paused modules on both On and Off: module page, lesson and video authorization after module/cohort postponement, with later lessons denied and dates restored. Deleted-block save removes its warning and remaining rubric drafts still prompt. The sm action test runs at 390 and 700; its 1280 project entry is intentionally a no-op. A final-source rerun and full ASUS result are recorded below.

Video QA checks authorization and a synthetic presigned URL; it does not certify S3 playback. Native devices, Safari/WebKit, live Clerk/push and production deployment remain not run. Basic backups/blockers and shared attention projection were already present as recorded above; this round keeps them and fixes the review findings.

Final-source Chromium rerun: **20/20 entries passed in 53.5s** at the required dimensions, including the additional 700px action check. Owned QA servers and database were removed; the shared preview tab was closed. The obsolete ASUS run completed its prepared pass with the two #303 interactions above, then was stopped during unprepared mode after both had passed focused retests; its interrupted results are not acceptance.

Final source ASUS prepared mode: **2,250 tests / 43,449 assertions; 0 failures, 0 errors, 1 existing pooler-canary skip**. The migration subprocess port adapter is unchanged.

Final source ASUS unprepared mode: **2,250 tests / 43,449 assertions; 0 failures, 0 errors, 1 existing pooler-canary skip**. **778 RuboCop files clean; Brakeman 0 warnings; gate exit 0**. Both full runs used `7f53729d`, one job at a time. The wrapper removed its disposable Postgres and stopped WSL. The local test database was dropped; lifecycle cleanup/status reports **no active owned resources**. Borrowed local Postgres remains untouched. All eight CodeRabbit inline threads received replies citing the fix commit; the outside-diff Inspector finding received a separate PR comment. New-head review is not claimed complete.


## Final CodeRabbit round (six comments)

Source: `d6ba6c8e82f091a0e568f007fd9e58c273ce2306`, based on `103e1709`. Scope remains the staff lesson/update editors and their QA harness. The operational UI, shared attention projection and paused access rules are unchanged. Acceptance: keep unfinished new-block rubric text through save/move; make both save confirmations keyboard-accessible and complete the pending departure; leave successful update edits without a false warning while protecting subsequent Back/Cancel edits; run the documented video fixture and assert actual denied/learner-specific states.

Four negative controls fail against the previous source: new-block rubric move, watched-video Save and leave, completed-lesson reopen Save and leave, and successful update edit with a normalized title. All pass against this source. The two confirmation cases also cancel, verify that the draft remains protected, retry and finish the original destination. The reopen regression includes the companion query parameters: post-save query cleanup must not replace the pending navigation.

| Finding | Fix / evidence |
| --- | --- |
| New saved block loses rubric on move | Keep the draft’s saved ID-to-client-key map through the move reload, then reconcile/prune against the returned blocks. The regression verifies the exact rubric text, unload guard and departure question. |
| Save confirmations below leave dialog | Put the watched-video/reopen dialogs last, above the leave question and all other editor dialogs. Keep the save-and-leave promise pending through confirmation; cancellation preserves the draft, confirmation completes the original navigation. Keyboard focus assertions cover both paths. |
| False update save prompt | Expose the existing guard’s synchronous release through a shared hook and call it before leaving edit mode after success. Tests cover trimmed saved titles and later Back/Cancel edits; browser QA now saves the edit and verifies the persisted title at both widths. |
| Harness flag / port note | Make `QA_STAFF_RELIABILITY=1 scripts/qa/run start` a separate, explicit command. No manual port-variable instruction remains. The flag was already present in the previous documentation commit; this round clarifies that it must be on startup. Fresh harness video signing passes. |
| Premature absence assertion | Wait for the visible No access region before checking that the later lesson title is absent. |
| Page-wide inactivity match | Scope multi-learner checks to the QA Behind attention row. On the single-student workspace, verify QA Behind’s visible identity and the Why flagged note. Both dimensions pass. |

Final affected web gate: **5 files / 102 tests passed**, plus typecheck, ESLint and production build. Impeccable 4.6.0 advisory: `[]`. No API or contract changes; API/mobile gates were not rerun in this web-only round. The prior full API acceptance above remains the API evidence.

The first stronger browser run exposed selector mistakes (No access is a region, and the phone breadcrumb is hidden); these were corrected without weakening the required assertions. The next 20-run matrix passed. Final-source rerun additionally checks successful update saves, with results below. Chromium uses synthetic local data and stub auth; native devices, Safari, live providers and production remain outside this round.

This is the final requested CodeRabbit round. All six comments receive fix-commit replies. Any later review findings are residuals for the lead, not another automatic fix round; no new-head approval is claimed and the PR stays unmerged/unwatched.

Final-source browser rerun: **20/20 entries passed in 54.7s** at 390×844 and 1280×844 (with the existing 700px attention-action check). It includes the stricter denial/identity assertions and successful edit-save exit with persisted normalized title. The owned preview tab, servers and QA database were cleaned; lifecycle status reports **no active owned resources**. Shared local Postgres was left untouched.
