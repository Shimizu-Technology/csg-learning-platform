# W9.2: per-student deadlines and extensions

PR: https://github.com/Shimizu-Technology/csg-learning-platform/pull/316. Branch: `feat/w9-deadlines`; isolated worktree: `/Users/agent/work/csg-w9-deadlines`. This record describes the final review fixes on top of `78bdff15` (which includes main `15f6214e` / #315). The tested source is committed with this record. Final head and CI evidence are recorded in the PR body.

## Product rules and acceptance

Sources: Leon’s approved W9 self-paced design at `/Users/agent/work/csg-learn-w9-self-paced-design-2026-11-18.md`, W9.1 #313, and the lead’s decisions in the #316 fix requests. CSG Learn serves Code School of Guam learners and staff; `LearnerProgress` supplies status.

**An extension only ever adds time.** The resolver takes the later of an applicable grant and the learner’s own base window. An unbounded base stays open. A subsequent cohort postponement or longer pace wins over an earlier grant. Creates and edits must extend a finite effective window; earlier edits are rejected. Choosing a longer pace preserves the grant record/history while allowing the later pace date. The earlier acceptance wording that capped a longer pace at the grant was incorrect and is superseded by this decision.

For personal-pace learners with learning plans enabled, weekly milestones are soft: cohort weekly closes are not enforced. The final project has the firm plan date. With learning plans disabled, both display and enforcement use cohort windows. Final-date grants are calendar dates represented at 23:59:59 in Pacific/Guam; the model rejects other final-grant times. Lesson and module-week grants support exact times, shown on Today and the lesson page in Guam.

StaffCohortScope authorizes changes; unauthorized and missing records return the same 404. Each change needs a new reason and records the actor/time/history. Removed grants cannot be edited, including a removal occurring while PATCH waits for its lock. Final-grant removal reconciles active and paused plans without resuming a paused learner. Replanning never shifts an unfinished milestone backward or into the past. No new feature switch was added; Off cohorts without grants retain their windows, payloads and lesson UI. The existing Lance-shaped golden file was not regenerated.

## Final-round functional checks

Agent-executed on synthetic local fixtures, Rails test mode and Vite. No production data or settings changed. `scripts/qa/w9-deadlines-review-fixtures.rb` anchors the personal start to the run date on every setup. `scripts/qa/w9-deadlines-review.spec.ts` reproduces these cases at 390 and 1280 pixels in light and dark Chromium:

| Journey | Observed result |
| --- | --- |
| Grant, edit, remove | Required reason, named target/granter, Guam date without seconds, fresh edit reason, independent removal confirmation/reason, visible history |
| Cohort postponement after grant | Extended learner and classmate can both submit through the later cohort close |
| Earlier PATCH | 422; learner keeps the later deadline |
| Open week and legacy grant | New finite grant refused; legacy grant cannot close an open window |
| Soft pace week | Cohort close and legacy hard grant do not close submissions; hard grant is refused |
| Final extension then 12-week replan | Later pace target applies; unfinished milestones remain on/after today; learner remains on track |
| Open plan draft during final grant | Draft and stale-plan notice remain |
| Final grant with no plan draft | Updated saved plan appears automatically; an unsaved personal-start draft survives the pace metadata refresh |
| Remove the grant being edited | Edit draft clears; removed row/history remain; stale reason-only PATCH returns 404 |
| Off learner lesson | Deadline line remains absent; normal submission behavior unchanged |

The component suite additionally verifies that failed history reloads keep writes disabled until a successful reload and that removing a different grant preserves the unrelated edit draft. Mobile’s actual lesson-screen test verifies hidden and shown deadline branches using the same cutoff: 2030-01-15 00:00 UTC renders as Jan 15, 10:00 AM Guam only when the payload opts in.

API regressions cover the paused removal, feature switch, impossible February 30, post-lock lesson/cohort reads (including GitHub fetch races), submission-specific queue reasons, module-week copy counts/target/history, and hard lesson deletion retaining grant history. The new FK nullifies a deleted lesson target; its saved revisions retain the original ID. Model validation still rejects new lesson grants without a valid target. Rolling this migration back after a referenced lesson was deleted requires reconciling the orphan history explicitly; rollback refuses to discard it silently.

## Validation

All local final-round runs used normal Rails migration timestamp validation, with no override. At migration creation, `date -u` was November 18 after 08:12 UTC, so the unique `20261119080000` migration was inside now + 24 hours. Existing `20261119070000` remains; #315 owns `20261119050000`. Schema was regenerated by running migrations. Both migration tests clear every pooled connection’s statement cache.

| Check | Result |
| --- | --- |
| Focused API, prepared statements on | 129 runs, 870 assertions; no failures/errors/skips |
| Focused API, prepared statements off | 129 runs, 870 assertions; no failures/errors/skips |
| Web | Typecheck, lint, API generated-type check and build pass; 255 files / 3,521 tests pass |
| Mobile | Typecheck passes; lint has 0 errors / 74 warnings; 142 suites / 1,822 tests pass |
| RuboCop | 847 files, no offenses |
| Brakeman | No warnings |
| Impeccable 4.6.0 advisory | Changed web UI paths: empty findings array, telemetry disabled |
| Browser matrix | Seven scenarios × two widths × two themes; final results recorded in PR body |
| Full API | ASUS attempt returned 75: another run owns the shared lock. The final-source CI full suites are the permitted fallback; exact run/results recorded in PR body. No timestamp override is used. |

The first local API invocation accidentally used Rails’ default ten forked workers and hit the mini’s pg/Ruby fork crash. It was stopped; the final focused runs above use one worker and pass. No application workaround was added. The old 07:00 restriction was Rails’ future-migration guard, not a test failure; it no longer applies.

QueryCounter fixtures add four real enrollments/submissions/grants and verify flat queue/workspace counts. The Off parity test checks nil, future and closed windows plus submit results. Independent Opus review of `a42d8562` separately confirmed byte-identical Lance-shaped payloads and submit outcomes against main; its P1/P2 repros now have regression tests and browser checks.

Not run: WebKit/mobile Safari (unsupported on this mini) and native device interactions. Chromium resizing and Jest do not establish native-device behavior.

## Review boundary and resources

This is the final requested CodeRabbit round. The two requests to cap a longer pace at the staff grant are declined under the lead’s additive-only decision. Other listed findings are fixed. Each thread receives the implementation commit or the decision. Later feedback is recorded as a residual in the PR body; no further review round or merge is authorized.

Task-owned Rails/Vite processes, browser contexts/tab and disposable local database are cleaned at the end of QA. The shared PostgreSQL service and busy ASUS run are borrowed and remain untouched. No simulator/container was started. Branch/worktree remain for the lead; the PR is held without merge or watch.


## Lesson-deletion residual (CodeRabbit 4611050811)

The lead authorized this learner-visible residual after the final review boundary. `LearnerExtension#effective?` excludes a deleted lesson target using only its nullified FK (no target query). Lesson deadline eligibility, grading eligibility, window matching and pace calculations all use the same predicate. The staff list says **Lesson removed**, disables Edit, and keeps Remove/history available.

The new API regression deletes an extended lesson and opens another finite-window lesson in the same non-pace enrollment: no personal-deadline flag is added, the original window is used, a late submit stays refused, and grading gains no extension fields. Removing the orphan still succeeds and retains both revisions. The component test checks the label, disabled Edit, enabled Remove, confirmation and retained history.

Validation on this follow-up source: focused API prepared on/off each **39 tests / 263 assertions**, no failures/errors/skips; web **255 files / 3,522 tests**, typecheck/lint/build pass; RuboCop **847 files clean**, Brakeman **0 warnings**, Impeccable changed-panel advisory **[]**. The dedicated real-browser journey checks staff controls, the unrelated learner lesson, removal and retained history at 390/1280 in light/dark. Initial browser setup exposed a cached curriculum association in the synthetic fixture; reloading the enrollment after creating the temporary lesson fixes setup without bypassing validation. The final dedicated browser matrix passed **4/4**. Final-head pooler results are recorded in the PR body.

No schema or API-contract shape changed. Native code is unchanged. Task-owned test DB, QA servers/database and preview tab are cleaned before handback; borrowed PostgreSQL remains running. The PR stays unmerged. The lead explicitly requested waiting for both final-head pooler checks before the final report.
