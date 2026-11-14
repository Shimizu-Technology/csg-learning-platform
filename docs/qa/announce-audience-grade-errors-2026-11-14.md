# QA: announcement audience default and grade validation (PR 1.4)

Backlog items U-0.3 and U-0.4 from the 2026-11-14 live audit. Affected-flow QA, executed by the agent.

- Tested commit: branch `claude/announce-audience-grade-errors` on top of `fb69416b` (plus the final scroll tweak noted below).
- Environment: local QA harness (API in test mode with external HTTP blocked, Vite web app, production course content with synthetic people), own DB and ports, dropped afterwards. Browser: T3 preview tab at 1280x800 and 390x844.
- Fixtures: instructor Audreana (id 2) assigned to Cohort 3 (3 enrolled students); admin Leon (id 1); two ungraded rubric submissions (58, 59) for Alex (id 3) in Cohort 3, created through the seeded database because the seed had none for him.

| # | Scenario | Result |
|---|----------|--------|
| 1 | Instructor opens Updates > Manage with `?cohort_id=1` (Cohort 3 selected in sidebar): audience is Cohort 3, line beside Post reads "Posting to: Cohort 3 · 3 students" | Passed, 1280 and 390 |
| 2 | Switch audience to Everyone and post: confirmation "Post to everyone?" appears; Cancel posts nothing (announcement list unchanged, checked through the API) | Passed |
| 3 | Admin with sidebar "All cohorts" and no URL cohort: cohort select is blank ("Choose a cohort…"), line reads "Choose a cohort to post to", posting is blocked | Passed (post blocked by native `required` validation; the in-form message path is covered by vitest) |
| 4 | Instructor grades Alex's rubric submission 58 as Redo with written feedback and no ratings | Passed: no error, grade `R` and feedback saved, no criterion results stored |
| 5 | Click B on rubric submission 59 with no ratings | Passed: message "Rate every rubric criterion before grading A, B, or C. A redo only needs written feedback." appears directly above the grade buttons inside an `aria-live="assertive"` region, in view at 1280 and at 390 (the whole alert plus buttons block is scrolled into view) |

Findings during QA: at 390px the first version scrolled only the alert into view, leaving the buttons below the fold; the scroll target is now the alert plus grade buttons, and scenario 5 was re-run at 390 afterwards.

Not run: native iOS/Android devices. The mobile composer default, confirmation and the Redo rule are covered by jest only (`announcement-audience.test.tsx`, `staff-submission-contract.test.tsx`).

Decision applied: Redo needs written feedback only (audit Decisions section 8). A blank-feedback Redo still shows the existing "Request a redo without feedback?" confirmation; it is not blocked. A per-cohort setting that makes ratings required for Redo is deferred.
