# P4 exact destinations — 2026-10-22

This slice addresses S3, S11, S12, T4, T12, T13, N-C7, and the meeting-name part of C4. The lead owns integration and merge; this PR must remain open.

## Context and acceptance

Base inspected: `3eee7c4c97fd2234a30fccc10ae93ada6b7e5636`. Sources: `docs/PRODUCT_VISION.md`, the lead's `audit/WORKER_BRIEF.md`, `audit/PLAN.md`, and destination inventories in `audit/verify-comms.md` sections 3–4. The product serves learners with multiple enrollment-specific learning histories and staff teaching assigned cohorts. Shared lesson IDs do not identify an enrollment. Clerk authenticates web/native users; Rails authorizes cohort access. Email opens web; HTTPS universal links are outside this slice.

Acceptance: a named exercise, recording, announcement, or booking opens its record in the source cohort; inaccessible/deleted records produce recovery copy instead of silently choosing another record. Existing bare lesson paths continue using the current cohort. Native staff handoffs preserve the resolved queue or meeting context. Meeting student links open StudentWorkspace and return to the same booking.

## Destination contract

`C` is the cohort, `L` the lesson, `B` the content block, `R` a first-class recording, `A` an announcement, `K` a booking, and `W` its course week. Recording settings indices are zero-based in help requests and one-based in the existing player identity `legacy-C-I`.

| Destination | Web | Native | Status |
|---|---|---|---|
| Grade / redo / exercise help response / Today grade cards / weekly redo rows | `/lessons/L?cohort_id=C#block-B` | `/lesson/L?cohort_id=C&block_id=B` | Source cohort; scroll and highlight block |
| Lesson help response | `/lessons/L?cohort_id=C` | `/lesson/L?cohort_id=C` | Source cohort |
| Older stored lesson paths | `/lessons/L` | `/lesson/L` | Current-cohort compatibility retained |
| Authenticated code runner | `/lessons/L?cohort_id=C#block-B` | Authenticated browser handoff | Cohort and exercise retained |
| Enrollment notice | `/cohorts/C` | `/cohort/C` | Exact cohort mapping |
| Daily unlock email | `/materials?cohort_id=C` | Email opens web | Cohort Learn; no public Home CTA |
| Announcement push / Today card | `/announcements/A` | `/updates?announcement_id=A` | Native fetches exact detail outside feed window/filter |
| Weekly recording catch-up | `/recordings?cohort_id=C&recording=R` | `/recording/R?cohort_id=C` | Selects named player |
| Primary recording help | `/recordings?cohort_id=C&recording=R` | `/recording/R?cohort_id=C` | Native support opens player |
| Legacy recording help | `/recordings?cohort_id=C&recording=legacy-C-I` | `/recording/legacy-C-I?cohort_id=C` | Exact settings recording, including promoted recording aliases |
| Learner meeting notice | `/meetings?cohort_id=C&booking_id=K&week=W` | Same path | Reveals target week/booking, including past/canceled |
| Staff meeting notice / Manage on web | `/admin/meetings?cohort_id=C&booking_id=K&week=W` | `/meetings` with same context; authenticated Manage on web | Web reveals exact booking |
| Meeting student name | `/admin/cohorts/C/students/S/overview` with return context | Staff management uses web | Returns to exact booking |
| Full grading | `/admin/grading?cohort_id=C` | Authenticated browser handoff | Uses queue's resolved cohort |
| Staff submission / support / intervention | Existing exact record routes | Existing exact record mappings | Retained |
| Messages / mentions / DM email | Existing conversation and message paths | Existing mappings | Unchanged; P6 owns message/thread anchors |
| Invitation / checkout return | Existing invitation and checkout paths | Browser | Unchanged; outside P4 |

`LearningDestination` owns API learning paths. Promoted recordings expose their previous settings identity as `legacy_item_key`, so stored recording links still select the same player after promotion. Existing help-request records gain exact paths when serialized or delivered using their stored context metadata; no data rewrite is needed. Deleted exercise metadata falls back to the stored path. New handoff allowlist entries are only `/admin/meetings` and exact recording selectors; arbitrary recording queries remain rejected. Existing destination APIs still authorize access.

P5 owns web announcement selection retention (N-C3) and feed correctness. Changes to native `updates.tsx` only consume `announcement_id` through the existing exact-fetch/modal behavior. P4 does not claim P5/P6 findings are fixed.

## QA ledger

Execution owner: implementation agent. Browser: T3 Chromium, 1280×800 and 390×844. Isolated API 3615 / web 5615, database `csg_p4_exact_destinations_dev`. Actual route components, CohortProvider, and Rails APIs were used. A temporary harness supplied local fixture identity instead of Clerk login; it was removed after QA. No messages, emails, pushes, or provider payments were sent.

| Scenario | Result | Evidence / limit |
|---|---|---|
| Source A feedback while B was selected | Passed, desktop | Only A feedback displayed; `block-1` focused, computed ruby ring; selected cohort persisted as A |
| Named primary recording | Passed, desktop | Second recording selected; exact external player URL instead of first playlist item |
| Legacy recording selector | Passed, narrow web | Exact legacy title and external URL; no horizontal overflow |
| Missing recording / inaccessible cohort | Passed, narrow web | Explicit unavailable copy; no fallback playback or other-cohort feedback |
| Staff past booking → student → meetings | Passed, desktop and narrow web | Past section opened, booking focused/highlighted; student cohort workspace loaded; breadcrumb returned to identical cohort/booking/week and focus |
| Learner past/canceled booking | Passed, narrow web | Target week opened and focused; canceled booking identity visible; canceled booking offers no change/join controls |
| Native destination mapping, lesson cohort/block, inaccessible cohort, recording, announcement, support, grading, meetings | Automated component/unit coverage | No iOS simulator assigned; installed app, notification transport, and physical scroll interaction not run |
| Clerk ticket redemption / actual email and push receipt | Not run | Service and allowlist tests cover destination construction and handoff preservation; real providers excluded |

Regression coverage includes API builders and legacy help paths, primary/legacy recording requests, email rendering, Expo payloads, meeting notification/serializer identity, handoff authorization, web route parameters/player selection, native route allowlists, exact detail screens, and runner/grading handoffs.

No migrations or dependency changes. Rollout requires API + web deployment and a new native build. Keep the branch/worktree for the lead; runtime resources and task-created databases are cleaned after final validation. Final gate results and tested head are recorded in the PR body.

## PR #196 review fixes

Review source: `63613ca4c05e42d82cf21143faa3a2479fff3038`. Rebased without conflicts onto `origin/main` at `3686c76d7e52b8af6ee40f9a495554995b1f771f` (#193/#194 included). The review-fix commit is the commit that adds this section. The worktree and branch remain assigned to the lead; no merge or manual CodeRabbit request is authorized.

1. **Legacy native compatibility:** notification JSON and web/Expo push retain legacy `path` values. `destination_path` carries exact context and updated clients prefer it. Existing notification records recover exact submission/help/meeting context from their source records; no migration is needed. A frozen copy of main's installed router and a shared JSON contract verify that Rails envelopes preserve old landing behavior while updated native routing resolves the exact record. Expo regression tests verify legacy lesson, announcement, and recording paths alongside exact fields. Old cohort and staff-meeting notifications still fall back to Updates in old builds, matching their existing behavior.
2. **Native focus:** lesson and meeting layout callbacks use native target refs and the ScrollView's `innerViewRef`. Focus completes only after successful measurement. Failed measurement retries once on the next layout frame; a later layout can try again if focus is still pending. Tests execute both screen callbacks and measurement success/failure paths.
3. **Instructor destination:** web header/footer actions use the linked cohort, with a course/instructor chooser for multiple unscoped courses. Native actions already use their rendered cohort; a two-cohort regression verifies the linked instructor.
4. **Missing native booking:** booking membership determines focus and the actual week. An absent booking shows unavailable copy, does not highlight a different booking, and labels the remaining list as current bookings.
5. **Staff meeting handoff:** only unique positive `cohort_id`, `booking_id`, and `week` query values are accepted. No fragments are consumed by this page, so fragments and other keys are rejected before Clerk is called.
6. **Cohort preference:** both real providers persist the authorized destination cohort and show a 4.5-second, non-blocking `Switched to <name>` notice. Web updates its in-memory preference. Provider tests verify retention after Back and subsequent unscoped navigation; inaccessible cohorts do not overwrite the preference.

Review-fix QA was agent-executed on the isolated API `3615`, web `5615`, and task-created database `csg_p4_exact_destinations_dev`. Real Rails read endpoints, route components, and CohortProvider were used. Temporary local identity scaffolding replaced Clerk login; the DM write was captured locally to inspect the selected cohort/instructor without sending a message. Scaffolding was removed after QA.

- **Passed, desktop 1280×800:** cohort B header action selected cohort B's instructor; unscoped action showed both course/instructor choices; opening A from B showed the switch notice; Back and later unscoped navigation retained A in memory and localStorage.
- **Passed, narrow web 390×844:** cohort B footer action selected cohort B's instructor; the chooser could select B; selection persisted through Back; no horizontal overflow.
- **Passed, automated native:** frozen installed-router contract; exact push preference and legacy fallback; actual lesson/meeting layout callbacks; measurement retry/completion; missing booking recovery; two different cohort instructors; real provider persistence with routed parameters.
- **Not run:** installed TestFlight push receipt, physical native scrolling, native gestures, Clerk ticket redemption, and live external notification delivery. No simulator was assigned to this worker. Native provider tests use the real provider with controlled router-hook inputs; they do not claim device navigation coverage.

Final gate totals, pushed head, and resource cleanup are reported in the PR body. No dependencies or schema changes. Deploy API and web together when the lead accepts the PR; updated native clients require a new build, while installed clients keep their legacy destinations.

Final local validation: API 832 tests / 4,593 assertions passed with seed 29035; RuboCop 464 files clean; Brakeman zero security warnings (one existing ignore); bundler-audit clean. Web `npm ci && npm run check` passed, including 85 suites / 489 tests, service-worker/Netlify routing, production build, and bundle checks. Mobile `npm ci && npm run check` passed, including 97 suites / 641 tests, brand assets, types, and lint (existing warnings remain). Impeccable reported no findings for the changed web/native UI paths. A prior full API run timed out in unchanged `MessageDeliveryConcurrencyTest`; the isolated concurrency suite and complete suite both passed when rerun with the same seed. No messaging code was changed for that intermittent failure.

Cleanup: task-created QA browser tab and servers were closed; temporary auth/fixture scaffolding was removed. Only this worker's test/development databases are dropped after validation. The assigned worktree and PR remain for the integration owner.

## Review-fix round 2

On 2026-10-22, rebased the clean assigned worktree from `9a7219f` onto `origin/main` at `a7db8b8` (#192), without conflicts. The lead's common brief and plan remain the scope; the Brain Dump's March 4 transition notes confirm the React/Rails/Clerk learning-hub direction. No deployment was performed. The integration owner retains PR #196.

Acceptance and changes:

- Native Updates leaves route-driven cohort selection to one provider callback. Selection, notice state, and the iOS announcement happen together, without a cancelable animation-frame callback. Updates clears `cohort_id` only after the provider resolves it.
- Web compares the link target with the previous effective cohort for the same user. An inaccessible stored preference falling back to A does not cause a false notice for A; defaulted A to linked B produces the notice.
- iOS queues `announceForAccessibilityWithOptions` without setting accessibility focus. Android retains the polite live region; the overlay retains `pointerEvents="none"`.
- Channel and direct-message pushes retain `path` and `message_id`, adding an exact `destination_path` with the router's `messageId` query key. Interventions include both route fields.

Regression evidence: all four findings reproduced against the rebased pre-fix implementations. Both web fallback cases failed, the real native Updates screen lost its notice, the iOS announcement spy received no call, and message/intervention destination assertions failed. With the fixes applied, the targeted suites pass. The native regression renders the actual Updates screen with the real CohortProvider, controlled router hooks, AsyncStorage, and API fixtures; a separate provider test checks queued iOS announcement, unchanged focus, persisted selection, and a non-blocking overlay.

Affected-flow QA, executed by the implementation agent in T3 Chromium at 1280×800, used the actual web CohortProvider and browser localStorage with a temporary learner identity and controlled accessible-cohort API. Passed: stale preference 99 → fallback A → link A has no notice; no preference → default A → link B shows “Switched to Cohort B,” stores B, and permits clicks through the notice; subsequent unscoped navigation retains B. The temporary harness was removed and its browser storage key deleted. This focused browser run does not exercise Clerk or live Rails reads.

Not run: native device navigation, physical VoiceOver speech/focus, installed push delivery, and narrow-screen runtime retesting in this round. No simulator was assigned, per the common brief. Native behavior is covered by rendered component tests with controlled platform/router hooks; external push delivery is simulated in service tests. These limits remain for the integration owner; earlier device limitations are unchanged.

Before push, #195 merged into `main` (`0f6ea93`), so the branch was rebased again. The native lesson screen conflicted in two replayed P4 commits. Resolution retains #195's `isAuthoringAdmin` guards for editing, mutation callbacks, and the settings modal, together with P4's source-cohort navigation, inner scroll ref, exact block focus, and provider-owned route selection. Full gates are rerun on this combination. The route-sync effect has one documented `react-hooks/set-state-in-effect` exception: router state is external, and synchronizing notice and selection together prevents the Updates parameter-clear race.

Final-combination validation uses Ruby 3.3.7 and Node 22.22.3. Clean web/mobile installs completed with `npm ci --offline --no-audit --no-fund` after the initial registry-connected installs stalled; package locks are unchanged. Web `npm run check` passed (89 suites / 512 tests, lint, types, Netlify/service-worker checks, production build, and bundle check). Mobile `npm run check` passed (99 suites / 660 tests, brand, types, lint with 22 warnings and zero errors); the frozen installed-router compatibility, actual Updates/provider regression, iOS announcement, and authoring-screen suites passed. RuboCop inspected 471 files with no offenses; Brakeman reported zero security warnings with one existing ignore; bundler-audit reported no vulnerabilities. Impeccable reported no findings.

The first API full run (853 tests, seed 60287, ten workers, before #195) failed only the unchanged receipt concurrency test's one-second join deadline under heavy machine load. Its isolated suite passed (11 tests / 46 assertions), and the push suite passed (15 tests / 58 assertions), including channel, DM, and intervention payloads. The first two-worker full rerun was stopped when #195 merged so the final combination could be tested instead; that superseded run is not counted as a passed gate.

The final API full gate passed on the #195 combination: 867 tests / 5,161 assertions, seed 60287, `PARALLEL_WORKERS=2`, zero failures/errors/skips. All final source changes were tested at `e3d9536`; the final amendment only completes this QA record. No dependencies, schema, or deployment configuration changed in round 2. Physical VoiceOver and installed-push acceptance remain unrun.

Cleanup: closed the task-created QA browser tab, stopped its exact Vite process, removed the temporary harness and browser storage, and verified no owned lifecycle resources remained. The isolated test database and its ten task-created parallel copies are removed after the final suite. The assigned worktree/branch and open PR are retained for the integration owner. No merge or CodeRabbit request was made.
