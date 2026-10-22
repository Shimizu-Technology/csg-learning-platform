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
