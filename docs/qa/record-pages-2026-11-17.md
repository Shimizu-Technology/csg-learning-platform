# Staff record pages (L-5.2) QA, 2026-11-17

Affected-flow QA for backlog item L-5.2, executed by the implementation agent on the Mac mini. Branch `feat/record-pages`, based on main `e0af0801`; the final browser pass ran at `e7f2a5d8`. Synthetic data only.

## What was checked against the backlog

| L-5.2 record | State before this work | What this PR does |
| --- | --- | --- |
| Curriculum, module, lesson (staff) | Pages from #287 | Rubric titles on the curriculum page now open the rubric page |
| Staff member | Team member page from #278 | Unchanged; staff names on the new pages link to it (admins) |
| Moderation item | Safety page from #278 | Unchanged |
| Message permalink | "Copy link to message" already in web Messages (L-2.8, commit `094e03a9`); opening `?message_id=` highlights it, including thread replies | Verified in the browser; no change needed |
| Recovery plan | The "Return plan" (glossary retires "recovery plan"): a section on the follow-up plan page and on the student page's Support tab (`?plan_id=`) | Registered as `recovery_plan` in the route registry, pointing at that Support view |
| Recording | Learner Recordings only | `/admin/recordings/:id` |
| Office-hour session | None | `/admin/office-hours/:id` |
| Private-meeting booking | A card on Meetings | `/admin/meetings/:id`; learners keep My meetings |
| Learning plan and milestones | Plan editor on the student page (#285) | `/admin/learning-plans/:id` |
| Channel as a cohort record | Messages only | `/admin/channels/:id` (shown as "Class chat" / "Conversation details") |
| Rubric | Listed on the curriculum page | `/admin/rubrics/:id` |
| Activity event | Rows in Activity | `/admin/activity/:id` |

## Environment

- Harness: `scripts/qa/run start` (Rails test mode and Vite on loopback, fresh `csg_qa_` database), then `scripts/qa/record-pages-fixtures.rb`.
- Fixture: QA Program gets one of each record. "QA Other Program" shares QA Program Lab and is taught only by "QA Other instructor", with its own recording, session, booking, plan, channel message and activity event. The QA instructor blocks the behind student.
- Browser: Playwright Chromium at 1280 and 390 wide, light and dark (`QA_SPEC=record-pages.spec.ts`). Each recorded page checks no sideways scroll, no serious axe violations and no contrast violations.
- Personas: admin (1), QA instructor (2, teaches QA Program, not QA Other Program), program student (3).

## Results

44 of 44 cases passed (11 scenarios × 2 widths × 2 themes) at `e7f2a5d8`.

| # | Scenario | Result |
| --- | --- | --- |
| 1 | Admin opens a recording from the cohort's Recordings tab: week, the lesson that plays it with both sections, who watched. The lesson link opens the lesson page, whose Back returns to the recording. Edit opens the Recordings tab with that recording's form open. Back returns to the Recordings tab. | Passed |
| 2 | Instructor opens a session from the Schedule tab: Weekly, Join link, invited learners; Back returns to Schedule. Opens a booking from Meetings: student, host, history (Booked, Changed the meeting link); "Move or cancel" opens Meetings focused on that booking. | Passed |
| 3 | Instructor opens a plan from the plan editor's "Plan page and history": milestones with lesson status, revisions ("Started the plan", "Changed the description, next follow-up"). "Edit plan" scrolls to the editor; Back returns to the student page. | Passed |
| 4 | Instructor opens a channel from the Communication tab: "Class chat", member count with no list, the blocked sender's message reads "Message hidden" and its text never appears. "Open in Messages" opens the conversation; its menu's "Conversation details" comes back with "Back to Messages". | Passed |
| 5 | Admin sees the channel's member list. Admin opens the rubric from the curriculum page: criteria, the exercises using it, both cohorts named; Back returns to the curriculum. | Passed |
| 6 | Instructor's rubric page counts only QA Program and says one other cohort uses the curriculum, without naming it. | Passed |
| 7 | Admin opens an event from School activity, then its submission (Back to Activity), then Back to School activity. | Passed |
| 8 | Instructor opens an event from the cohort's Activity tab; Back returns there. | Passed |
| 9 | Instructor opens each QA Other Program record by URL: "No access", and no name, learner or message from that cohort appears. Admin opens all six. | Passed |
| 10 | Student opens all seven staff pages by URL: "No access". Their own booking still opens on My meetings. | Passed |
| 11 | Instructor copies a message link in Messages (hover toolbar at 1280, the actions sheet at 390). The copied URL is `/messages/:id?message_id=:id`; opening it in a new tab shows that message highlighted and in view. | Passed |

Two cases failed on the first run and were spec problems, not app defects: a link selector matched "Open QA counter walkthrough" as well as the title, and one step clicked Back before the lazily loaded event page replaced the cohort page (the URL changes first). Both were fixed in the spec and passed on the rerun. Reviewing the screenshots led to two app changes, retested in the final pass: the plan's revision line said "next check-in" (a retired term) and now says "next follow-up", and the recording's lesson rows no longer show the lesson's week within its module ("QA Week 2 · Week 1"), which read as a contradiction of the recording's own Week 2.

## Not run or out of scope

- WebKit / Safari: not run. WebKit doesn't start on the Mac mini.
- Native app: no native pages for these records. Native destinations are unchanged, and the new `/admin/...` URLs are not claimed by universal links, so they open on the web.
- Attendance for office hours and notes on bookings: not recorded by the app, so not shown. See follow-ups in the PR.
- Real meeting links and video playback: fixture links point at `example.invalid`.

## Fix round 1 (review of `d0763c64`)

An independent review found two P2 issues and one P3 issue. The branch also merged main `c290e00a` (#289, #291, #294, #295). After #289's split of the workspace pages, the recording link moved to `studentWorkspace/LearningTab.tsx`, the cohort's group conversation list to `cohortWorkspace/Communication.tsx`, and the `edit_recording` deep link to `CohortWorkspace.tsx`.

- **P2, activity labels.** An event in cohort A whose record is a recording, submission or block belonging elsewhere now returns neither `record` nor `record_label`, for admins and instructors alike. The page says "Not available". Regression tests build each mismatch directly on the model.
- **P2, watcher size.** A recording's watchers come 25 per page (`?page=`), most recently watched first, with `watchers_count` and `completed_count` from aggregate queries and `watchers_next_page`. The page shows "Show more" and "Showing n of m". The query-count test grows to 30 watchers (13 queries at 1 and at 30) and checks the page stays at 25 rows. An integration test with 61 watchers keeps page 1 under 12 KB and checks that every watcher appears exactly once across three pages.
- **P3, Back on failed loads.** Loading, error and No access states keep the page's Back link, from router state, `return_to` or the record type's list. Try again still recovers.

Browser re-check after the fixes and merge, on fresh fixtures (now with 30 watchers): **48 of 48 passed** at 1280 and 390, light and dark. These are the 44 earlier cases plus a new scenario: a forced 500 on the recording keeps "Back to Grading · Redo" from `return_to`, Try again loads the page, and a missing rubric shows No access with "Back to Curriculum". The admin recording case now also loads the second page of watchers with Show more.
