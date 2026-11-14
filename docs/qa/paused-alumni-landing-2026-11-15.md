# Paused, alumni and landing QA

Agent-executed affected-flow QA, November 15 task (executed November 14 Guam time).
Base: origin/main 2169f70bc107f70ab03e366ca28b7334db603575.
Tested source: codex/paused-alumni-landing working tree; implementation commit is the commit containing this record.

CSG Learn serves students, instructors and admins across guided programs and the alumni library. Sources: AGENTS.md, the November 14 audit U-0.2/L-1.6/U-0.8/U-5.10, and approved design README decision 7. Acceptance: paused learners retain past learning and feedback without writes, alumni see a library, and signed-in root visits open Today. This is a focused fix, not the full redesign.

Environment: copied audit harness at /tmp/csg-pr15-qa, synthetic people with production curriculum content; isolated PostgreSQL databases csg_pr15_test_20261115 and csg_pr15_qa_20261115. API port 3725, Vite 5725. No production writes.

| Case | Result |
| --- | --- |
| Casey (5), Today and switcher, 1280 and 390 | Passed: Cohort 3 marked Paused, pause date and saved-work message, Message staff action; no horizontal overflow |
| Casey, Learn, 1280 and 390 | Passed: lessons remain listed; past completed lesson opens with Review only controls |
| Casey, staff contact | Passed at 390: Message staff opens Audreana Instructor DM; no external message sent |
| Paused writes, future lessons, class chat | API regression passed: progress/submission writes denied; future lesson denied; class chat cannot post; instructor DM can post |
| Fran (8), Today, 1280 and 390 | Passed: Start with first lesson, Recently added, library summary; no 0% course progress or empty locked module |
| Fran, Learn, 1280 and 390 | Passed: library description, lessons visible, empty sections absent; no horizontal overflow |
| Alex (3), root, 1280 and 390 | Passed: / redirects to /dashboard |
| Installed PWA / signed-out authentication | Manifest inspected; installation and real Clerk login not run (local auth shim always signs in) |
| Native mobile | Typecheck and focused Jest; device runtime not run |

Screenshots (local evidence, not committed binary assets):
- Casey Today desktop: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgewsn5-324f2ea0.png
- Casey Today phone: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgex063-cc1038dc.png
- Casey Learn desktop: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgexw3r-21bb46a8.png
- Casey past lesson phone: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgf3sbb-620464f7.png
- Fran Today desktop (before moving Recently added below hero): /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgey9nb-b468acb0.png
- Fran Learn desktop: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgezct4-fad131e7.png

Automated: API affected suites 49 tests / 273 assertions passed; expanded pause guard suite 7 tests / 48 assertions passed. Web lint and build typecheck passed; focused Vitest 22 passed. Mobile typecheck and assigned-content screen Jest 6 passed; enrollment Jest 3 passed. Changed Ruby RuboCop passed. Impeccable advisory returned [].

Pause timestamps are recorded for future status changes. Historical paused rows have no fabricated pause date; their existing updated_at is the fallback availability cutoff. Web library Continue uses local per-user/cohort history and validates the lesson against currently available lessons; native Today currently offers Start with the first available lesson.

Final Fran Today phone evidence: /Users/leonshimizu/.t3/userdata/browser-artifacts/browser-screenshot-127-0-0-1-mwgf4mu2-c7432b6e.png.
Additional access regression: 24 tests / 211 assertions passed (learner capabilities and curriculum resources).

Web Continue was verified by opening the library lesson and returning to Today at 390px. An additional full local Rails run was interrupted during cleanup: it had loaded the old paused-access test expectations before their update, so its stale curriculum-resource assertion failed. The updated access suites passed separately (24/211); the full local suite is not claimed green. CI runs the committed expectations.

Cleanup: exact Ruby server PIDs 14411, 54902 and 67576 stopped across restarts; Vite PID 14464 stopped; owned preview tab closed; extra test PID 73827 terminated through dev-lifecycle. Both task databases dropped. Worktree retained for the lead.
