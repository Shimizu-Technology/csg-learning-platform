# Setup wizard fix round 2

Agent-executed affected-flow acceptance on 2026-11-16, based on c3a01fc5 plus this PR's round-2 changes. Purpose: administrators enroll learners and deliver invitations without losing results or exceeding the production request budget. Sources: enrollments controller, invitation dispatch/job, Cohort model, bulk client and existing round-1 QA record. Production uses inline jobs; no queue worker is assumed.

Synthetic local QA harness only, Chromium at 1280×800. Opt-in `QA_INVITE_DELAY=0.8` runs inline jobs and stubs both Clerk and Resend with 0.8 seconds per call. External HTTP remains blocked. No real email was sent.

## Accepted journeys

- Pasted 60 learners, previewed, and submitted with invitations enabled. Enrollment used 25/25/10 rows with no provider calls. Invitations used twenty successful requests of three learners each. Visible progress included “Sending invitations 9 of 60…”.
- Forced a 500 before the second invitation chunk. The UI showed “Resume upload”. Resuming started with learner 4, without repeating any enrollment request or the successful first invitation chunk.
- A synthetic failing address at learner 31 reported an invitation failure and a roster resend instruction. All later learners completed, including learner 60. UI rendered 60 results. SQL verified 60 enrolled accounts: 59 sent, one failed.
- Settings for the started cohort disabled “Upcoming (move start date)”. A browser PATCH with status upcoming returned 422: “Move the start date to hold this cohort. To take it off sale, turn off checkout.” API regression additionally verifies that moving the date into the future permits Upcoming, `refute cohort.active?`, and removal from course_offerings.

Every actual request finished below 8 seconds; slowest was 5,619 ms. These are local timings with simulated provider latency, not measurements of Render/Neon or real providers. Three learners × two provider calls × 0.6–1.0 seconds gives 3.6–6.0 seconds plus database/HTTP overhead. Invitation requests explicitly allow 30 seconds; the normal 12-second client timeout remains unchanged elsewhere.

## Per-request browser timings

| Request | Mode | Rows | First email | Milliseconds | HTTP |
| --- | --- | --- | --- | --- | --- |
| 1 | Enrollment | 25 | round2-0@example.test | 124 | 200 |
| 2 | Enrollment | 25 | round2-25@example.test | 104 | 200 |
| 3 | Enrollment | 10 | round2-50@example.test | 41 | 200 |
| 4 | Invitations | 3 | round2-0@example.test | 5582 | 200 |
| 5 | Invitations | 3 | round2-3@example.test | 0 | 500 |
| 6 | Invitations | 3 | round2-3@example.test | 5461 | 200 |
| 7 | Invitations | 3 | round2-6@example.test | 5513 | 200 |
| 8 | Invitations | 3 | round2-9@example.test | 5384 | 200 |
| 9 | Invitations | 3 | round2-12@example.test | 5377 | 200 |
| 10 | Invitations | 3 | round2-15@example.test | 5513 | 200 |
| 11 | Invitations | 3 | round2-18@example.test | 5402 | 200 |
| 12 | Invitations | 3 | round2-21@example.test | 5539 | 200 |
| 13 | Invitations | 3 | round2-24@example.test | 5252 | 200 |
| 14 | Invitations | 3 | round2-27@example.test | 5564 | 200 |
| 15 | Invitations | 3 | round2-delivery-fail@example.test | 5423 | 200 |
| 16 | Invitations | 3 | round2-33@example.test | 5440 | 200 |
| 17 | Invitations | 3 | round2-36@example.test | 5454 | 200 |
| 18 | Invitations | 3 | round2-39@example.test | 5427 | 200 |
| 19 | Invitations | 3 | round2-42@example.test | 5526 | 200 |
| 20 | Invitations | 3 | round2-45@example.test | 5345 | 200 |
| 21 | Invitations | 3 | round2-48@example.test | 5415 | 200 |
| 22 | Invitations | 3 | round2-51@example.test | 5432 | 200 |
| 23 | Invitations | 3 | round2-54@example.test | 5619 | 200 |
| 24 | Invitations | 3 | round2-57@example.test | 5391 | 200 |

## Engineering evidence

QueryCounter measured 215 logical SQL queries for 25 new learners with an assigned module (8.6 per learner including fixed request overhead), versus the reported 636. The regression gate requires fewer than 250. User/enrollment validations, term snapshots and locks remain; module assignments use insert_all with availability timestamps. Users, existing enrollments and modules are preloaded.

Inline integration regressions cover failing Clerk and Resend in single and bulk enrollment, later-row completion, error-class-only storage, and deduplication of successful invitations on retry. Additional regressions cover a false Resend result inline, queue-backed retries, rejected-request rate budget, pending purchase public titles, effective record-summary status, client chunk sizes, 30-second timeouts, and failed-chunk resume.

Not run: live provider delivery, production latency, Safari/WebKit (unsupported on this host), native device UI. Mobile typecheck/Jest provide code coverage only. No merge or deployment was requested. Final automated results and cleanup are recorded in the PR's Fix round 2 section.

