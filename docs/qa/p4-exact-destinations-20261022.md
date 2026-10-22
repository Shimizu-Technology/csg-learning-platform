# P4 exact destinations — 2026-10-22

This slice addresses S3, S11, S12, T4, T12, T13, N-C7, and the meeting-name part of C4. The lead owns integration and merge; this PR must remain open.

## Context and acceptance

Base inspected: `3eee7c4c97fd2234a30fccc10ae93ada6b7e5636`. Sources: `docs/PRODUCT_VISION.md`, the lead's `audit/WORKER_BRIEF.md`, `audit/PLAN.md`, and destination inventories in `audit/verify-comms.md` sections 3–4. The product serves learners with multiple enrollment-specific learning histories and staff teaching assigned cohorts. Shared lesson IDs do not identify an enrollment. Clerk authenticates web/native users; Rails authorizes cohort access. Email opens web; HTTPS universal links are outside this slice.

Acceptance: a named exercise, recording, announcement, or booking opens its record in the source cohort; inaccessible/deleted records produce recovery copy instead of silently choosing another record. Existing bare lesson paths continue using the current cohort. Native staff handoffs preserve the resolved queue or meeting context. Meeting student links open StudentWorkspace and return to the same booking.

## Destination contract

`C` is the cohort, `L` the lesson, `B` the content block, `R` a first-class recording, `A` an announcement, `K` a booking, and `W` its course week. Recording settings indices are zero-based in help requests and one-based in the existing player identity `legacy-C-I`.

| Destination | Web | Native | Status |
|---|---|---|---|
| Grade / redo / exercise help response | `/lessons/L?cohort_id=C#block-B` | `/lesson/L?cohort_id=C&block_id=B` | Source cohort; scroll and highlight block |
| Lesson help response | `/lessons/L?cohort_id=C` | `/lesson/L?cohort_id=C` | Source cohort |
| Older stored lesson paths | `/lessons/L` | `/lesson/L` | Current-cohort compatibility retained |
| Authenticated code runner | `/lessons/L?cohort_id=C#block-B` | Authenticated browser handoff | Cohort and exercise retained |
| Enrollment notice | `/cohorts/C` | `/cohort/C` | Exact cohort mapping |
| Daily unlock email | `/materials?cohort_id=C` | Email opens web | Cohort Learn; no public Home CTA |
| Announcement push / Today card | `/announcements/A` | `/updates?announcement_id=A` | Native fetches exact detail outside feed window/filter |
| Weekly recording catch-up | `/recordings?cohort_id=C&recording=R` | `/recording/R?cohort_id=C` | Selects named player |
| Primary recording help | `/recordings?cohort_id=C&recording=R` | `/recording/R?cohort_id=C` | Native support opens player |
| Legacy recording help | `/recordings?cohort_id=C&recording=legacy-C-I` | `/recording/legacy-C-I?cohort_id=C` | Exact unmigrated settings recording |
| Learner meeting notice | `/meetings?cohort_id=C&booking_id=K&week=W` | Same path | Reveals target week/booking, including past/canceled |
| Staff meeting notice / Manage on web | `/admin/meetings?cohort_id=C&booking_id=K&week=W` | `/meetings` with same context; authenticated Manage on web | Web reveals exact booking |
| Meeting student name | `/admin/cohorts/C/students/S/overview` with return context | Staff management uses web | Returns to exact booking |
| Full grading | `/admin/grading?cohort_id=C` | Authenticated browser handoff | Uses queue's resolved cohort |
| Staff submission / support / intervention | Existing exact record routes | Existing exact record mappings | Retained |
| Messages / mentions / DM email | Existing conversation and message paths | Existing mappings | Unchanged; P6 owns message/thread anchors |
| Invitation / checkout return | Existing invitation and checkout paths | Browser | Unchanged; outside P4 |

`LearningDestination` owns API learning paths. Existing help-request records gain exact paths when serialized or delivered using their stored context metadata; no data rewrite is needed. Deleted exercise metadata falls back to the stored path. New handoff allowlist entries are only `/admin/meetings` and exact recording selectors; arbitrary recording queries remain rejected. Existing destination APIs still authorize access.

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
