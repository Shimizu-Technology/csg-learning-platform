# CSG Learn iPhone: fixes from the simulator acceptance run, 2026-11-18

Fixes for the bugs and observations in
[ios-simulator-acceptance-2026-11-18.md](ios-simulator-acceptance-2026-11-18.md). All changes
are JavaScript in `mobile/`, so they can ship over the air. No API, web, native module or
app config changed.

## Build identity

| Item | Value |
|---|---|
| Branch | `fix/mobile-simulator-qa`, from `origin/main` at `9926b61c` |
| iOS fingerprint | `164df5a292cd4ad70cf1b725469fc61a3ed919c7` from `npx eas-cli@16.28.0 fingerprint:generate --platform ios`. This is the same value as `main`, so the change is OTA-compatible |
| Gate | `npm run check` in `mobile/`: brand check, URI decoder and OTA script tests, `tsc`, ESLint (0 errors; 74 warnings, none in lines this change added), Jest 142 suites and 1,817 tests passed |
| Device | "CSG Connect iPhone" `CE2CFA28-B7E4-44FD-9058-F66FB398FE47`, iOS 26.5, light and dark, driven only through T3 `agent-device` |
| App | The Debug dev client that the acceptance run had already installed. It needs no rebuild because the fingerprint is unchanged. Metro served this branch's working tree |
| Backend | `scripts/qa/run`: Rails in test mode on loopback with a fresh `csg_qa_` database and synthetic personas. Fixtures: `plan-editor-meetings-fixtures.rb`, `student-workspace-course-fixtures.rb` and the local `notification_fixtures.rb` |
| Sign-in | The git-ignored `.qa-local/mobile-qa/` Clerk stub and handoff stub from the acceptance run. No real accounts, Clerk or production data were used |

## What changed

| Finding | Fix |
|---|---|
| **B1** Students got stuck on the staff schedule | `requiresStaff()` now covers every native staff-only route: `/staff/*`, `/admin/*`, `/cohort/:id/schedule`, `/recordings/link`, `/recordings/upload` and `/manage-communications`. Links, push taps and inbox taps now send learners to the standard fallback. The `(app)` layout guard uses the same check. The schedule, grading, support and recording link/upload screens now use one `StaffOnlyScreen` with Back and a "Go to Today" or "Go to Recordings" button, which reaches the tab bar. Audit: the staff student, submission, support, intervention, curriculum and lesson editor screens already had Back. `staff/access` and `manage-communications` have native headers with Back |
| B1 audit find | `recordings/upload` was not registered, so staff saw a default header with the raw title "recordings/upload" above the screen's own header. It is now registered with `headerShown: false` |
| **B2** The fallback screen showed "link-unavailable" and two back arrows | `link-unavailable` is registered in `src/app/(app)/_layout.tsx` with `headerShown: false`. The screen draws the app's own header: one Back and a "LINK" kicker in Manrope. Inbox taps push the fallback directly instead of bouncing through the layout redirect, which used to drop the history, so Back and swipe-back return to the inbox |
| **Cohort switch (O1)** | Behaviour kept as decided: a link with `cohort_id` switches the selected cohort. The "Switched to <cohort>" notice now stays for 7 seconds, counted from when the switch takes effect rather than from the tap. The old 4.5-second timer could run out while a lesson was still loading. The W10 plan now expects the switch and the notice |
| **Keyboard covers Submit (O4)** | On iOS, the text and repo-URL fields of an exercise have a bar above the keyboard with "Hide keyboard" and Submit/Update. Submitting from it closes the keyboard first. This uses React Native's built-in `InputAccessoryView`, so no native module was added |
| O2 | A highlighted block reads "Linked section" instead of "Opened from your update", because the link may not come from an update |
| O3 | A lesson or module that opens later shows "Not open yet" and "Go to Learn" instead of "No access" and "Try again" |
| O6 | The staff editor labels a legacy HTML/Trix body "HTML source", and its button says "Edit source" |
| O7 | Staff no longer see the learner line "Book your weekly meeting." on Meetings |
| O8 | A bare `/thread/:id` link offers "Go to Messages" instead of a "Try again" that can't work |
| Found while testing | A development build opens itself with `exp+csg-connect://expo-development-client/...`, and the app treated that as an unknown link and showed the fallback at launch. That URL is now ignored. Production builds never receive it |

## Simulator results

Student = persona 3. Instructor = persona 2.

| ID | Check | Result | Before | After |
|---|---|---|---|---|
| F-B1a | Student opens `csglearn://cohort/1/schedule` | Pass: fallback with one Back. Back lands on Today with the tab bar | [s12](ios-simulator-acceptance-2026-11-18/s12-cohort-schedule.png) | [after](mobile-simulator-qa-fixes-2026-11-18/after-b1-cohort-schedule-student.png) |
| F-B1b | Student opens `csglearn://admin/cohorts/1/schedule` | Pass: same fallback, and Back goes to Today | [s16](ios-simulator-acceptance-2026-11-18/s16-admin-cohort-schedule-as-student.png) | [after](mobile-simulator-qa-fixes-2026-11-18/after-b1-admin-cohort-schedule-student.png) |
| F-B1c | Instructor opens `csglearn://admin/cohorts/1/schedule` | Pass: the staff schedule still opens with Back and "Add a session" | — | [after](mobile-simulator-qa-fixes-2026-11-18/after-staff-schedule-instructor.png) |
| F-B2a | Student inbox: tap "QA: staff-only link" | Pass: fallback with one Back and Manrope type. Back returns to Notifications, and the left-edge swipe also returns there | [n02](ios-simulator-acceptance-2026-11-18/n02-student-inbox-tap.png) | [after](mobile-simulator-qa-fixes-2026-11-18/after-b2-inbox-staff-link.png) |
| F-B2b | `csglearn://profile` (unsupported), dark mode | Pass | [d02](ios-simulator-acceptance-2026-11-18/d02-link-unavailable-dark.png), [s20](ios-simulator-acceptance-2026-11-18/s20-unknown-path.png) | [after](mobile-simulator-qa-fixes-2026-11-18/after-b2-unsupported-dark.png) |
| F-N1 | Student on QA Program opens `csglearn://lessons/296?cohort_id=5`; snapshot every half second | Pass: the notice shows from about 2 s, when "Opening lesson" appears, to about 9 s. The lesson rendered at about 3 s | [c01](ios-simulator-acceptance-2026-11-18/c01-second-cohort-lesson.png) | [after](mobile-simulator-qa-fixes-2026-11-18/after-notice-lesson.png) |
| F-K1 | Student types into lesson 7's text exercise | Pass: "Hide keyboard" and "Submit" sit above the keyboard. Tapping Submit there stored submission 27 with the exact text `def count(n) = n + 1  # keyboard bar check ok`, double space kept, and showed "Submitted · your instructor will review it." | [j08](ios-simulator-acceptance-2026-11-18/j08-text-after-scroll.png) | [bar](mobile-simulator-qa-fixes-2026-11-18/after-keyboard-submit-bar.png), [submitted](mobile-simulator-qa-fixes-2026-11-18/after-keyboard-submitted.png) |
| F-O7 | Instructor opens `csglearn://meetings` | Pass: only "Manage your meetings on CSG Learn web." | [t14](ios-simulator-acceptance-2026-11-18/t14-staff-meeting-after-sheet.png) | [after](mobile-simulator-qa-fixes-2026-11-18/after-o7-staff-meetings.png) |
| F-O8 | Instructor opens `csglearn://thread/1` | Pass: "Go to Messages" opens the Messages tab | [t11](ios-simulator-acceptance-2026-11-18/t11-thread.png) | [after](mobile-simulator-qa-fixes-2026-11-18/after-o8-bare-thread.png) |

The keyboard-bar screenshot comes from the agent-device CLI, which leaves the keyboard out.
The bar is drawn at the keyboard's top edge, and a live device screenshot during the run
showed the keyboard under it.

Jest covers these and the simulator did not: the learner-facing `StaffOnlyScreen` (links no
longer reach it), O2, O3 and O6, the 7-second notice timer, inbox routing for staff versus
learners, and the development launcher URL.

The first notice and keyboard checks ran against a Metro started with `CI=1`, which does
not watch files, so they tested the old code. Those results were thrown away. Metro was
restarted with watching on, and the notice, keyboard, O7 and O8 checks above ran on the
fresh bundle.

## Residuals

- **O5, the editor caret near the keyboard:** not changed. Two deliberate retries in the
  acceptance run worked, and the failure looked like an automation artefact. It stays in
  Leon's phone check.
- **True cold start from a link:** a development build's launcher catches the link, so the
  notice and fallback were checked with the app already running. The 7-second timer does
  not start until the switch takes effect, so a slow cold start is covered by design.
  Confirm it on the TestFlight build.
- **Android:** `InputAccessoryView` is iOS-only. Android relies on window resizing, which
  was not checked here because Android is out of scope.
- **New, minor:** under the bare-thread error, the thread composer and formatting button
  still render. Typing there can't send anything useful. This is left as is because the
  case is rare and the fix belongs to the thread screen's layout.
- **WH-03 (handoff failure retry) and NR-03 (simulated push):** still not run, for the
  reasons in the acceptance report.

## Cleanup

- Simulator `CE2CFA28` was signed out, closed and shut down. The other booted simulator,
  iPhone 16 Pro `30780651…`, was not touched.
- The QA harness was stopped and database `csg_qa_92239_1794968170` was dropped with
  `scripts/qa/run clean`. Metro on port 8095 was stopped. Lifecycle session
  `7459b90b-810f-4ce2-8a12-330409a02412` reports no active owned resources.
- No `mobile/ios` folder was generated. `.qa-local/` and `node_modules` are git-ignored.
