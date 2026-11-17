# W7 PR 7.6a: learning-plan editor and instructor meetings path

Branch `feat/plan-editor-meetings`, based on `c62eb42a`. QA executed by the implementation agent on the Mac mini, November 17, 2026, using the local QA harness with synthetic data only. No production access.

## Context and acceptance

CSG Learn's staff build personal catch-up plans for students who fall behind, and instructors host one-to-one meetings. The audit backlog items in scope:

- **U-4.9.** The Learning tab was about 31,500px tall. "Add lesson" was a native dropdown of about 240 lessons, finished prework included, added one at a time, with Save about 2,100px down. Acceptance: a searchable multi-select that hides finished lessons, groups by module and week, adds a module's remaining lessons at once, works from the keyboard and shows what is already in the plan; a sticky save; `useLeaveGuard` for unsaved edits; a plan section of sensible height.
- **U-4.10.** Instructors who host no meetings saw "An admin can assign you…" on Meetings and on the cohort Schedule tab. Acceptance: a working path that shows their meetings and bookings and, where assignment stays admin-only, names who to ask and links to them.
- **Leon's decision.** Until an instructor agrees a plan, the student sees how far behind they are, not an unreviewed suggestion. This PR keeps that: drafts live only in the editor, and students read only the saved plan (`LearningPlanProjection`). The editor says so above the form. Automatic plan suggestions are a follow-up (below).

Sources: redesign README §2, §4, §5 (validation and unsaved changes), §6, §7, §9; mockup `06-student-workspace.html`; `api/app/controllers/api/v1/{learning_plans,staff_private_meetings,staff_private_meeting_configs,staff_private_meeting_slots}_controller.rb`; `LearnerProgress`.

## Server rules checked (meetings)

| Action | Who may do it | Changed? |
| --- | --- | --- |
| Turn meetings on for a cohort and choose its host (`POST staff/private_meeting_configs`) | Admins only | No |
| Publish or remove times (`staff/private_meeting_slots`) | Admins, or the host instructor if they still teach the cohort | No |
| Move, cancel or add a Zoom link to a booking (`PATCH staff/private_meetings/:id`) | Admins, or the booking's instructor | No |
| Read meetings (`GET staff/private_meetings`) | Admins: every cohort. Instructors: cohorts they host | Read widened, see below |

The only widening: `GET staff/private_meetings` now also returns `other_cohorts` for an instructor. These are running, non-self-paced cohorts they teach, with meetings switched on, that they don't host. Each entry carries the cohort's id and name and the host's id and name (or null). The response also returns `admin_contacts`: up to three admins' ids and names. Instructors could already list co-instructors and admins through `GET /users`. No slots, bookings, student names or Zoom links of other hosts are returned; an integration test asserts that.

## Automated verification

- **API:** full suite with `OPENAPI_COVERAGE=1`, `PARALLEL_WORKERS=1` on database `csg_plan_meetings_test`. Default prepared statements: 1,895 runs, 40,877 assertions, 0 failures/errors/skips. With `?prepared_statements=false`: same counts, 0 failures. RuboCop: 681 files, no offenses. Brakeman: no warnings.
- **Web:** typecheck, ESLint, Vitest (205 files, 2,397 tests), build, `test:bundle`, `test:netlify`, `api:check` passed. Impeccable 4.6.0 advisory scan of the changed UI files: `[]`.
- **Mobile:** typecheck and Jest (136 suites, 1,428 tests) passed. `expo lint` has 0 errors and the same 74 warnings as main; the changed files have none.
- **Fails on old code:** the new API tests (editor lesson fields, co-instructor `other_cohorts`, both QueryCounter tests), the new web tests (picker, keyboard, exceptions, save bar, leave dialog, instructor meetings), the student note-rendering tests (web and mobile) and the `week N` search test all fail against `c62eb42a`'s components or controllers.

### Query counts

QueryCounter clears the cache and counts logical reads, including cache hits.

| Endpoint | Growth | Result |
| --- | --- | --- |
| `GET enrollments/:id/learning_plan` | 3 → 9 lessons, 1 → 2 modules, 0 → 6 progress rows, saved plan | equal counts |
| `GET staff/private_meetings` (instructor) | 1 → 3 hosted cohorts, 1 → 5 slots, 1 → 3 bookings, 1 → 3 other cohorts | equal counts |

The staff meetings index used to run two queries per hosted cohort (slots, bookings); it now loads both once.

## Browser acceptance ledger

Local harness (`scripts/qa/run start`) plus `scripts/qa/plan-editor-meetings-fixtures.rb`, which adds a synthetic 240-lesson course ("QA Catch-up") with persona 4 enrolled, 75 lessons finished and one redo; QA Program meetings hosted by the admin; QA Catch-up meetings switched on with no host. Chromium in the T3 preview browser at 1280×844 and 390×844, light and dark set explicitly.

| # | Scenario | Role · width · theme | Result and evidence |
| --- | --- | --- | --- |
| 1 | Learning tab size | Admin · 1280 · light | View mode: page 9,058px with one module open (the audit's 31,500px included the old open editor); plan section 194px with no plan, 604px with a 48-lesson plan (instructor, 390). Editing: plan section 1,130px with one empty milestone and 1,430px with 45 lessons; each milestone's lesson list is capped at 288px. |
| 2 | Build a plan from scratch | Admin · 1280 · light | Passed. Customize plan → Add milestone → title and date → Add lessons. The picker opened with focus in search, "165 lessons shown", "Show finished lessons (75)", modules with Week headings, the redo badged. "Select all remaining (45)" then Add 45 lessons. The second milestone's picker showed "In Milestone 1" for placed lessons. Saved values checked in Postgres: titles, dates 2026-11-28 / 2026-12-12, 45 + 3 lessons, target 2026-12-19, one revision. |
| 3 | Keyboard | Admin · 1280 · light | Passed with real key presses: Down from search to the first lesson, Down to the next, Space selected it ("1 selected"), Ctrl+Enter added the selection and closed the dialog. Escape closes (shared Modal). |
| 4 | Search by week | Admin · 1280 · light | Found and fixed during QA: "react week 1" matched weeks 1–4 because "1" matched lesson numbers. "week N" now means that week; 15 lessons shown. Unit test added. |
| 5 | Sticky save | Admin · 1280; Instructor · 390 · dark | Passed. The save bar stays in view while editing (1280: y 758–828 of 844; 390: y 670–768, above the phone tab bar at y 775). Shows "No changes yet" → "Unsaved changes" → "Saving…". |
| 6 | Leave guard | Admin · 1280 · light | Passed. With unsaved edits, the Overview tab opened "Leave without saving?" with Keep editing / Discard changes / Save and leave. Keep editing stayed on Learning; Save and leave saved and navigated to Overview. |
| 7 | Edit, exception, validation | Instructor · 390 · dark | Passed. Edit personal plan → note replaced → Add requirement exceptions → search "backend lesson 10" ("Optional · Would become required") → Add 1 lesson. Saving with an empty reason was stopped by the browser and focused the Reason field; after filling it, "Personal plan saved. The student now sees this plan." |
| 8 | Student sees the agreed plan | Student (persona 4) · 1280 light, 390 dark | Passed. Today shows "Catch-up plan for December", the note, the target finish and the current milestone; no editor, history, exceptions list or staff text. The note rendered as literal Markdown until `PersonalLearningPlan` was switched to the shared renderer during QA; fixed and tested. |
| 9 | Instructor hosting nothing | Instructor · 390 · dark | Passed. Meetings shows "You don't host any meetings yet", each cohort with "Hosted by QA Admin" or "No host yet. Students can't book until an admin chooses one.", and Message buttons. The old text is gone. "Message QA Admin" opened `/messages/dm/2` with QA Admin in QA Catch-up. |
| 10 | Cohort Schedule tab | Instructor · 1280 · light | Passed. QA Program's Schedule shows "You don't host meetings in this cohort · Hosted by QA Admin · Message QA Admin" instead of the dead end. |
| 11 | Admin assigns, instructor hosts | Admin then instructor · 1280 · light | Passed. Admin enabled QA Catch-up with QA Instructor as host. The instructor then saw the QA Catch-up publishing form, coverage and bookings, plus "Your other cohorts" (QA Program hosted by QA Admin; QA Alumni with no host). The admin page still lists cohorts and staff and shows no "other cohorts" panel. |
| 12 | Picker with finished lessons, dark | Admin · 1280 · dark | Passed visually: Done badges, "Nothing left to add" on finished prework, focus ring and selection tint readable. |

Pre-existing, not caused by this PR: the instructor's cohort Schedule tab logs React "two children with the same key `1`" on load. Swapping in main's `PrivateMeetings.tsx` reproduces it, so it comes from elsewhere on the cohort page.

Not run: WebKit/Safari (doesn't start on the Mac mini account), physical phones, Expo builds, real Clerk, production deployment. Typing Markdown into the Rich editor through automation was unreliable (the editor is unchanged here), so Markdown formatting in the note is covered by component tests rather than the browser run.

## Follow-ups

- Suggested catch-up plan: the app proposes milestones from the remaining required work and the target date; the instructor adjusts it; the student sees only the saved version (Leon's decision).
- The student's personal plan lists every lesson of the current milestone (about 3,700px for 45 lessons on a phone). Cap or paginate it.
- The Learning tab's module list opens every partly finished module; consider opening only the current one.
- Mobile: staff screens don't show learning plans or staff meetings yet, so there is no mobile editor or instructor meetings path. The student plan note now renders as Markdown on mobile.
- Instructor self-assignment as meetings host (or requesting it in-app) would widen permissions; it stays admin-only here.

## Cleanup

The harness servers (exact PIDs 97326, 97329) were stopped and their database `csg_qa_97317_1794874796` dropped via `scripts/qa/run clean`; the preview tab was closed; `dev-lifecycle status` shows no owned resources. The test database `csg_plan_meetings_test` is dropped after the final API run.
