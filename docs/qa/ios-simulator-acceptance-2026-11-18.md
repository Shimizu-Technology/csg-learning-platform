# CSG Learn iPhone: simulator acceptance, 2026-11-18

Agent-executed acceptance of the CSG Learn iPhone app on the iOS Simulator, run so that
Leon's real-phone check can be short. Scope: the W10 deep-link plan
([W10_MOBILE_DEEP_LINKS_QA.md](../W10_MOBILE_DEEP_LINKS_QA.md)), L-4.9 to L-4.11, N-5,
the #307 staff lesson editor, and the main learner journeys.

Result: **41 passed, 1 failed, 1 blocked, 1 not run, 1 needs a product decision** (45 cases).
Two bugs filed (B1, B2). Screenshots are in
[ios-simulator-acceptance-2026-11-18/](ios-simulator-acceptance-2026-11-18/).

> Copied into the repository on 2026-11-18 with the fixes in
> [mobile-simulator-qa-fixes-2026-11-18.md](mobile-simulator-qa-fixes-2026-11-18.md).
> Only the screenshots for the fixed screens are committed: s04, s12, s16, s20, n02, d02,
> j08, c01, c02, e21, p06, t11 and t14. Those are links. A name marked † (for example
> s02†) is a screenshot kept locally by the acceptance run and not committed.

## What was tested

| Item | Value |
|---|---|
| Source | `origin/main` at `6c169d6d` (includes #306, #307, #308) |
| Build | Debug dev client from `npx expo prebuild -p ios` + `xcodebuild` (Debug, iphonesimulator), Node 22.22.3, Homebrew CocoaPods |
| Device | "CSG Connect iPhone" `CE2CFA28-B7E4-44FD-9058-F66FB398FE47`, iOS 26.5, light and dark |
| Driving | T3 `agent-device` only. `simctl` used for install and one `simctl push` attempt |
| Backend | `scripts/qa/run` harness: Rails in test mode on loopback, fresh `csg_qa_` database, synthetic personas 1-8, local Vite web for handoffs |
| Fixtures | `seed.rb`, `plan-editor-meetings-fixtures.rb`, `student-workspace-course-fixtures.rb` (canonical prework), plus three local QA-only additions below |
| Real data | None. No production API, database, Clerk, or real accounts were used |

### How the app signed in without Clerk

The app only knows real Clerk, and the QA API only accepts `test_token_<id>`. I mirrored
what the web harness already does (`scripts/qa/clerk-stub.tsx` loaded by `scripts/qa/vite.mjs`):

- `.qa-local/mobile-qa/clerk-expo-stub.tsx` replaces `@clerk/expo` at bundle time. Signing
  in with an email containing a persona id (for example `qa3@example.invalid`, any password)
  makes `getToken()` return `test_token_3`. It loads only through
  `EXPO_OVERRIDE_METRO_CONFIG=.qa-local/mobile-qa/metro.config.js`; `mobile/metro.config.js`
  and app source are unchanged.
- `.qa-local/mobile-qa/handoff_stub.rb` (loaded with `RUBYOPT=-r…` on `scripts/qa/run start`)
  replaces the Clerk sign-in-token call in `ClerkWebHandoffService` with a loopback URL to
  the local web harness for the same persona. Without it every web handoff returns 503 in
  the harness.
- `.qa-local/mobile-qa/editor_fixtures.rb` sets lesson 3 to a 6,969-byte Markdown body
  with leading and trailing whitespace and lesson 4 to a 276-byte Trix-style HTML body.
  `notification_fixtures.rb` adds eight synthetic inbox notifications.

These files are git-ignored and were left in place so the run can be repeated. Real Clerk
sign-in, Google OAuth and the real Clerk handoff token were therefore **not** tested.

Two existing harness fixtures, `student-workspace-fixtures.rb` and `record-pages-fixtures.rb`,
failed on today's date with `Starts at must fit within one course week, Instructor must
match course instructor`. That is a fixture-date problem, not an app result. The checks
below did not depend on them.

## Results

### 1. Deep and universal links (L-4.9, L-4.10)

Student = persona 3 unless noted. "Back" means the in-app Back control.

| ID | Link | Expected | Result | Evidence |
|---|---|---|---|---|
| DL-01 | `csglearn://lessons/1?cohort_id=1` opened while **signed out**, then sign in | Lesson opens once after sign-in | Pass | 01† |
| DL-02 | `csgconnect://lessons/2?cohort_id=1` | Lesson 2; Back to Learn | Pass | s02† |
| DL-03 | `csglearn:///lesson/5?cohort_id=1` (native form) | Lesson 5 | Pass | s03† |
| DL-04 | `…/lessons/1?cohort_id=1#block-3` | Scrolls to block 3 | Pass (see O2) | [s04](ios-simulator-acceptance-2026-11-18/s04-lesson-block-anchor.png) |
| DL-05 | `csglearn://modules/2?cohort_id=1` | Module page | Pass | s05† |
| DL-06 | `csglearn://messages/dm/1` and `…?message_id=1` | DM; Back to Messages tab, no stacked tabs | Pass | s06†, s08† |
| DL-07 | `csglearn://messages/4` | Channel qa-class | Pass | s07† |
| DL-08 | `csglearn://updates?cohort_id=1&announcement_id=1` | Updates tab with the announcement sheet open; Close works | Pass | s09† |
| DL-09 | `csglearn://recordings?cohort_id=1&recording=1` | Recording page | Pass | s10† |
| DL-10 | `csglearn://meetings` (student) | Meetings screen | Pass | s11† |
| DL-11 | `/materials`, `/dashboard`, `/messages` | Learn, Today, Messages tabs | Pass | s13†, s14†, s15† |
| DL-12 | As student: `/staff/student/3?cohort_id=1`, `/admin/submissions/1`, `/admin/moderation`; also a staff link held while signed out, then sign-in as student | Fallback only; no staff screen, no web button | Pass | s17†, s18†, s19† |
| DL-13 | As student: `/cohort/1/schedule` and `/admin/cohorts/1/schedule` | Fallback, or a page with Back | **Fail: dead end (B1)** | [s12](ios-simulator-acceptance-2026-11-18/s12-cohort-schedule.png), [s16](ios-simulator-acceptance-2026-11-18/s16-admin-cohort-schedule-as-student.png) |
| DL-14 | Unknown `csglearn://totally/unknown/path`, unsupported `csglearn://profile` | Clear fallback with working Back | Pass, with a layout bug (B2) | [s20](ios-simulator-acceptance-2026-11-18/s20-unknown-path.png), s21† |
| DL-15 | `https://learn.codeschoolofguam.com/lessons/2?cohort_id=1` | Opens in the app (universal link) | Pass on simulator: iOS fetched the live AASA and routed into the app | s22† |
| DL-16 | `https://learn.codeschoolofguam.com/privacy` | Stays in Safari | Pass | s23† |
| DL-17 | Instructor: `/staff/student/4?cohort_id=1`, `/admin/cohorts/1/students/4`, `…/students/4/overview` | Student health for QA Behind | Pass | t02†, t03†, t04† |
| DL-18 | Instructor: `/admin/submissions/7` and with extra keys `?cohort_id=4&student_id=4&return_to=%2Fadmin` | Quick review keeps context | Pass (see O1) | t05†, t06† |
| DL-19 | Instructor: `/admin/help-requests/1`, `/admin/cohorts/1`, `/staff/curriculum/1`, `/admin/content`, `/admin/cohorts/1/schedule` | Native help request, cohort, curriculum, Learn, schedule | Pass | t07† to t12† |
| DL-20 | Instructor: `/thread/1` (bare) | Guidance, not a crash | Pass (see O8) | [t11](ios-simulator-acceptance-2026-11-18/t11-thread.png) |
| DL-21 | Instructor: `/admin/moderation` (admin-only) and `/admin/team` | No web button for Safety; "Open on the web" for Team opens the sheet | Pass | t15†, t16† |
| DL-22 | Admin: `/admin/moderation` | "Open on the web" opens Safety | Pass | a01† |
| DL-23 | Student link into second cohort `csglearn://lessons/19?cohort_id=2` | W10 asks that context not switch | **Needs decision (O1)**: the app switches the selected cohort on purpose | [c01](ios-simulator-acceptance-2026-11-18/c01-second-cohort-lesson.png), [c02](ios-simulator-acceptance-2026-11-18/c02-today-after-second-cohort-link.png) |

### 2. Web handoff (L-4.11)

| ID | Check | Result | Evidence |
|---|---|---|---|
| WH-01 | Instructor, student health → "Open student page on the web": authenticated sheet opens as the same person | Pass (local web via the QA handoff stub) | h02† |
| WH-02 | With the sheet open, resolve QA Behind's help request through the API; tap Done | Pass: the "Why flagged: Needs help" card disappeared immediately, no pull-to-refresh | h01† → h03† |
| WH-03 | Handoff failure shows retry | Not run: the stub always succeeds and I did not add failure injection | — |
| WH-04 | Instructor `csglearn://meetings?cohort_id=1&booking_id=1&week=2` | Pass: web Meetings opened automatically in one tap; native label reads "Your meeting update · Week 2", no booking ID. The fixture had no real booking, so the exact booking page was not checked | t13†, [t14](ios-simulator-acceptance-2026-11-18/t14-staff-meeting-after-sheet.png) |

### 3. Notification routing

| ID | Check | Result | Evidence |
|---|---|---|---|
| NR-01 | Student inbox: tap "redo requested" (`/lessons/1?cohort_id=1`) and "new DM" (`/messages/dm/1`) | Pass: lesson opens at the block, DM opens, Back returns to Notifications | n01†, n03†, n04† |
| NR-02 | Student inbox: tap a notification whose path is `/staff/student/3?cohort_id=1` | Pass: fallback, no staff screen. Back goes to Today, not the inbox (part of B2) | [n02](ios-simulator-acceptance-2026-11-18/n02-student-inbox-tap.png) |
| NR-03 | Simulated push tap (`simctl push` with a `body.path` payload) | **Blocked**: the app never asks for notification permission on a simulator (`src/lib/push-notifications.ts:46-57`, `!Device.isDevice`), and this iOS 26.5 runtime refuses a permission grant, so no banner appears | — |

Staff notification paths (`/staff/student/4?cohort_id=1`, `/admin/submissions/7`,
`/admin/help-requests/1`, the meeting path) were opened as URLs in DL-17 to DL-19 and WH-04.

### 4. N-5: personal plans and required/optional labels

| ID | Check | Result | Evidence |
|---|---|---|---|
| N5-01 | Persona 3 Today: personal plan card ("QA steady practice", target date, milestone, "0 of 18 required lessons done or submitted. 1 waiting for review.") | Pass. The counts come from the server and use the same fields as the web component | j01†, j02† |
| N5-02 | Persona 4 in QA Catch-up: This Week splits **Required work** from **Optional stretch** ("does not count against the required week") | Pass | p02†, p05† |
| N5-03 | Lesson kicker shows `VIDEO · REQUIRED` and `VIDEO · OPTIONAL`; module list shows `EXERCISE · REQUIRED` | Pass | p07†, p09†, p08† |

### 5. Staff lesson editor (#307)

Admin persona. The instructor persona has no authoring grant on these curricula, so it sees
no Edit button, which matches the editing-grants rules.

| ID | Check | Stored result | Result | Evidence |
|---|---|---|---|---|
| ED-01 | Open canonical Markdown lesson 370, Preview, back to Edit | — | Pass | e01†, e02† |
| ED-02 | Change only the title, save | Body md5 `340d45ce…`, 1,486 bytes before and after | Pass | e03† |
| ED-03 | Tap the end of line 2, type " Answer in full sentences.", save | `diff`: only line 2 changed; 1,486 + 26 = 1,512 bytes | Pass | e04† |
| ED-04 | Long body (lesson 3, 6,969 bytes): scroll, edit near the keyboard at the top and in section 19, Return + type, open Preview | Only the edited lines changed; leading `"  \n"` and trailing `"   \n\n\n"` preserved | Pass (see O5) | e08†, e17†, e19†, e11† |
| ED-05 | Trix HTML lesson 4: opens as source, Preview renders bold, bullets, code and link; change only the title, save | Body md5 `92b4747a…`, 276 bytes before and after | Pass (see O6) | [e21](ios-simulator-acceptance-2026-11-18/e21-trix-editor-source.png), e22†, e23† |

### 6. Learner journeys (persona 3, 402×874 pt)

| ID | Check | Result | Evidence |
|---|---|---|---|
| LJ-01 | Today: next action, meeting card, plan, redo, live schedule, recording catch-up, feedback | Pass | j01† to j04† |
| LJ-02 | Lesson view: blocks, code with Copy, Mark complete, rubric | Pass | 01† |
| LJ-03 | Repo URL submission on lesson 2 | Pass: "Submitted · waiting for review"; submission 27 saved with the URL | j05†, j06† |
| LJ-04 | Text submission on lesson 7 | Pass: submission 28 stored `def count(n) = n + 1  # synthetic answer` exactly (double space kept); "Saved on this device · not submitted" shown before submit (see O4) | j07† to j10† |
| LJ-05 | Send a DM to the instructor | Pass: message 9 saved; composer stays above the keyboard | j11†, j12† |
| LJ-06 | Updates: announcement sheet, Notifications tab, unread count drops after opening | Pass | s09†, n01† |
| LJ-07 | Dark mode spot check of Today | Pass | d01† |

No clipping, overlap or horizontal overflow showed up at this size except where noted in
B2 and O4.

## Bugs

### B1 (P2): learners get stuck on the cohort schedule page

- **Steps:** sign in as a student. Open `csglearn://cohort/1/schedule` or
  `csglearn://admin/cohorts/1/schedule` (a link or notification can carry either).
- **Expected:** the same "This link needs the web app" fallback that other staff paths
  give learners, or at least a page with Back.
- **Actual:** a card reading "Staff access only. An instructor or admin manages the cohort
  schedule." with no header, no Back, and no tab bar. A left-edge swipe does nothing. The
  only way out is another link or force-quitting the app.
- **Cause:** `src/app/(app)/cohort/[id]/schedule.tsx:89` returns the empty state without a
  `BackButton`, and the route is `headerShown: false` (`src/app/(app)/_layout.tsx:54`).
  `requiresStaff()` in `src/lib/notification-path.ts` only treats `/staff` and `/admin`
  as staff paths, so the mapped `/cohort/:id/schedule` reaches the screen instead of the
  fallback.
- **Evidence:** [s12](ios-simulator-acceptance-2026-11-18/s12-cohort-schedule.png),
  [s16](ios-simulator-acceptance-2026-11-18/s16-admin-cohort-schedule-as-student.png).

### B2 (P3): the link fallback screen shows a raw route name and two back arrows

- **Steps:** open any unknown or unsupported link, for example
  `csglearn://totally/unknown/path`, `csglearn://profile`, or a staff link as a student.
- **Expected:** the app's usual header (one Back control, Manrope type, human title).
- **Actual:** a default navigation bar titled **"link-unavailable"** with its own back
  chevron, plus a second centred arrow in the content. Heading and body use the system
  font. When the fallback is opened from the Notifications inbox, Back goes to Today
  instead of returning to the inbox. Same in dark mode.
- **Cause:** `link-unavailable` is not declared in the `Stack.Screen` list in
  `src/app/(app)/_layout.tsx`, so it gets default header options, while
  `src/app/(app)/link-unavailable.tsx` also renders its own `BackButton` with unstyled text.
- **Evidence:** [s20](ios-simulator-acceptance-2026-11-18/s20-unknown-path.png),
  [n02](ios-simulator-acceptance-2026-11-18/n02-student-inbox-tap.png),
  [d02](ios-simulator-acceptance-2026-11-18/d02-link-unavailable-dark.png).

## Observations (not filed as bugs)

- **O1, needs a decision.** A link carrying `cohort_id` changes the person's selected
  cohort for Today and Learn, and it stays changed after Back. This is deliberate
  (`selectCohortFromLink`, `src/providers/cohort-provider.tsx:225`, with a "Switched to …"
  announcement), but the notice was not visible on the lesson screen, and the W10 check
  says context should not switch. Seen for an instructor (`/admin/submissions/7?cohort_id=4`,
  t06b†) and
  for a learner ([c02](ios-simulator-acceptance-2026-11-18/c02-today-after-second-cohort-link.png)).
- **O2.** A block-anchored link highlights the block with "Opened from your update" even
  when it didn't come from an update ([s04](ios-simulator-acceptance-2026-11-18/s04-lesson-block-anchor.png)).
- **O3.** A link to a lesson that hasn't unlocked yet shows "No access / Lesson is not
  unlocked yet / Try again". "No access" reads harsher than "Upcoming"
  ([p06](ios-simulator-acceptance-2026-11-18/p06-optional-lesson-label.png)).
- **O4.** On text and repo-URL exercises the Submit button sits behind the keyboard, and the
  multiline response has no Done key, so learners have to scroll to reach Submit
  ([j08](ios-simulator-acceptance-2026-11-18/j08-text-after-scroll.png)).
- **O5.** In the first long-body attempt the caret started right at the keyboard edge;
  the view did not follow it, and the two lines typed after Return were not saved (only the
  newlines were). Two deliberate retries, one near the top of the body and one at section
  19, followed the caret and saved everything. This is most likely an automation artefact,
  but it is worth watching on the phone (e09†).
- **O6.** HTML/Trix bodies show raw tags under a "Markdown" label. Saving keeps them
  byte-for-byte, as documented, but the label may confuse staff.
- **O7.** The staff Meetings screen keeps the learner heading "Book your weekly meeting."
  above "Manage your meetings on CSG Learn web" ([t14](ios-simulator-acceptance-2026-11-18/t14-staff-meeting-after-sheet.png)).
- **O8.** A bare `/thread/:id` link says "This thread link is incomplete" and offers
  "Try again", which cannot succeed ([t11](ios-simulator-acceptance-2026-11-18/t11-thread.png)).

## Not covered here

Real Clerk email/Google sign-in and the `csgconnect://oauth-callback` return; the
`exp+csg-connect` dev-client OAuth half; real APNs delivery and push taps; links tapped
from Mail or Notes; Apple's association caching on a fresh install; handoff failure and
poor-network recovery; VoiceOver and the largest text sizes; meeting and enrollment push
fan-out; OTA (N-3); Android.

## Leon's 5-minute iPhone check

Use the next TestFlight build (the one with Associated Domains and `expo-updates`), a
student account and an instructor account.

1. **Universal link from Mail (about 1 min).** Force-quit CSG Learn. In Mail, tap
   `https://learn.codeschoolofguam.com/lessons/<real lesson id>?cohort_id=<id>`. It should
   open that lesson in the app, and Back should land on a usable tab. Then tap
   `https://learn.codeschoolofguam.com/privacy`; it should stay in Safari.
2. **Signed-out link with real sign-in (about 1 min).** Sign out. Tap the same lesson link
   in Mail, sign in with your real method (Google or email), and confirm the lesson opens
   once.
3. **Real push, student (about 1 min).** From the instructor account (web is fine), send the
   student a DM. With the app force-quit, tap the push: the DM should open. Do it again with
   the app in the background.
4. **Real push, staff meeting (about 1 min).** As the student, move or book a meeting. On the
   instructor's phone, tap the push: the web booking should open after one tap, and the
   label should say "Week N", not a booking number.
5. **Editor near the keyboard (about 1 min).** As staff, open a long Markdown lesson's
   editor, tap a line just above the keyboard, and type two lines with Return between
   them. The cursor should stay visible, and both lines should be there after Save (O5).

If there's time: allow notifications on first launch and check that turning push off in
the app's settings stops delivery; quickly try VoiceOver on the "This link needs the web
app" screen.

## Cleanup

- Simulator `CE2CFA28` closed and shut down. The other booted simulator (iPhone 16 Pro
  `30780651…`) was not touched.
- The app was signed out before shutdown. The simulator now has this Debug dev-client
  build installed in place of the earlier CSG Connect build; it needs Metro to start.
- QA harness stopped and database `csg_qa_52268_1794964630` dropped (`scripts/qa/run clean`).
  Metro on port 8095 stopped. Lifecycle session `6e6decb5-a4a7-4e14-a708-28ffcb569822`
  reports no active owned resources.
- The generated `mobile/ios` folder (5.8 GB, git-ignored) was removed. `node_modules`,
  `mobile/.expo` and `.qa-local/` are git-ignored and remain. The three
  `~/Library/Developer/Xcode/DerivedData/CSGLearn-*` folders predate this run (earlier EAS
  local builds) and were left alone.
- Nothing was committed.
