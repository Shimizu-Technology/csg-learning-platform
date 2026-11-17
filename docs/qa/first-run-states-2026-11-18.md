# First run, empty states and recovery — W8 PR 8.4

Implementation branch `feat/first-run-states`, based on `main` at `c290e00a`.
Agent-executed local QA on Leon's MacBook. The ASUS runner was unreachable
because the MacBook was on a phone hotspot, so the full gate runs locally,
one stage at a time, with one Rails worker and an owned database.

## Product brief and acceptance

CSG Learn serves program students, self-paced purchasers, paused learners and
alumni. Today should give a new learner one clear starting point, then preserve
their course and return context as they navigate. A library is for browsing,
not a course completion target. Students see only their own learning and
reachable instructors; paused learners retain past material and feedback.

Sources: approved redesign README (all sections, especially §§1, 3, 5, 6 and 12),
`10-first-run.html`, audit U-5.4/U-5.8–11/S-15/L-1.5/L-1.9/L-1.11 in Brain Dump,
merged #293, #294 and #295, and the current `LearnerProgress`, `StudentToday`,
`EnrollmentCapabilities`, `StaffContact` and recording/resource read rules.

Required acceptance:

- Only explicit resolved `student_experience_v2: true` renders new student UI.
  Lance/Cohort 3 remains Off; the existing Dashboard snapshot must remain exact.
- A brand-new enrollment gets one three-step welcome, a real starting lesson,
  date-only help period and its reachable instructor. #283's dismissal is reused
  per enrollment. Finishing a lesson or handing in work ends first-run eligibility.
- Course switching reaches that course's Today; Alumni points to active learning
  elsewhere. Published/readable media and resources determine new navigation.
- Library framing, useful error/empty actions, context-preserving Back links,
  profile receipts and 44px controls, and public legal recovery work at 390/1280
  in both themes without horizontal overflow.
- LearnerProgress remains the source for statuses/counts. Query counts stay flat
  against fixtures that actually gain cohorts and media. Native old views remain.

No new enter animation is needed: welcome and navigation respond immediately.
The existing press feedback remains; the profile toggle disables movement under
reduced motion. Theme roles and existing button components are reused.

## Scope confirmed already implemented

- #295: Today links the hero cohort, next lesson and next-close lesson; Alumni
  Today already says library and lists recently added lessons. Requests start
  while the experience switch resolves (`dashboardRequest.ts`).
- #293: library outline has no progress counts, locked empty course modules or
  course-unlock copy; new Learn replaces Materials/module/cohort-home views.
- #283: course detail links back to all courses; enrollment open goes to Today;
  Start here dismissal is already stored on each enrollment.
- Profile already capitalizes statuses, links readable enrollments and shows
  joined dates. Recordings and Resources already say Back to Today.
- Daily-unlock email lesson names already link to the exact cohort/lesson.
- #279 already fixed the announcement cohort and its return link.

## Execution ledger

| ID | Required journey and saved outcome | Coverage | Result |
| --- | --- | --- | --- |
| F1 | New solo course → welcome → dismiss → reload → open Orientation | 390/1280, light/dark | Pending |
| F2 | Program first day → welcome → dismiss → reload → open Orientation | 390/1280, light/dark | Pending |
| F3 | Alumni → recently added / continue watching, no course progress | 390/1280, light/dark | Pending |
| F4 | Alumni with active program → program Today, no stale library state | 390/1280, light/dark | Pending |
| F5 | Paused → saved work and readable lessons, no welcome/submission action | 390/1280, light/dark | Pending |
| F6 | Synthetic Lance/Cohort 3 Off → unchanged Today | 390/1280, light/dark + snapshot | Pending |
| F7 | Profile → real 44px email switch; human activity copy; context Back | 390/1280, light/dark | Pending |
| F8 | Public Privacy → deletion request and way back | 390/1280, light/dark | Pending |
| F9 | Receipt success/failure/retry and purchaser authorization | Unit/API, provider simulated | Pending |
| F10 | Empty features and paused cutoff; growing query fixtures | API/unit | Pending |

Screenshots and structured results go in `first-run-states-2026-11-18/`.
Real iPhone/Safari touch, installed-app behavior, Clerk, external media playback,
Stripe transport, email and push delivery are outside this local browser harness.
The native typecheck, lint and jest gate still runs; no native view is redesigned.
The public routes and their AASA exclusions are unchanged.

## Gate and cleanup

Pending final execution and exact resource cleanup. No migrations are needed.
The local gate database is `csg_first_run_gate_20261118`; QA uses the separate
unique `csg_qa_*` database created by `scripts/qa/run`.
